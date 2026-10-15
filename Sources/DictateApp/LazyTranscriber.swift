import DictateCore
import Foundation

/// Stands in for the Whisper transcriber until the model has downloaded and loaded.
final class LazyTranscriber: Transcribing, @unchecked Sendable {
    private let lock = NSLock()
    private var loaded: Transcriber?

    func set(_ transcriber: Transcriber) {
        lock.withLock { loaded = transcriber }
    }

    var isLoaded: Bool { lock.withLock { loaded != nil } }

    func transcribe(_ samples: [Float], vocabulary: [String], language: String) async throws -> String {
        let t = lock.withLock { loaded }
        guard let t else { throw TranscriberError(description: "The speech model is still downloading") }
        return try await t.transcribe(samples, vocabulary: vocabulary, language: language)
    }

    func close() async {
        let t: Transcriber? = lock.withLock { defer { loaded = nil }; return loaded }
        await t?.close()
    }
}
