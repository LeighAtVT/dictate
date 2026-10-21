import Foundation
import Testing
@testable import DictateCore

@Suite struct PolisherConfigErrorTests {
    func polisher(_ t: StubTransport, timeout: TimeInterval = 2.5) -> Polisher {
        Polisher(transport: t, apiKey: { "k" }, model: "someone/custom", timeout: timeout)
    }

    @Test func refusedRequestIsRemembered() async {
        let t = StubTransport()
        t.status = 404
        t.rawBody = #"{"error":{"message":"No endpoints found matching your data policy","code":404}}"#
        let p = polisher(t)
        #expect(await p.polish("ship it today", style: .slack, vocabulary: []) == nil)
        #expect(p.lastConfigError() == "No endpoints found matching your data policy")
    }

    @Test func successClearsIt() async {
        let t = StubTransport()
        t.status = 402
        t.rawBody = #"{"error":{"message":"Insufficient credits"}}"#
        let p = polisher(t)
        _ = await p.polish("ship it today", style: .slack, vocabulary: [])
        #expect(p.lastConfigError() == "Insufficient credits")
        t.status = 200
        t.rawBody = nil
        t.reply = "Ship it today."
        #expect(await p.polish("ship it today", style: .slack, vocabulary: []) == "Ship it today.")
        #expect(p.lastConfigError() == nil)
    }

    @Test func serverErrorsAndTimeoutsAreNotConfigErrors() async {
        let t = StubTransport(reply: "x")
        t.status = 503
        let p = polisher(t, timeout: 0.2)
        _ = await p.polish("ship it today", style: .slack, vocabulary: [])
        #expect(p.lastConfigError() == nil)
        t.status = 200
        t.delay = 1
        _ = await p.polish("ship it today", style: .slack, vocabulary: [])
        #expect(p.lastConfigError() == nil)
    }

    @Test func refusalWithoutBodyStillReported() async {
        let t = StubTransport()
        t.status = 401
        t.rawBody = "not json"
        let p = polisher(t)
        _ = await p.polish("ship it today", style: .slack, vocabulary: [])
        #expect(p.lastConfigError() == "OpenRouter returned 401.")
    }
}

@MainActor @Suite struct PipelinePolishFailureTests {
    let recorder = FakeRecorder(samples: speech)
    let transcriber = FakeTranscriber()
    let polisher = FakePolisher(reply: nil)
    let inserter = FakeInserter()
    let history = History(fileURL: FileManager.default.temporaryDirectory.appendingPathComponent("pf-\(UUID().uuidString).json"))

    func run() async -> (PipelineOutcome?, [String]) {
        let p = Pipeline(recorder: recorder, transcriber: transcriber, context: FakeContext(slack), router: { StyleRouter() },
                         polisher: polisher, inserter: inserter, history: history, vocabulary: { [] }, transcriberReady: { true })
        var notices: [String] = []
        p.onStateChange = { if case .notice(let m) = $0 { notices.append(m) } }
        _ = await p.handle(.beginRecording)
        let outcome = await p.handle(.finishRecording)
        return (outcome, notices)
    }

    @Test func refusedCleanupPastesLocalCleanWithNotice() async {
        polisher.configError = "No endpoints found matching your data policy"
        let (outcome, notices) = await run()
        #expect(outcome == .inserted("Ship it today"))
        #expect(notices == [Pipeline.Notice.polishRefused])
    }

    @Test func plainFallbackStaysQuiet() async {
        let (outcome, notices) = await run()
        #expect(outcome == .inserted("Ship it today"))
        #expect(notices.isEmpty)
    }
}
