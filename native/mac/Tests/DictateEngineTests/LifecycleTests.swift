import Foundation
import Testing
@testable import EngineKit

// Dictate v2, Task 3 fix round 1: `shutdownThenExit` is the one routine the
// engine's two shutdown paths (the `quit` op, stdin EOF) share, so they
// can't diverge into one exiting before cleanup finishes and the other not
// (that divergence was the Critical review finding — see task-3-report.md).

/// Thread-safe sink for lines written via `Server`'s `output` closure.
private final class LineSink: @unchecked Sendable {
    private let lock = NSLock()
    private var _lines: [String] = []

    func add(_ line: String) { lock.withLock { _lines.append(line) } }
    var lines: [String] { lock.withLock { _lines } }
}

private struct DecodedLine {
    let reply: Int?
    let ok: Bool?

    init(_ line: String) {
        let object = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any] ?? [:]
        reply = object["reply"] as? Int
        ok = object["ok"] as? Bool
    }
}

/// Records every `exit` call (code + elapsed time since construction), so
/// tests can assert ordering without actually terminating the process.
private final class ExitRecorder: @unchecked Sendable {
    struct Call { let code: Int32; let elapsed: TimeInterval }
    private let lock = NSLock()
    private let start = Date()
    private var _calls: [Call] = []

    func record(_ code: Int32) {
        lock.withLock { _calls.append(Call(code: code, elapsed: Date().timeIntervalSince(start))) }
    }

    var calls: [Call] { lock.withLock { _calls } }
}

@Suite struct LifecycleTests {
    @Test func exitWaitsForShutdownToCompleteFirst() async throws {
        let exitRecorder = ExitRecorder()
        let queue = DispatchQueue(label: "test.shutdownThenExit")

        Task {
            await shutdownThenExit(
                shutdown: { try? await Task.sleep(for: .milliseconds(500)) },
                gracePeriod: 0.05,
                queue: queue,
                exit: { exitRecorder.record($0) }
            )
        }

        // Still well inside the 500 ms fake shutdown: exit must not have fired.
        try await Task.sleep(for: .milliseconds(250))
        #expect(exitRecorder.calls.isEmpty)

        // Shutdown (500 ms) + grace period (50 ms) + margin: exit should have
        // fired exactly once, strictly after the shutdown duration.
        try await Task.sleep(for: .milliseconds(500))
        #expect(exitRecorder.calls.count == 1)
        #expect(exitRecorder.calls.first?.code == 0)
        #expect((exitRecorder.calls.first?.elapsed ?? 0) >= 0.5)
    }

    /// Reproduces the exact failure mode the review flagged: a `quit` request
    /// whose shutdown work is slow (as it would be with a transcription in
    /// flight) must still get exactly one reply, and the process must not be
    /// torn down (here: `exit` not called) until that shutdown finishes.
    @Test func quitHandlerRepliesExactlyOnceAndWaitsForShutdownBeforeExiting() async throws {
        let sink = LineSink()
        let exitRecorder = ExitRecorder()
        let queue = DispatchQueue(label: "test.quitHandler")

        let server = Server(
            output: { sink.add($0) },
            handlers: Handlers(
                quit: {
                    await shutdownThenExit(
                        shutdown: { try? await Task.sleep(for: .milliseconds(500)) },
                        gracePeriod: 0.05,
                        queue: queue,
                        exit: { exitRecorder.record($0) }
                    )
                    return [:]
                }
            )
        )

        server.receive("{\"id\":1,\"op\":\"quit\"}")

        // Mid-shutdown: no reply yet (the handler hasn't returned), and no exit.
        try await Task.sleep(for: .milliseconds(200))
        #expect(sink.lines.isEmpty)
        #expect(exitRecorder.calls.isEmpty)

        // After shutdown + grace + margin: exactly one reply, exactly one exit call.
        try await Task.sleep(for: .milliseconds(600))
        let replies = sink.lines.map(DecodedLine.init).filter { $0.reply == 1 }
        #expect(replies.count == 1)
        #expect(replies.first?.ok == true)
        #expect(exitRecorder.calls.count == 1)
        #expect((exitRecorder.calls.first?.elapsed ?? 0) >= 0.5)
    }
}
