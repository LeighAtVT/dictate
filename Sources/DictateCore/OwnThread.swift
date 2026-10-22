import Foundation

/// Runs `work` on a new thread of its own and resumes the caller with its result or error.
///
/// For calls that hold their thread for a long or unbounded time: a Keychain read waiting on an
/// unlock or "allow access" prompt, hashing the 574 MB Whisper model, or loading it.
/// `Task.detached` isn't enough. It still runs on Swift's cooperative thread pool, which has only
/// one thread per CPU core, so a call like that stalls every other task's async work until it
/// returns. These calls are rare (a few per launch, plus Settings), so a thread per call costs
/// nothing that matters.
public func onOwnThread<T: Sendable>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
    try await withCheckedThrowingContinuation { continuation in
        Thread { continuation.resume(with: Result { try work() }) }.start()
    }
}

/// The non-throwing form of `onOwnThread(_:)`.
public func onOwnThread<T: Sendable>(_ work: @escaping @Sendable () -> T) async -> T {
    await withCheckedContinuation { continuation in
        Thread { continuation.resume(returning: work()) }.start()
    }
}
