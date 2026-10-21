import Foundation
import Testing
@testable import EngineKit

/// Thread-safe sink for lines `Server` writes via its `output` closure.
/// `Server` dispatches each request in its own `Task`, so multiple handlers
/// can call `output` concurrently.
private final class LineSink: @unchecked Sendable {
    private let lock = NSLock()
    private var _lines: [String] = []

    func add(_ line: String) { lock.withLock { _lines.append(line) } }
    var lines: [String] { lock.withLock { _lines } }
}

/// Decodes the handful of fields these tests need from a reply/log line
/// without depending on `EngineReply`'s own encoding (so a bug there
/// wouldn't mask a bug in `Server`'s dispatch).
private struct DecodedLine {
    let reply: Int?
    let ok: Bool?
    let error: String?
    let event: String?

    init(_ line: String) {
        let object = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any] ?? [:]
        reply = object["reply"] as? Int
        ok = object["ok"] as? Bool
        error = object["error"] as? String
        event = object["event"] as? String
    }
}

private func requestLine(id: Int, op: String) -> String {
    "{\"id\":\(id),\"op\":\"\(op)\"}"
}

@Suite struct ServerTests {
    @Test func slowHandlerDoesNotDelayAnotherOpsReply() async throws {
        let sink = LineSink()
        let server = Server(
            output: { sink.add($0) },
            handlers: Handlers(
                context: {
                    try await Task.sleep(for: .seconds(1))
                    return [:]
                },
                selection: { [:] }
            )
        )

        server.receive(requestLine(id: 1, op: "context"))
        server.receive(requestLine(id: 2, op: "selection"))

        // Op 2 (selection) should reply quickly, well before op 1's 1 s sleep elapses.
        try await Task.sleep(for: .milliseconds(200))
        let repliesSoFar = sink.lines.map(DecodedLine.init)
        #expect(repliesSoFar.contains { $0.reply == 2 && $0.ok == true })
        #expect(!repliesSoFar.contains { $0.reply == 1 })

        // Op 1 eventually replies too, once its sleep completes.
        try await Task.sleep(for: .milliseconds(1000))
        let allReplies = sink.lines.map(DecodedLine.init)
        #expect(allReplies.contains { $0.reply == 1 && $0.ok == true })
    }

    @Test func unknownOpGivesOneErrorReply() async throws {
        let sink = LineSink()
        let server = Server(output: { sink.add($0) }, handlers: Handlers())

        server.receive(requestLine(id: 7, op: "bogus"))

        // Unknown op is detected during decode, synchronously, before any Task
        // is spawned — no delay needed before asserting.
        let lines = sink.lines.map(DecodedLine.init)
        #expect(lines.count == 1)
        #expect(lines[0].reply == 7)
        #expect(lines[0].ok == false)
        #expect(lines[0].error == "unknown op")
    }

    @Test func malformedJSONProducesLogEventAndNoReply() async throws {
        let sink = LineSink()
        let server = Server(output: { sink.add($0) }, handlers: Handlers())

        server.receive("not json at all")

        let lines = sink.lines.map(DecodedLine.init)
        #expect(lines.count == 1)
        #expect(lines[0].event == "log")
        #expect(lines[0].reply == nil)
    }

    @Test func eachRequestGetsExactlyOneReply() async throws {
        let sink = LineSink()
        let server = Server(
            output: { sink.add($0) },
            handlers: Handlers(
                startRecording: { [:] },
                cancelRecording: { throw TestError() },
                context: { [:] }
            )
        )

        server.receive(requestLine(id: 1, op: "startRecording"))
        server.receive(requestLine(id: 2, op: "cancelRecording"))
        server.receive(requestLine(id: 3, op: "context"))
        server.receive(requestLine(id: 4, op: "bogus"))

        try await Task.sleep(for: .milliseconds(200))
        let replies = sink.lines.map(DecodedLine.init).filter { $0.reply != nil }
        let ids = replies.compactMap(\.reply)
        #expect(Set(ids) == [1, 2, 3, 4])
        #expect(ids.count == 4) // exactly one reply per id, no duplicates
        #expect(replies.first { $0.reply == 1 }?.ok == true)
        #expect(replies.first { $0.reply == 2 }?.ok == false)
        #expect(replies.first { $0.reply == 3 }?.ok == true)
        #expect(replies.first { $0.reply == 4 }?.ok == false)
    }
}

private struct TestError: Error {}
