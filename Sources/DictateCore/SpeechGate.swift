import Foundation

/// Cheap energy check so silence never reaches Whisper (which invents "Thank you." on empty audio).
public enum SpeechGate {
    static let frameSeconds = 0.03
    static let rmsThreshold: Float = 0.01
    static let minSpeechSeconds = 0.25

    public static func hasSpeech(_ samples: [Float], sampleRate: Double = 16000) -> Bool {
        let frame = max(1, Int(sampleRate * frameSeconds))
        let needed = Int((minSpeechSeconds / frameSeconds).rounded(.up))
        var loud = 0
        var start = 0
        while start < samples.count {
            let end = min(start + frame, samples.count)
            var sum: Float = 0
            for i in start..<end { sum += samples[i] * samples[i] }
            if (sum / Float(end - start)).squareRoot() > rmsThreshold {
                loud += 1
                if loud >= needed { return true }
            }
            start = end
        }
        return false
    }
}
