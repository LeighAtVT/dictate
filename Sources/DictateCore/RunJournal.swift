import Foundation

public struct RunRecord: Codable, Equatable, Sendable {
    public var pid: Int32
    public var launchedAt: Date
    public var cleanExit: Bool
    public var exitReason: String?
}

/// Remembers whether the last run ended cleanly, so an unexpected stop can be noticed on the next launch.
public struct RunJournal: Sendable {
    let fileURL: URL

    public init(fileURL: URL) {
        self.fileURL = fileURL
    }

    /// Records this launch. Returns the previous run only when it did not end cleanly.
    public func begin(pid: Int32, now: Date) -> RunRecord? {
        let previous = read()
        write(RunRecord(pid: pid, launchedAt: now, cleanExit: false, exitReason: nil))
        guard let previous, !previous.cleanExit else { return nil }
        return previous
    }

    public func markClean(reason: String) {
        guard var record = read() else { return }
        record.cleanExit = true
        record.exitReason = reason
        write(record)
    }

    /// Crash reports for Dictate written after `since`, newest first.
    public static func crashReports(in dir: URL, since: Date) -> [URL] {
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        return files
            .filter { $0.lastPathComponent.hasPrefix("Dictate") && $0.pathExtension == "ips" }
            .compactMap { url -> (URL, Date)? in
                guard let date = try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate,
                      date > since else { return nil }
                return (url, date)
            }
            .sorted { $0.1 > $1.1 }
            .map(\.0)
    }

    private func read() -> RunRecord? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(RunRecord.self, from: data)
    }

    private func write(_ record: RunRecord) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(record) else { return }
        try? FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: fileURL, options: .atomic)
    }
}

public enum Instance {
    /// True when launchd started this process from Dictate's LaunchAgent (and will restart it if it dies).
    public static func isAgentLaunch(environment: [String: String]) -> Bool {
        environment["XPC_SERVICE_NAME"] == LaunchAgent.label
    }

    /// True when another copy of the app is already running.
    public static func isDuplicate(selfPID: Int32, runningPIDs: [Int32]) -> Bool {
        runningPIDs.contains { $0 != selfPID }
    }
}
