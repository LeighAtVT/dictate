import Foundation
import whisper

public protocol Transcribing: Sendable {
    func transcribe(_ samples: [Float], vocabulary: [String]) async throws -> String
}

public struct TranscriberError: Error, CustomStringConvertible {
    public let description: String

    public init(description: String) {
        self.description = description
    }
}

/// Local Whisper transcription. The model is loaded once and stays warm.
public actor Transcriber: Transcribing {
    static let sampleRate = 16000
    static let chunkThresholdSeconds = 120
    static let chunkSeconds = 30
    static let overlapSeconds = 1

    // Freed in close(); ggml aborts at process exit if a context outlives its Metal device.
    private nonisolated(unsafe) var ctx: OpaquePointer?

    public init(modelURL: URL) throws {
        var params = whisper_context_default_params()
        params.use_gpu = true
        guard let ctx = whisper_init_from_file_with_params(modelURL.path, params) else {
            throw TranscriberError(description: "Could not load the Whisper model")
        }
        self.ctx = ctx
    }

    deinit { if let ctx { whisper_free(ctx) } }

    /// Unloads the model. Call before the process exits.
    public func close() {
        if let ctx { whisper_free(ctx) }
        ctx = nil
    }

    public func transcribe(_ samples: [Float], vocabulary: [String]) async throws -> String {
        guard ctx != nil else { throw TranscriberError(description: "Whisper model is not loaded") }
        let prompt = vocabulary.joined(separator: ", ")
        var parts: [String] = []
        for chunk in Self.chunks(samples) where SpeechGate.hasSpeech(chunk) {
            let text = try run(chunk, prompt: prompt)
            if !text.isEmpty { parts.append(text) }
        }
        return parts.joined(separator: " ")
    }

    /// Whole buffer when short; otherwise 30 s windows overlapping by 1 s.
    static func chunks(_ samples: [Float]) -> [[Float]] {
        guard samples.count > chunkThresholdSeconds * sampleRate else { return [samples] }
        let size = chunkSeconds * sampleRate
        let step = size - overlapSeconds * sampleRate
        return stride(from: 0, to: samples.count, by: step).map { Array(samples[$0..<min($0 + size, samples.count)]) }
    }

    private func run(_ samples: [Float], prompt: String) throws -> String {
        guard let ctx else { throw TranscriberError(description: "Whisper model is not loaded") }
        var params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY)
        params.no_timestamps = true
        params.print_progress = false
        params.print_realtime = false
        params.print_special = false
        params.print_timestamps = false
        params.single_segment = false
        params.suppress_nst = true // fewer "[BLANK_AUDIO]"-style tokens
        params.n_threads = Int32(max(1, min(8, ProcessInfo.processInfo.activeProcessorCount - 2)))

        let status: Int32 = "en".withCString { lang in
            prompt.withCString { promptPtr in
                params.language = lang
                params.initial_prompt = prompt.isEmpty ? nil : promptPtr
                return samples.withUnsafeBufferPointer { buf in
                    whisper_full(ctx, params, buf.baseAddress, Int32(buf.count))
                }
            }
        }
        guard status == 0 else { throw TranscriberError(description: "Whisper failed (\(status))") }

        return (0..<whisper_full_n_segments(ctx))
            .compactMap { whisper_full_get_segment_text(ctx, $0).map { String(cString: $0) } }
            .joined()
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
