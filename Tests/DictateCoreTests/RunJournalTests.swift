import Foundation
import Testing
@testable import DictateCore

private func tempDir() -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("rj-\(UUID().uuidString)")
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

@Suite struct RunJournalTests {
    let dir = tempDir()
    var journal: RunJournal { RunJournal(fileURL: dir.appendingPathComponent("run.json")) }

    @Test func firstLaunchHasNoPrevious() {
        #expect(journal.begin(pid: 1, now: Date()) == nil)
    }

    @Test func uncleanPreviousIsReported() {
        let first = Date(timeIntervalSince1970: 1_000)
        _ = journal.begin(pid: 11, now: first)
        let previous = journal.begin(pid: 12, now: Date())
        #expect(previous?.pid == 11)
        #expect(previous?.cleanExit == false)
        #expect(previous?.launchedAt == first)
    }

    @Test func cleanPreviousIsNotReported() throws {
        _ = journal.begin(pid: 11, now: Date())
        journal.markClean(reason: "quit")
        let data = try Data(contentsOf: dir.appendingPathComponent("run.json"))
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        #expect(try decoder.decode(RunRecord.self, from: data).exitReason == "quit")
        #expect(journal.begin(pid: 12, now: Date()) == nil)
    }

    @Test func crashReportsFiltersByNameAndDate() throws {
        let since = Date(timeIntervalSinceNow: -60)
        let fm = FileManager.default
        for name in ["Dictate-2026-10-15.ips", "Dictate-old.ips", "Other.ips"] {
            fm.createFile(atPath: dir.appendingPathComponent(name).path, contents: Data("x".utf8))
        }
        try fm.setAttributes([.modificationDate: Date(timeIntervalSinceNow: -3600)],
                             ofItemAtPath: dir.appendingPathComponent("Dictate-old.ips").path)
        let found = RunJournal.crashReports(in: dir, since: since).map(\.lastPathComponent)
        #expect(found == ["Dictate-2026-10-15.ips"])
    }

    @Test func logRotatesAtLimit() throws {
        let url = dir.appendingPathComponent("logs/dictate.log")
        let log = EventLog(fileURL: url, maxBytes: 100)
        let message = String(repeating: "m", count: 40)
        for _ in 0..<5 { log.write(message) }
        let fm = FileManager.default
        #expect(fm.fileExists(atPath: url.path + ".1"))
        let size = try fm.attributesOfItem(atPath: url.path)[.size] as? Int ?? 0
        #expect(size < 100)
        let lines = try String(contentsOf: url, encoding: .utf8).split(separator: "\n")
        #expect(!lines.isEmpty && lines.allSatisfy { $0.hasSuffix(message) })
    }

    @Test func isDuplicateInstance() {
        #expect(Instance.isDuplicate(selfPID: 5, runningPIDs: [5]) == false)
        #expect(Instance.isDuplicate(selfPID: 5, runningPIDs: [5, 9]) == true)
        #expect(Instance.isDuplicate(selfPID: 5, runningPIDs: []) == false)
    }
}
