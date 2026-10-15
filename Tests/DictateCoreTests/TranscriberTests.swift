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

// Serialized: each test loads its own model and closes it, so the Metal device is never freed with a live context.
@Suite(.serialized, .enabled(if: modelPresent, "Whisper model not downloaded"))
struct TranscriberTests {
    @Test func transcribeAfterCloseThrows() async throws {
        let t = try Transcriber(modelURL: realModelURL)
        await t.close()
        await #expect(throws: TranscriberError.self) { try await t.transcribe(try loadFixture("hello"), vocabulary: []) }
    }

    @Test func transcribesFixture() async throws {
        let t = try Transcriber(modelURL: realModelURL)
        let text = try await t.transcribe(try loadFixture("hello"), vocabulary: [])
        await t.close()
        #expect(text.lowercased().contains("hello"))
    }

    @Test func chunksLongAudio() async throws {
        let t = try Transcriber(modelURL: realModelURL)
        let hello = try loadFixture("hello")
        // ~130 s: the greeting, then silence, then the greeting again past the 120 s chunking threshold.
        let gap = [Float](repeating: 0, count: 16000 * 128 - hello.count)
        let text = try await t.transcribe(hello + gap + hello, vocabulary: [])
        await t.close()
        #expect(text.lowercased().components(separatedBy: "hello").count - 1 >= 2)
    }
}
