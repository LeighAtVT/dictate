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
    public static func canInstall(executable: String) -> Bool {
        !executable.contains("/AppTranslocation/")
    }
}

/// A secret read once (for example from the Keychain, which may show a prompt) and then kept in memory.
public final class CachedSecret: @unchecked Sendable { // state is guarded by `lock`
    private let lock = NSLock()
    private let load: @Sendable () -> String?
    private var loaded = false
    private var cached: String?

    public init(load: @escaping @Sendable () -> String?) {
        self.load = load
    }

    public func value() -> String? {
        lock.withLock {
            if !loaded {
                cached = load()
                loaded = true
            }
            return cached
        }
    }

    public func set(_ value: String?) {
        lock.withLock {
            cached = value
            loaded = true
        }
    }
}
