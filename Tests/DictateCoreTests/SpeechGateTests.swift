import Foundation
import Testing
@testable import DictateCore

@Suite struct SpeechGateTests {
    func tone(seconds: Double, amplitude: Float = 0.2) -> [Float] {
        (0..<Int(seconds * 16000)).map { amplitude * sin(2 * .pi * 440 * Float($0) / 16000) }
    }

    @Test func silenceIsNotSpeech() { #expect(!SpeechGate.hasSpeech([Float](repeating: 0, count: 32000))) }
    @Test func lowNoiseIsNotSpeech() {
        #expect(!SpeechGate.hasSpeech((0..<32000).map { _ in Float.random(in: -0.003...0.003) }))
    }
    @Test func toneIsSpeech() { #expect(SpeechGate.hasSpeech(tone(seconds: 1))) }
    @Test func briefClickIsNotSpeech() {
        let silence = [Float](repeating: 0, count: 16000)
        #expect(!SpeechGate.hasSpeech(silence + tone(seconds: 0.1) + silence))
    }
}
