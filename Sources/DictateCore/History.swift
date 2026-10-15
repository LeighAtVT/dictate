import Foundation

/// The last few dictations (text only), kept on disk so "Copy last" and "Paste raw instead" survive a restart.
public final class History: @unchecked Sendable {
    static let maxEntries = 50
    static let maxAge: TimeInterval = 7 * 86_400

    private let fileURL: URL
    private let now: @Sendable () -> Date
    private let lock = NSLock()
    private var entries: [HistoryEntry]

    public init(fileURL: URL, now: @escaping @Sendable () -> Date = Date.init) {
        self.fileURL = fileURL
        self.now = now
        let data = try? Data(contentsOf: fileURL)
        entries = data.flatMap { try? Self.decoder.decode([HistoryEntry].self, from: $0) } ?? []
    }

    public func add(_ entry: HistoryEntry) {
        lock.lock(); defer { lock.unlock() }
        entries.append(entry)
        pruneLocked()
        if entries.count > Self.maxEntries {
            entries.removeFirst(entries.count - Self.maxEntries)
        }
        save()
    }

    /// Newest first.
    public func recent() -> [HistoryEntry] {
        lock.lock(); defer { lock.unlock() }
        return entries.sorted { $0.date > $1.date }
    }

    public func prune() {
        lock.lock(); defer { lock.unlock() }
        pruneLocked()
        save()
    }

    private func pruneLocked() {
        let cutoff = now() - Self.maxAge
        entries.removeAll { $0.date < cutoff }
        entries.sort { $0.date < $1.date }
    }

    private func save() {
        try? FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? Self.encoder.encode(entries).write(to: fileURL, options: .atomic)
    }

    private static let encoder: JSONEncoder = { let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601; return e }()
    private static let decoder: JSONDecoder = { let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601; return d }()
}
