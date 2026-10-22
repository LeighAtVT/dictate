import Foundation
import Testing
@testable import DictateCore

/// Real-model check that the vocabulary prompt gets custom terms spelled right, plus a latency report.
@Suite(.serialized, .enabled(if: modelPresent, "Whisper model not downloaded"), .oneModelSuiteAtATime)
struct AccuracyTests {
    static let cases: [(fixture: String, terms: [String])] = [
        ("vocab-1", ["Priya", "Supabase"]),
        ("vocab-2", ["Jira", "PostgreSQL"]),
        ("vocab-3", ["Figma", "GitHub"]),
        ("vocab-4", ["OpenRouter", "Kubernetes"]),
        ("vocab-5", ["Slack", "Priya", "GitHub"]),
    ]

    @Test func vocabularyTermsSpelledCorrectly() async throws {
        let t = try await loadTranscriber()
        var times: [TimeInterval] = []
        for c in Self.cases {
            let samples = try loadFixture(c.fixture)
            let start = Date()
            // Same as the pipeline: Whisper with the vocabulary prompt, then exact-casing fixes.
            let text = LocalCleaner.applyVocabulary(try await t.transcribe(samples, vocabulary: Vocabulary.seed), terms: Vocabulary.seed)
            times.append(Date().timeIntervalSince(start))
            for term in c.terms {
                #expect(text.contains(term), "\(c.fixture): expected \"\(term)\" in \"\(text)\"")
            }
        }
        await t.close()
        times.sort()
        let p50 = times[times.count / 2], p90 = times[min(times.count - 1, Int(Double(times.count) * 0.9))]
        print(String(format: "ACCURACY transcribe p50=%.2fs p90=%.2fs", p50, p90))
        #expect(p90 < 1.0)
    }
}
