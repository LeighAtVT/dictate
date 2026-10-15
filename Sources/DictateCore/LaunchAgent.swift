import Foundation

/// A per-user LaunchAgent that starts Dictate at login and restarts it after any exit other than Quit.
/// It points at the app by path, so replacing the app with a new build keeps it working.
public enum LaunchAgent {
    public static let label = "com.leigh.dictate.keepalive"

    public static var plistURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/\(label).plist")
    }

    public static func plistData(executable: String) -> Data {
        let plist: [String: Any] = [
            "Label": label,
            "Program": executable,
            "RunAtLoad": true,
            "KeepAlive": ["SuccessfulExit": false],
            "ProcessType": "Interactive",
            "ThrottleInterval": 5,
            "LimitLoadToSessionType": "Aqua",
        ]
        return (try? PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)) ?? Data()
    }

    /// A copy macOS is running from a temporary quarantine location would go stale, so don't point the agent at it.
    /// Only an installed app bundle qualifies: not a bare dev build, and not a quarantine copy.
    public static func canInstall(executable: String) -> Bool {
        executable.contains(".app/Contents/MacOS/") && !executable.contains("/AppTranslocation/")
    }
}

/// A secret read once (for example from the Keychain, which may show a prompt) and then kept in memory.
/// While the first read is still waiting, callers get nil straight away instead of waiting with it.
public final class CachedSecret: @unchecked Sendable { // state is guarded by `lock`
    private enum State { case unread, loading, ready(String?) }

    private let lock = NSLock()
    private let load: @Sendable () -> String?
    private var state = State.unread

    public init(load: @escaping @Sendable () -> String?) {
        self.load = load
    }

    public func value() -> String? {
        let shouldLoad: Bool = lock.withLock {
            switch state {
            case .ready, .loading: return false
            case .unread:
                state = .loading
                return true
            }
        }
        if shouldLoad {
            let loaded = load() // outside the lock: this may wait on a Keychain prompt
            lock.withLock { if case .loading = state { state = .ready(loaded) } } // a set() meanwhile wins
        }
        return lock.withLock {
            if case .ready(let value) = state { return value }
            return nil
        }
    }

    public func set(_ value: String?) {
        lock.withLock { state = .ready(value) }
    }
}
