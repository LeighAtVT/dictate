import Foundation
import Testing
@testable import EngineKit

/// One entry in `app/src/shared/protocol-fixtures.json`, shared with the TS
/// side (`app/src/shared/protocol.test.ts`) so the two implementations of
/// the wire protocol can't drift apart.
private struct Fixture: Decodable {
    let line: String
    let kind: String
    let op: String?
}

private enum FixturesLoader {
    /// Walks up from this file until it finds the directory containing
    /// `Package.swift` (the repo root), then descends to the shared
    /// fixtures file the TS side also reads.
    static func load() throws -> [Fixture] {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while !FileManager.default.fileExists(atPath: dir.appendingPathComponent("Package.swift").path) {
            let parent = dir.deletingLastPathComponent()
            precondition(parent.path != dir.path, "walked past filesystem root looking for Package.swift")
            dir = parent
        }
        let fixturesURL = dir.appendingPathComponent("app/src/shared/protocol-fixtures.json")
        let data = try Data(contentsOf: fixturesURL)
        return try JSONDecoder().decode([Fixture].self, from: data)
    }
}

@Suite struct ProtocolTests {
    @Test func everyRequestFixtureDecodesWithMatchingOp() throws {
        let fixtures = try FixturesLoader.load().filter { $0.kind == "request" }
        #expect(!fixtures.isEmpty)
        for fixture in fixtures {
            let request = try JSONDecoder().decode(EngineRequest.self, from: Data(fixture.line.utf8))
            #expect(request.op == fixture.op, "fixture line: \(fixture.line)")
        }
    }

    @Test func allFifteenRequestOpsAreCovered() throws {
        let ops = Set(try FixturesLoader.load().filter { $0.kind == "request" }.compactMap(\.op))
        let expected: Set<String> = [
            "startRecording", "cancelRecording", "stopRecording", "context", "selection",
            "paste", "copy", "setHotkey", "permissions", "requestPermission",
            "secret.get", "secret.set", "secret.delete", "legacyKey", "quit"
        ]
        #expect(ops == expected)
    }

    @Test func pasteTextRoundTripsByteForByte() throws {
        let fixture = try FixturesLoader.load().first { $0.kind == "request" && $0.op == "paste" }
        let fixtureUnwrapped = try #require(fixture)
        let request = try JSONDecoder().decode(EngineRequest.self, from: Data(fixtureUnwrapped.line.utf8))
        guard case .paste(let text) = request else {
            Issue.record("expected .paste, got \(request)")
            return
        }
        let expected = "Line one\nLine two — \u{201C}quoted\u{201D} \u{1F399}\u{FE0F} \u{2028} end"
        #expect(text == expected)
        #expect(text.contains("\u{2028}"))

        // Round-trip back through the wire: re-encode the decoded text as a
        // paste request and decode it again, byte for byte.
        let reencoded = encodeLine(EngineRequestWireFixture(id: 6, op: "paste", text: text))
        let redecoded = try JSONDecoder().decode(EngineRequest.self, from: Data(reencoded.utf8))
        guard case .paste(let roundTrippedText) = redecoded else {
            Issue.record("expected .paste after round trip, got \(redecoded)")
            return
        }
        #expect(roundTrippedText == expected)
    }

    @Test func engineReplyOkEncodesFlatEnvelope() throws {
        let line = encodeLine(EngineReply.ok(4, [
            "appId": .string("com.apple.Safari"),
            "windowTitle": .string("Example"),
            "secureInput": .bool(false),
            "elevated": .bool(false)
        ]))
        let decoded = try #require(try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
        #expect(decoded["reply"] as? Int == 4)
        #expect(decoded["ok"] as? Bool == true)
        #expect(decoded["appId"] as? String == "com.apple.Safari")
        #expect(decoded["error"] == nil)
    }

    @Test func engineReplyErrorEncodesErrorField() throws {
        let line = encodeLine(EngineReply.error(99, "permission denied"))
        let decoded = try #require(try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
        #expect(decoded["reply"] as? Int == 99)
        #expect(decoded["ok"] as? Bool == false)
        #expect(decoded["error"] as? String == "permission denied")
    }

    @Test func engineEventKeyEncodesHeldModifiers() throws {
        let line = encodeLine(EngineEvent.key(down: true, held: [.shift, .command]))
        let decoded = try #require(try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
        #expect(decoded["event"] as? String == "key")
        #expect(decoded["down"] as? Bool == true)
        #expect(decoded["held"] as? [String] == ["shift", "command"])
    }
}

/// A minimal `Encodable` matching the TS wire shape of a `paste` request
/// (`{id, op, text}`), used only to prove `EngineRequest` decodes what
/// `encodeLine` on the brain side would actually send.
private struct EngineRequestWireFixture: Encodable {
    let id: Int
    let op: String
    let text: String
}
