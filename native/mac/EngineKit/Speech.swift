import DictateCore
import Foundation

// Dictate v2, Task 3: the engine's speech pipeline — record, gate out
// silence, warm the Whisper model, and transcribe. Mirrors the shape of v1's
// `AppDelegate.loadModel()`/`LazyTranscriber` (model loads once and stays
// warm) and `Pipeline`'s stop-and-transcribe step, but speaks `EngineEvent`s
// instead of driving a status item directly.

public struct SpeechError: Error, CustomStringConvertible {
    public let description: String
}

/// Records audio, gates out silence, and transcribes with a warm Whisper
/// model, reporting model lifecycle via `emit`. `makeTranscriber` builds the
/// real `Transcriber` only once the model file is verified on disk — see
/// `ModelStore.ensureModel` — so it's injected (rather than taking a
/// `Transcribing` directly) both for that ordering and so tests can supply a
/// fake.
public final class Speech: @unchecked Sendable {
    private let recorder: Recording
    private let modelDirectory: URL
    private let downloader: DownloadTransport
    private let makeTranscriber: @Sendable (URL) throws -> Transcribing
    private let emit: @Sendable (EngineEvent) -> Void

    private let lock = NSLock()
    private var transcriber: Transcribing?

    public init(
        recorder: Recording,
        modelDirectory: URL,
        downloader: DownloadTransport,
        makeTranscriber: @escaping @Sendable (URL) throws -> Transcribing,
        emit: @escaping @Sendable (EngineEvent) -> Void
    ) {
        self.recorder = recorder
        self.modelDirectory = modelDirectory
        self.downloader = downloader
        self.makeTranscriber = makeTranscriber
        self.emit = emit
    }

    // MARK: Model

    /// Downloads the model if needed (emitting `downloading` progress), then
    /// builds the transcriber and emits `loading` → `ready`, or `failed` if
    /// either step throws. Safe to call once at startup; `stop()` reports a
    /// clear error if called before this finishes.
    public func loadModel() async {
        let store = ModelStore(directory: modelDirectory, spec: .largeV3TurboQ5, downloader: downloader)
        do {
            if !store.isReady() {
                emit(.model(state: .downloading, fraction: 0))
                try await store.ensureModel { [emit] fraction in emit(.model(state: .downloading, fraction: fraction)) }
            }
            emit(.model(state: .loading, fraction: nil))
            let loaded = try makeTranscriber(store.modelURL)
            lock.withLock { transcriber = loaded }
            emit(.model(state: .ready, fraction: nil))
        } catch {
            emit(.model(state: .failed, fraction: nil))
        }
    }

    /// Test seam: installs a transcriber directly, bypassing `loadModel()`'s
    /// real `ModelStore` download/verification. `loadModel()` always
    /// verifies against the real `ModelSpec.largeV3TurboQ5` (a fixed 574 MB
    /// file with a fixed SHA-256), which a fake download in a unit test
    /// can't satisfy — so tests that only care about `stop()`'s retry logic
    /// install a fake `Transcribing` here instead of exercising the real
    /// model pipeline. Internal (not `public`): only `@testable import
    /// EngineKit` can reach it.
    func installTranscriberForTesting(_ transcriber: Transcribing) {
        lock.withLock { self.transcriber = transcriber }
    }

    // MARK: Recording

    public func start() throws {
        try recorder.start()
    }

    /// Stops recording and discards the audio without transcribing.
    public func cancel() {
        _ = recorder.stop()
    }

    /// Stops recording and, if the buffer has speech, transcribes it with
    /// the warm model (retrying once on a thrown error — spec section 4 —
    /// before letting the second error propagate). The gate check happens
    /// before the model-readiness check, so a silent buffer returns
    /// `noSpeech` even if the model is still loading.
    public func stop(language: String, vocabulary: [String]) async throws -> (result: String, text: String?, seconds: Double) {
        let samples = recorder.stop()
        guard SpeechGate.hasSpeech(samples) else {
            return (result: "noSpeech", text: nil, seconds: 0)
        }
        guard let transcriber = lock.withLock({ transcriber }) else {
            throw SpeechError(description: "Speech model is not ready")
        }
        let started = Date()
        let text: String
        do {
            text = try await transcriber.transcribe(samples, vocabulary: vocabulary, language: language)
        } catch {
            // Retry once (spec section 4: "Transcription fails: the engine
            // retries once, then reports recordingFailed"). A second failure
            // propagates to the caller uncaught.
            text = try await transcriber.transcribe(samples, vocabulary: vocabulary, language: language)
        }
        return (result: "text", text: text, seconds: Date().timeIntervalSince(started))
    }

    /// Unloads the model so the process can exit cleanly. ggml aborts at
    /// process exit if a Whisper context outlives it (see
    /// `Transcriber.close()` and `AppDelegate.applicationShouldTerminate`),
    /// so this must be awaited before the engine calls `exit`.
    public func shutdown() async {
        let current = lock.withLock { transcriber }
        if let real = current as? Transcriber {
            await real.close()
        }
    }
}
