import Foundation
import Testing
@testable import DictateCore

@Suite struct PolisherModelTests {
    let cleanup = ModelChoice(id: "z-ai/glm-5.3-flash", thinking: .minimal)
    let edit = ModelChoice(id: "deepseek/deepseek-v4.1-flash", thinking: .off)

    func body(_ t: StubTransport) throws -> [String: Any] {
        let req = try #require(t.lastRequest)
        return try #require(JSONSerialization.jsonObject(with: req.httpBody ?? Data()) as? [String: Any])
    }

    @Test func polishSendsCleanupModelThinkingAndPrivacy() async throws {
        let t = StubTransport(reply: "Ship it today.")
        _ = await Polisher(transport: t, apiKey: { "k" }, model: cleanup, editModel: edit)
            .polish("ship it today", style: .slack, vocabulary: [])
        let json = try body(t)
        #expect(json["model"] as? String == "z-ai/glm-5.3-flash")
        #expect((json["reasoning"] as? [String: Any])?["effort"] as? String == "minimal")
        let provider = try #require(json["provider"] as? [String: Any])
        #expect(provider["zdr"] as? Bool == true)
        #expect(provider["data_collection"] as? String == "deny")
    }

    @Test func translationUsesCleanupModel() async throws {
        let t = StubTransport(reply: "Hello.")
        _ = await Polisher(transport: t, apiKey: { "k" }, model: cleanup, editModel: edit)
            .polish("hola", style: .docs, vocabulary: [], output: .language("English"))
        #expect(try body(t)["model"] as? String == "z-ai/glm-5.3-flash")
    }

    @Test func editSendsEditModel() async throws {
        let t = StubTransport(reply: "Friendlier text.")
        _ = await Polisher(transport: t, apiKey: { "k" }, model: cleanup, editModel: edit)
            .edit("Text.", instruction: "make this friendlier", vocabulary: [])
        let json = try body(t)
        #expect(json["model"] as? String == "deepseek/deepseek-v4.1-flash")
        #expect((json["reasoning"] as? [String: Any])?["enabled"] as? Bool == false)
    }

    @Test func modelDefaultSendsNoReasoning() async throws {
        let t = StubTransport(reply: "Ship it today.")
        _ = await Polisher(transport: t, apiKey: { "k" }, model: "someone/custom")
            .polish("ship it today", style: .slack, vocabulary: [])
        let json = try body(t)
        #expect(json["reasoning"] == nil)
        #expect(json["model"] as? String == "someone/custom")
    }

    @Test func editModelDefaultsToCleanupModel() async throws {
        let t = StubTransport(reply: "Shorter.")
        _ = await Polisher(transport: t, apiKey: { "k" }, model: cleanup).edit("Longer text.", instruction: "shorten", vocabulary: [])
        #expect(try body(t)["model"] as? String == "z-ai/glm-5.3-flash")
    }

    @Test func checkReportsSuccess() async throws {
        let t = StubTransport(reply: "Can you send the link?")
        let result = await Polisher(transport: t, apiKey: { "k" }, model: cleanup).check(edit)
        guard case .worked(let seconds) = result else { Issue.record("expected success, got \(result)"); return }
        #expect(seconds >= 0)
        #expect(try body(t)["model"] as? String == "deepseek/deepseek-v4.1-flash")
    }

    @Test func checkReportsOpenRouterError() async {
        let t = StubTransport()
        t.status = 404
        t.rawBody = #"{"error":{"message":"No endpoints found matching your data policy","code":404}}"#
        let result = await Polisher(transport: t, apiKey: { "k" }, model: cleanup).check("someone/custom")
        #expect(result == .failed("No endpoints found matching your data policy"))
    }

    @Test func checkReportsMissingKey() async {
        let t = StubTransport(reply: "x")
        #expect(await Polisher(transport: t, apiKey: { nil }, model: cleanup).check(cleanup) == .failed("Add your OpenRouter key first."))
        #expect(t.calls == 0)
    }

    @Test func checkReportsTimeout() async {
        let t = StubTransport(reply: "x")
        t.delay = 1
        let result = await Polisher(transport: t, apiKey: { "k" }, model: cleanup, timeout: 0.2).check(cleanup, timeout: 0.2)
        #expect(result == .failed("No reply within 0.2 seconds."))
    }
}
