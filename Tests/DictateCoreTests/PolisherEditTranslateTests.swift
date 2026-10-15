import Foundation
import Testing
@testable import DictateCore

private func messages(_ t: StubTransport) throws -> [[String: String]] {
    let body = try #require(t.lastRequest?.httpBody)
    let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
    return try #require(json["messages"] as? [[String: String]])
}

@Suite struct PolisherTranslateTests {
    func polisher(_ t: StubTransport, translateTimeout: TimeInterval = 4) -> Polisher {
        Polisher(transport: t, apiKey: { "k" }, model: "m", translateTimeout: translateTimeout)
    }

    @Test func samePromptForbidsTranslation() {
        #expect(Polisher.systemPrompt(style: .slack, vocabulary: [], output: .same)
            .contains("Keep the text in its original language; never translate."))
    }

    @Test func languagePromptAsksForTranslation() {
        #expect(Polisher.systemPrompt(style: .slack, vocabulary: [], output: .language("English"))
            .contains("Write the result in English, translating if needed."))
    }

    @Test func rawAppsTranslateFaithfully() async throws {
        let t = StubTransport(reply: "Deploy tomorrow.")
        let out = await polisher(t).polish("despliega mañana", style: .raw, vocabulary: [], output: .language("English"))
        #expect(out == "Deploy tomorrow.")
        #expect(try messages(t)[0]["content"]?.contains("Translate faithfully; do not restyle.") == true)
    }

    @Test func rawWithoutTranslationSendsNothing() async {
        let t = StubTransport(reply: "x")
        #expect(await polisher(t).polish("hola", style: .raw, vocabulary: [], output: .same) == nil)
        #expect(t.calls == 0)
    }

    @Test func offNeverSends() async {
        let t = StubTransport(reply: "x")
        #expect(await polisher(t).polish("hola", style: .off, vocabulary: [], output: .language("English")) == nil)
        #expect(t.calls == 0)
    }

    @Test func translationSkipsWordRatio() async {
        let t = StubTransport(reply: "We have a meeting with the sales team tomorrow at three.")
        let out = await polisher(t).polish("明日三時に営業会議", style: .docs, vocabulary: [], output: .language("English"))
        #expect(out == "We have a meeting with the sales team tomorrow at three.")
    }

    @Test func translationUsesItsOwnTimeout() async {
        let t = StubTransport(reply: "Hello there.")
        t.delay = 3
        #expect(await polisher(t, translateTimeout: 4).polish("hola", style: .docs, vocabulary: [], output: .language("English")) == "Hello there.")
        #expect(await polisher(t, translateTimeout: 1).polish("hola", style: .docs, vocabulary: [], output: .language("English")) == nil)
    }
}

@Suite struct PolisherEditTests {
    func polisher(_ t: StubTransport, key: String? = "k", editTimeout: TimeInterval = 8) -> Polisher {
        Polisher(transport: t, apiKey: { key }, model: "m", editTimeout: editTimeout)
    }

    let text = "Hey team, I wanted to let you all know that the release is going to be delayed until next week because of a bug."

    @Test func sendsInstructionAndText() async throws {
        let t = StubTransport(reply: "Release slips to next week (bug).")
        let out = await polisher(t).edit(text, instruction: "shorten it", vocabulary: ["Figma"])
        #expect(out == "Release slips to next week (bug).") // far shorter than the input: no ratio check
        let m = try messages(t)
        #expect(m[0]["content"]?.contains("Apply the instruction to the text") == true)
        #expect(m[0]["content"]?.contains("Figma") == true)
        #expect(m[1]["content"] == "Instruction: shorten it\n\nText:\n\(text)")
    }

    @Test func stripsLeadIn() async {
        let t = StubTransport(reply: "Here's the rewritten text: Release slips a week.")
        #expect(await polisher(t).edit(text, instruction: "shorten it", vocabulary: []) == "Release slips a week.")
    }

    @Test func failuresReturnNil() async {
        let t = StubTransport(reply: "x")
        t.status = 500
        #expect(await polisher(t).edit(text, instruction: "shorten", vocabulary: []) == nil)
        #expect(await polisher(StubTransport(reply: "  "), key: "k").edit(text, instruction: "shorten", vocabulary: []) == nil)
        #expect(await polisher(StubTransport(reply: "x"), key: nil).edit(text, instruction: "shorten", vocabulary: []) == nil)
    }

    @Test func usesEditTimeout() async {
        let t = StubTransport(reply: "Short.")
        t.delay = 3
        #expect(await polisher(t, editTimeout: 8).edit(text, instruction: "shorten", vocabulary: []) == "Short.")
        #expect(await polisher(t, editTimeout: 1).edit(text, instruction: "shorten", vocabulary: []) == nil)
    }
}
