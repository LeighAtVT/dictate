import Testing
@testable import DictateCore

@Suite struct LocalCleanerTests {
    @Test func stripsFillers() { #expect(LocalCleaner.clean("Um, so I think, uh, we ship it.") == "So I think we ship it.") }
    @Test func collapsesStutters() { #expect(LocalCleaner.clean("I I think the the queue cleared.") == "I think the queue cleared.") }
    @Test func keepsMeaningfulLike() { #expect(LocalCleaner.clean("I like the new plan.") == "I like the new plan.") }
    @Test func dropsFillerLike() { #expect(LocalCleaner.clean("It was, like, really fast.") == "It was really fast.") }
    @Test func trimsAndRecapitalizes() { #expect(LocalCleaner.clean("  uh hello there  ") == "Hello there") }
    @Test func emptyStaysEmpty() { #expect(LocalCleaner.clean("um uh") == "") }
}

@Suite struct VocabularyCasingTests {
    @Test func fixesCasingOfVocabularyTerms() {
        #expect(LocalCleaner.applyVocabulary("File it in JIRA for the design team", terms: ["Jira", "Design Team"]) == "File it in Jira for the Design Team")
    }
    @Test func onlyWholeWords() {
        #expect(LocalCleaner.applyVocabulary("The figma-looking figmaish thing", terms: ["Figma"]) == "The Figma-looking figmaish thing")
    }
    @Test func emptyTermsIsNoOp() {
        #expect(LocalCleaner.applyVocabulary("hello", terms: ["", "  "]) == "hello")
    }
}
