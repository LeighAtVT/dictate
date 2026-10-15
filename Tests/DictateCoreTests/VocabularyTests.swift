import Foundation
import Testing
@testable import DictateCore

@Suite struct VocabularyTests {
    func tempFile() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("vocab-\(UUID().uuidString).txt")
    }

    @Test func vocabularySeedWhenMissing() {
        #expect(Vocabulary(fileURL: tempFile()).load() == Vocabulary.seed)
        #expect(Vocabulary.seed.contains("Supabase"))
    }

    @Test func vocabularyRoundTrip() throws {
        let v = Vocabulary(fileURL: tempFile())
        try v.save(["Priya", "Figma", "  ", "Design Team"])
        #expect(v.load() == ["Priya", "Figma", "Design Team"])
    }
}
