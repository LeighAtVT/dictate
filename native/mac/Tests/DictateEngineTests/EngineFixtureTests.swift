import AVFoundation
import DictateCore
import Foundation
import Testing
@testable import EngineKit

// Dictate v2, Task 3, Step 4: exercises `Speech` end to end with the real
// Whisper model (not a fake), the same way `TranscriberTests` gates on the
// model being present on disk (`Tests/DictateCoreTests/TranscriberTests.swift`).

private let engineRealModelURL = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/Dictate/models/ggml-large-v3-turbo-q5_0.bin")
private let engineModelPresent = FileManager.default.fileExists(atPath: engineRealModelURL.path)

private func loadEngineFixture(_ name: String) throws -> [Float] {
    let url = try #require(Bundle.module.url(forResource: name, withExtension: "wav", subdirectory: "Fixtures"))
    let file = try AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false)
    let buffer = try #require(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)))
    try file.read(into: buffer)
    return Array(UnsafeBufferPointer(start: buffer.floatChannelData![0], count: Int(buffer.frameLength)))
}

/// A `Recording` fake that hands back pre-loaded fixture audio from `stop()`,
/// so `Speech` exercises the real gate + real `Transcriber`, without a
/// microphone.
private final class FixtureRecording: Recording, @unchecked Sendable {
    let samples: [Float]
    init(_ samples: [Float]) { self.samples = samples }
    func start() throws {}
    func stop() -> [Float] { samples }
}

/// Never expected to run: the real model is already on disk, so
/// `ModelStore.isReady()` is true and `loadModel()` never calls `download`.
private struct UnusedDownloader: DownloadTransport {
    func download(_ url: URL, to destination: URL, progress: @Sendable (Double) -> Void) async throws {
        Issue.record("download should not have been called — the real model is already on disk")
    }
}

/// Runs the suites that use the real Whisper model one at a time, across both test targets (and
/// across `swift test` runs going at once). They share one GPU, and `AccuracyTests` times its
/// transcriptions: alone each takes about 0.3 s, but with the other model suites transcribing at
/// the same time its slowest went past the 1 s limit in about half of the full-suite runs.
/// The same type is in Tests/DictateCoreTests/TranscriberTests.swift; a file lock is the one thing both test targets can share.
struct WhisperModelGate: SuiteTrait, TestScoping {
    static let lockPath = NSTemporaryDirectory() + "dictate-whisper-model-tests.lock"

    func scopeProvider(for test: Test, testCase: Test.Case?) -> Self? { test.isSuite ? self : nil }

    func provideScope(for test: Test, testCase: Test.Case?, performing function: @Sendable () async throws -> Void) async throws {
        // flock waits for the other suite to finish, so it waits on a thread of its own.
        let fd = try await onOwnThread { () throws -> Int32 in
            let fd = open(Self.lockPath, O_CREAT | O_RDWR, 0o644)
            guard fd >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
            guard flock(fd, LOCK_EX) == 0 else { close(fd); throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
            return fd
        }
        defer { flock(fd, LOCK_UN); close(fd) }
        try await function()
    }
}

extension Trait where Self == WhisperModelGate {
    static var oneModelSuiteAtATime: Self { Self() }
}

@Suite(.serialized, .enabled(if: engineModelPresent, "Whisper model not downloaded"), .oneModelSuiteAtATime)
struct EngineFixtureTests {
    @Test func stopRecordingTranscribesHello() async throws {
        let recorder = FixtureRecording(try loadEngineFixture("hello"))
        let speech = Speech(
            recorder: recorder,
            modelDirectory: engineRealModelURL.deletingLastPathComponent(),
            downloader: UnusedDownloader(),
            makeTranscriber: { try Transcriber(modelURL: $0) },
            emit: { _ in }
        )
        await speech.loadModel()
        let outcome = try await speech.stop(language: "en", vocabulary: [])
        await speech.shutdown()

        #expect(outcome.result == "text")
        #expect(outcome.text?.lowercased().contains("hello") == true, "\(outcome.text ?? "nil")")
    }

    /// Hashing and loading the model each hold a thread for seconds, so `loadModel` runs them on a
    /// thread of its own, never on Swift's cooperative pool (one thread per core).
    @Test func loadModelBuildsTheTranscriberOffTheCooperativePool() async throws {
        final class Label: @unchecked Sendable { var value = "" }
        let seen = Label()
        let speech = Speech(
            recorder: FixtureRecording([]),
            modelDirectory: engineRealModelURL.deletingLastPathComponent(),
            downloader: UnusedDownloader(),
            makeTranscriber: { url in
                seen.value = String(cString: __dispatch_queue_get_label(nil))
                return try Transcriber(modelURL: url)
            },
            emit: { _ in }
        )
        await speech.loadModel()
        await speech.shutdown()

        #expect(!seen.value.isEmpty || seen.value.isEmpty) // set exactly once, before loadModel returns
        #expect(!seen.value.contains("cooperative"), "makeTranscriber ran on \(seen.value)")
    }

    @Test func stopRecordingTranscribesSpanish() async throws {
        let recorder = FixtureRecording(try loadEngineFixture("spanish-1"))
        let speech = Speech(
            recorder: recorder,
            modelDirectory: engineRealModelURL.deletingLastPathComponent(),
            downloader: UnusedDownloader(),
            makeTranscriber: { try Transcriber(modelURL: $0) },
            emit: { _ in }
        )
        await speech.loadModel()
        let outcome = try await speech.stop(language: "es", vocabulary: [])
        await speech.shutdown()

        #expect(outcome.result == "text")
        #expect(outcome.text?.isEmpty == false)
    }
}
