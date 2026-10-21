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

@Suite(.serialized, .enabled(if: engineModelPresent, "Whisper model not downloaded"))
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
