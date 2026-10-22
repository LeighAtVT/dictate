import Foundation
import Testing
@testable import DictateCore

@Suite struct LaunchAgentTests {
    @Test func plistRestartsOnlyAfterUnexpectedExits() throws {
        let data = LaunchAgent.plistData(executable: "/Applications/Dictate.app/Contents/MacOS/Dictate")
        let plist = try #require(try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
        #expect(plist["Label"] as? String == "com.leigh.dictate.keepalive")
        #expect(plist["Program"] as? String == "/Applications/Dictate.app/Contents/MacOS/Dictate")
        #expect(plist["RunAtLoad"] as? Bool == true)
        #expect((plist["KeepAlive"] as? [String: Bool])?["SuccessfulExit"] == false)
        #expect(plist["ProcessType"] as? String == "Interactive")
        #expect(plist["ThrottleInterval"] as? Int == 5)
        #expect(plist["LimitLoadToSessionType"] as? String == "Aqua")
    }

    @Test func plistIsStableForTheSamePath() {
        #expect(LaunchAgent.plistData(executable: "/a") == LaunchAgent.plistData(executable: "/a"))
        #expect(LaunchAgent.plistData(executable: "/a") != LaunchAgent.plistData(executable: "/b"))
    }

    @Test func translocatedCopiesAreNotInstalled() {
        #expect(LaunchAgent.canInstall(executable: "/Applications/Dictate.app/Contents/MacOS/Dictate"))
        #expect(!LaunchAgent.canInstall(executable: "/private/var/folders/x/AppTranslocation/ABC/d/Dictate.app/Contents/MacOS/Dictate"))
        #expect(!LaunchAgent.canInstall(executable: "/Users/me/repos/dictate/.build/debug/Dictate")) // bare dev build
    }

    @Test func cachedSecretNeverBlocksWhileLoading() async {
        let gate = DispatchSemaphore(value: 0)
        let secret = CachedSecret { gate.wait(); return "k" } // like a Keychain prompt nobody has answered
        // The blocked load gets a thread of its own, the way the engine runs Keychain reads. On
        // Swift's cooperative pool it would hold a pool thread that this test body needs in order
        // to reach `gate.signal()`, and with a one-thread pool the test would never finish.
        let loader = Task { await onOwnThread { secret.value() } }
        try? await Task.sleep(for: .milliseconds(50))
        let start = Date()
        #expect(secret.value() == nil) // still loading: answer right away
        #expect(Date().timeIntervalSince(start) < 0.5)
        secret.set("typed") // saving a key mid-load doesn't block either, and wins
        gate.signal()
        #expect(await loader.value == "typed")
        #expect(secret.value() == "typed")
    }

    @Test func cachedSecretLoadsOnce() {
        final class Counter: @unchecked Sendable { var n = 0 }
        let counter = Counter()
        let secret = CachedSecret { counter.n += 1; return "k" }
        #expect(secret.value() == "k")
        #expect(secret.value() == "k")
        #expect(counter.n == 1)
        secret.set(nil)
        #expect(secret.value() == nil)
        #expect(counter.n == 1)
    }
}
