import Foundation
import Testing
@testable import DictateCore

final class StubTransport: HTTPTransport, @unchecked Sendable {
    var reply: String?
    var status = 200
    var delay: TimeInterval = 0
    var shouldThrow = false
    /// Sent as-is instead of a chat reply, e.g. an OpenRouter error body.
    var rawBody: String?
    private(set) var lastRequest: URLRequest?
    private(set) var calls = 0

    init(reply: String? = nil) { self.reply = reply }

    func send(_ req: URLRequest, timeout: TimeInterval) async throws -> (Data, Int) {
        calls += 1
        lastRequest = req
        if delay > 0 { try await Task.sleep(for: .seconds(delay)) }
        if shouldThrow { throw URLError(.notConnectedToInternet) }
        if let rawBody { return (Data(rawBody.utf8), status) }
        let content = try JSONSerialization.data(withJSONObject: ["content": reply ?? ""])
        let body = "{\"choices\":[{\"message\":\(String(decoding: content, as: UTF8.self))}]}"
        return (Data(body.utf8), status)
    }
}

@Suite struct PolisherTests {
    func polisher(_ t: StubTransport, key: String? = "test-key", timeout: TimeInterval = 2.5) -> Polisher {
        Polisher(transport: t, apiKey: { key }, model: "anthropic/claude-haiku-5.5", timeout: timeout)
    }

    @Test func returnsPolishedText() async {
        let t = StubTransport(reply: "Can you ask Priya if the queue cleared?")
        let out = await polisher(t).polish("um can you ask priya if the queue cleared", style: .slack, vocabulary: [])
        #expect(out == "Can you ask Priya if the queue cleared?")
    }

    @Test func sendsBearerAndModel() async throws {
        let t = StubTransport(reply: "Ship it today.")
        _ = await polisher(t).polish("ship it today", style: .slack, vocabulary: [])
        let req = try #require(t.lastRequest)
        #expect(req.url?.absoluteString == "https://openrouter.ai/api/v1/chat/completions")
        #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer test-key")
        let json = try #require(JSONSerialization.jsonObject(with: req.httpBody ?? Data()) as? [String: Any])
        #expect(json["model"] as? String == "anthropic/claude-haiku-5.5")
    }

    @Test func nilWhenNoKey() async {
        let t = StubTransport(reply: "x")
        #expect(await polisher(t, key: nil).polish("hello there", style: .slack, vocabulary: []) == nil)
        #expect(t.calls == 0)
    }

    @Test func nilForRawAndOff() async {
        let t = StubTransport(reply: "x")
        #expect(await polisher(t).polish("hello there", style: .raw, vocabulary: []) == nil)
        #expect(await polisher(t).polish("hello there", style: .off, vocabulary: []) == nil)
        #expect(t.calls == 0)
    }

    @Test func nilOnTimeout() async {
        let t = StubTransport(reply: "Hello there.")
        t.delay = 3
        let start = Date()
        let out = await polisher(t).polish("hello there", style: .slack, vocabulary: [])
        #expect(out == nil)
        #expect(Date().timeIntervalSince(start) < 2.8)
    }

    @Test func nilOnTransportError() async {
        let t = StubTransport(reply: "Hello there.")
        t.shouldThrow = true
        #expect(await polisher(t).polish("hello there", style: .slack, vocabulary: []) == nil)
    }

    @Test func nilOn500() async {
        let t = StubTransport(reply: "Hello there.")
        t.status = 500
        #expect(await polisher(t).polish("hello there", style: .slack, vocabulary: []) == nil)
    }

    @Test func nilOnEmptyContent() async {
        #expect(await polisher(StubTransport(reply: "  ")).polish("hello there", style: .slack, vocabulary: []) == nil)
    }

    @Test func stripsPreambleAndQuotes() async {
        let t = StubTransport(reply: "Here's the cleaned text: \"Ship it today.\"")
        #expect(await polisher(t).polish("ship it today", style: .slack, vocabulary: []) == "Ship it today.")
    }

    @Test func keepsSpokenHeresTheThing() async {
        let t = StubTransport(reply: "Here's the thing: we ship Friday.")
        #expect(await polisher(t).polish("here's the thing we ship friday", style: .slack, vocabulary: []) == "Here's the thing: we ship Friday.")
    }

    @Test func keepsSpokenOkayWithTime() async {
        let reply = "Okay, let's meet at 3:30 tomorrow to review the GitHub backlog and Figma numbers."
        let t = StubTransport(reply: reply)
        let out = await polisher(t).polish("okay let's meet at 3:30 tomorrow to review the github backlog and figma numbers", style: .slack, vocabulary: [])
        #expect(out == reply)
    }

    @Test func fallsBackWhenOutputBallooned() async {
        let input = Array(repeating: "word", count: 10).joined(separator: " ")
        let t = StubTransport(reply: Array(repeating: "poem", count: 40).joined(separator: " "))
        #expect(await polisher(t).polish(input, style: .slack, vocabulary: []) == nil)
    }

    @Test func fallsBackWhenOutputCollapsed() async {
        let input = Array(repeating: "word", count: 20).joined(separator: " ")
        let t = StubTransport(reply: "one two three four five")
        #expect(await polisher(t).polish(input, style: .slack, vocabulary: []) == nil)
    }

    @Test func promptListsVocabularyAndNoAnswerRule() {
        let p = Polisher.systemPrompt(style: .slack, vocabulary: ["PostgreSQL"])
        #expect(p.contains("PostgreSQL"))
        #expect(p.contains("never answer"))
        #expect(p.contains("Casual and concise; keep the speaker's voice; no greeting or sign-off unless spoken."))
    }
}
