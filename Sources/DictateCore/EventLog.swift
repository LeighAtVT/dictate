import Foundation

/// Appends timestamped lines to a log file, keeping one rotated copy. Never given dictated text.
public final class EventLog: @unchecked Sendable { // all file access is under `lock`
    let fileURL: URL
    let maxBytes: Int
    let now: @Sendable () -> Date
    private let lock = NSLock()
    private let formatter = ISO8601DateFormatter()

    public init(fileURL: URL, maxBytes: Int = 1_000_000, now: @escaping @Sendable () -> Date = { Date() }) {
        self.fileURL = fileURL
        self.maxBytes = maxBytes
        self.now = now
    }

    public func write(_ message: String) {
        lock.withLock {
            let line = Data("\(formatter.string(from: now())) \(message)\n".utf8)
            let fm = FileManager.default
            try? fm.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            let size = (try? fm.attributesOfItem(atPath: fileURL.path)[.size] as? Int) ?? 0
            if size > 0, size + line.count > maxBytes {
                let rotated = URL(fileURLWithPath: fileURL.path + ".1")
                try? fm.removeItem(at: rotated)
                try? fm.moveItem(at: fileURL, to: rotated)
            }
            if let handle = try? FileHandle(forWritingTo: fileURL) {
                defer { try? handle.close() }
                _ = try? handle.seekToEnd()
                try? handle.write(contentsOf: line)
            } else {
                try? line.write(to: fileURL)
            }
        }
    }
}
