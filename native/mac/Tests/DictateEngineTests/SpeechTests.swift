import Foundation
import Testing
@testable import DictateCore
@testable import EngineKit

/// A `Recording` fake: `start()` is a no-op, `stop()` returns whatever the
/// test pre-loaded, so tests control exactly what "was recorded" without
/// touching the microphone.
private final class FakeRecording: Recording, @unchecked Sendable {
    var samplesToReturn: [Float] = []
    private(set) var startCount = 0
    private(set) var stopCount = 0

    func start() throws { startCount += 1 }

    func stop() -> [Float] {
        stopCount += 1
        return samplesToReturn
    }
}

/// A `Transcribing` fake that plays back a scripted sequence of results (one
/// per call), so tests can prove the retry-once behavior precisely: the Nth
/// call to `transcribe` returns `results[N-1]` (clamped to the last entry if
/// called more times than scripted).
private final class ScriptedTranscriber: Transcribing, @unchecked Sendable {
    private let lock = NSLock()
    private let results: [Result<String, Error>]
    private var calls = 0

    init(_ results: [Result<String, Error>]) {
        self.results = results
    }

    var callCount: Int { lock.withLock { calls } }

    func transcribe(_ samples: [Float], vocabulary: [String], language: String) async throws -> String {
        let index = lock.withLock { () -> Int in
            calls += 1
            return min(calls - 1, results.count - 1)
        }
        switch results[index] {
        case .success(let text): return text
        case .failure(let error): throw error
        }
    }
}

private struct FakeTranscribeError: Error {}

/// 0.5 s of a 440 Hz tone, loud enough to clear `SpeechGate`'s RMS floor.
private func speechLikeSamples() -> [Float] {
    (0..<8000).map { Float(sin(2.0 * .pi * 440.0 * Double($0) / 16000.0)) }
}

/// A `DownloadTransport` that's never expected to be called in these tests
/// (model readiness is injected directly via `installTranscriberForTesting`,
/// not through a real download — see that method's doc comment for why).
private struct UnusedDownloader: DownloadTransport {
    func download(_ url: URL, to destination: URL, progress: @Sendable (Double) -> Void) async throws {
        Issue.record("download should not have been called")
    }
}

private func makeSpeech(
    recorder: Recording,
    makeTranscriber: @escaping @Sendable (URL) throws -> Transcribing = { _ in ScriptedTranscriber([.success("")]) }
) -> Speech {
    Speech(
        recorder: recorder,
        modelDirectory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString),
        downloader: UnusedDownloader(),
        makeTranscriber: makeTranscriber,
        emit: { _ in }
    )
}

@Suite struct SpeechTests {
    @Test func silentBufferGivesNoSpeech() async throws {
        let recorder = FakeRecording()
        recorder.samplesToReturn = [Float](repeating: 0, count: 16000) // 1 s of silence
        let speech = makeSpeech(recorder: recorder)
        // No transcriber installed: proves the gate check happens before the
        // "is the model ready" check, per the brief ("stop returns noSpeech
        // when SpeechGate.hasSpeech is false; otherwise it transcribes").
        let outcome = try await speech.stop(language: "en", vocabulary: [])
        #expect(outcome.result == "noSpeech")
        #expect(outcome.text == nil)
    }

    @Test func transcriberThrowsOnceThenSucceeds() async throws {
        let recorder = FakeRecording()
        recorder.samplesToReturn = speechLikeSamples()
        let speech = makeSpeech(recorder: recorder)
        let transcriber = ScriptedTranscriber([.failure(FakeTranscribeError()), .success("hi")])
        speech.installTranscriberForTesting(transcriber)

        let outcome = try await speech.stop(language: "en", vocabulary: [])

        #expect(outcome.result == "text")
        #expect(outcome.text == "hi")
        #expect(transcriber.callCount == 2)
    }

    @Test func transcriberThatAlwaysThrowsFailsAfterExactlyTwoCalls() async throws {
        let recorder = FakeRecording()
        recorder.samplesToReturn = speechLikeSamples()
        let speech = makeSpeech(recorder: recorder)
        let transcriber = ScriptedTranscriber([.failure(FakeTranscribeError()), .failure(FakeTranscribeError())])
        speech.installTranscriberForTesting(transcriber)

        await #expect(throws: FakeTranscribeError.self) {
            _ = try await speech.stop(language: "en", vocabulary: [])
        }
        #expect(transcriber.callCount == 2)
    }

    @Test func stopBeforeModelReadyThrows() async throws {
        let recorder = FakeRecording()
        recorder.samplesToReturn = speechLikeSamples()
        let speech = makeSpeech(recorder: recorder) // no installTranscriberForTesting call
        await #expect(throws: (any Error).self) {
            _ = try await speech.stop(language: "en", vocabulary: [])
        }
    }

    @Test func cancelStopsRecordingWithoutTranscribing() throws {
        let recorder = FakeRecording()
        recorder.samplesToReturn = speechLikeSamples()
        let speech = makeSpeech(recorder: recorder)
        speech.cancel()
        #expect(recorder.stopCount == 1)
    }

    @Test func startStartsTheRecorder() throws {
        let recorder = FakeRecording()
        let speech = makeSpeech(recorder: recorder)
        try speech.start()
        #expect(recorder.startCount == 1)
    }
}
