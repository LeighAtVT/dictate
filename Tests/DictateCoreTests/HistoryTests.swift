import Foundation
import Testing
@testable import DictateCore

final class Clock: @unchecked Sendable {
    var now = Date(timeIntervalSince1970: 1_800_000_000)
}

@Suite struct HistoryTests {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("history-\(UUID().uuidString).json")
    let clock = Clock()

    func history() -> History { History(fileURL: file, now: { [clock] in clock.now }) }
    func entry(_ n: Int, at date: Date? = nil) -> HistoryEntry {
        HistoryEntry(date: date ?? clock.now, bundleID: "app", raw: "raw \(n)", final: "final \(n)")
    }

    @Test func capsAtFifty() {
        let h = history()
        for i in 0..<55 { clock.now += 1; h.add(entry(i)) }
        let recent = h.recent()
        #expect(recent.count == 50)
        #expect(recent.last?.raw == "raw 5")
    }

    @Test func prunesOlderThanSevenDays() {
        let h = history()
        h.add(entry(1, at: clock.now - 8 * 86_400))
        h.add(entry(2))
        #expect(h.recent().map(\.raw) == ["raw 2"])
    }

    @Test func persistsAcrossInstances() {
        history().add(entry(1))
        #expect(history().recent().map(\.raw) == ["raw 1"])
    }

    @Test func newestFirst() {
        let h = history()
        h.add(entry(1)); clock.now += 1; h.add(entry(2))
        #expect(h.recent().map(\.raw) == ["raw 2", "raw 1"])
    }

    @Test func corruptFileStartsEmpty() throws {
        try Data("not json".utf8).write(to: file)
        #expect(history().recent().isEmpty)
    }
}
