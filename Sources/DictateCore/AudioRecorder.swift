@preconcurrency import AVFoundation

public protocol Recording: AnyObject {
    func start() throws
    func stop() -> [Float]
}

/// Captures the microphone as 16 kHz mono Float32, in memory only. Audio is never written to disk.
public final class AudioRecorder: Recording, @unchecked Sendable {
    public static let sampleRate = 16000.0
    public static let maxSeconds = 600.0

    // A fresh engine per recording picks up the current input device (e.g. AirPods connecting).
    private var engine: AVAudioEngine?
    private let lock = NSLock()
    private var samples: [Float] = []
    private let outputFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!

    public init() {}

    public func start() throws {
        lock.withLock { samples.removeAll(keepingCapacity: true) }
        teardown()
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard let converter = AVAudioConverter(from: inputFormat, to: outputFormat) else {
            throw NSError(domain: "Dictate", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported microphone format"])
        }
        input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
            self?.append(buffer, converter: converter)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            // Never leave a tap behind: a second installTap on the same bus is fatal.
            input.removeTap(onBus: 0)
            throw error
        }
        self.engine = engine
    }

    public func stop() -> [Float] {
        teardown()
        return lock.withLock {
            let out = samples
            samples.removeAll()
            return out
        }
    }

    private func teardown() {
        guard let engine else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        self.engine = nil
    }

    private func append(_ buffer: AVAudioPCMBuffer, converter: AVAudioConverter) {
        let ratio = outputFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { return }
        // The converter calls this synchronously; hand it the one buffer, then report no more data.
        let fed = Once()
        converter.convert(to: out, error: nil) { _, status in
            guard fed.claim() else { status.pointee = .noDataNow; return nil }
            status.pointee = .haveData
            return buffer
        }
        guard let channel = out.floatChannelData?[0] else { return }
        let maxSamples = Int(Self.sampleRate * Self.maxSeconds)
        lock.withLock {
            let room = maxSamples - samples.count
            guard room > 0 else { return }
            samples.append(contentsOf: UnsafeBufferPointer(start: channel, count: min(Int(out.frameLength), room)))
        }
    }
}
