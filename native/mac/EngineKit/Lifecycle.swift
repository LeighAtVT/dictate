import Foundation

// Dictate v2, Task 3 fix round 1: the engine has two shutdown paths — the
// `quit` op's handler, and stdin hitting EOF (the brain's pipe closed some
// other way) — and both must free the Whisper model before the process
// exits (ggml aborts at exit if a context is still alive) without dropping
// any reply that's about to be written. They share this one routine so they
// can't diverge again the way the `quit` handler did in review round 1: it
// scheduled `exit` 200 ms out *before* awaiting shutdown, so a shutdown that
// took longer than 200 ms (e.g. a transcription in flight, whose
// `Transcriber` actor `close()` queues behind) let the timer fire first,
// killing the process mid-shutdown and dropping the `quit` reply.

/// Awaits `shutdown` to full completion, *then* schedules `exit` after
/// `gracePeriod` (via `queue`, so a caller already serializing stdout writes
/// through that same queue — see `main.swift`'s `outputQueue` — gets that
/// window to flush a reply written right after this function returns).
///
/// The ordering is the whole point: `shutdown` finishing is a precondition
/// for scheduling `exit` at all, not just something hoped to win a race
/// against a fixed timer.
public func shutdownThenExit(
    shutdown: @Sendable () async -> Void,
    gracePeriod: TimeInterval = 0.2,
    queue: DispatchQueue,
    exit: @escaping @Sendable (Int32) -> Void,
    code: Int32 = 0
) async {
    await shutdown()
    queue.asyncAfter(deadline: .now() + gracePeriod) {
        exit(code)
    }
}
