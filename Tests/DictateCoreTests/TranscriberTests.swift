import AVFoundation
import Foundation
import Testing
@testable import DictateCore

let realModelURL = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/Dictate/models/ggml-large-v3-turbo-q5_0.bin")
let modelPresent = FileManager.default.fileExists(atPath: realModelURL.path)

func loadFixture(_ name: String) throws -> [Float] {
    let url = try #require(Bundle.module.url(forResource: name, withExtension: "wav", subdirectory: "Fixtures"))
    let file = try AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false)
    let buffer = try #require(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)))
    try file.read(into: buffer)
    return Array(UnsafeBufferPointer(start: buffer.floatChannelData![0], count: Int(buffer.frameLength)))
}

/// Loads the model on a thread of its own: `whisper_init` holds its thread for a while, and on
/// Swift's cooperative pool (one thread per core) that would stall the other tests' async work.
func loadTranscriber() async throws -> Transcriber {
    try await onOwnThread { try Transcriber(modelURL: realModelURL) }
}

/// Runs the suites that use the real Whisper model one at a time, across both test targets (and
/// across `swift test` runs going at once). They share one GPU, and `AccuracyTests` times its
/// transcriptions: alone each takes about 0.3 s, but with the other model suites transcribing at
/// the same time its slowest went past the 1 s limit in about half of the full-suite runs.
/// The same type is in native/mac/Tests/DictateEngineTests/EngineFixtureTests.swift; a file lock is the one thing both test targets can share.
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

extension Transcriber {
    /// Runs on the actor's executor, so it reports the queue `transcribe` runs on.
    func executorQueueLabel() -> String { String(cString: __dispatch_queue_get_label(nil)) }
}

// Serialized: each test loads its own model and closes it, so the Metal device is never freed with a live context.
@Suite(.serialized, .enabled(if: modelPresent, "Whisper model not downloaded"), .oneModelSuiteAtATime)
struct TranscriberTests {
    @Test func transcribeAfterCloseThrows() async throws {
        let t = try await loadTranscriber()
        await t.close()
        await #expect(throws: TranscriberError.self) { try await t.transcribe(try loadFixture("hello"), vocabulary: []) }
    }

    @Test func transcribesFixture() async throws {
        let t = try await loadTranscriber()
        let text = try await t.transcribe(try loadFixture("hello"), vocabulary: [])
        await t.close()
        #expect(text.lowercased().contains("hello"))
    }

    @Test func transcribesSpokenLanguage() async throws {
        let t = try await loadTranscriber()
        let spanish = try loadFixture("spanish-1")
        let withCode = try await t.transcribe(spanish, vocabulary: [], language: "es").lowercased()
        let detected = try await t.transcribe(spanish, vocabulary: [], language: "auto").lowercased()
        let english = try await t.transcribe(try loadFixture("hello"), vocabulary: [], language: "auto").lowercased()
        await t.close()
        #expect(withCode.contains("mañana") && withCode.contains("reunión"), "\(withCode)")
        #expect(detected.contains("reunión"), "\(detected)")
        #expect(english.contains("hello"), "\(english)")
    }

    /// `whisper_full` waits on the GPU for most of a transcription. On Swift's cooperative pool
    /// (one thread per core) that wait would stall every other task, so the actor has its own queue.
    @Test func runsOffTheCooperativePool() async throws {
        let t = try await loadTranscriber()
        let label = await t.executorQueueLabel()
        await t.close()
        #expect(label == "com.leigh.dictate.transcriber")
    }

    @Test func chunksLongAudio() async throws {
        let t = try await loadTranscriber()
        let hello = try loadFixture("hello")
        // ~130 s: the greeting, then silence, then the greeting again past the 120 s chunking threshold.
        let gap = [Float](repeating: 0, count: 16000 * 128 - hello.count)
        let text = try await t.transcribe(hello + gap + hello, vocabulary: [])
        await t.close()
        #expect(text.lowercased().components(separatedBy: "hello").count - 1 >= 2)
    }
}
