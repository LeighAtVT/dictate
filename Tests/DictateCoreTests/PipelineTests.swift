import Foundation
import Testing
@testable import DictateCore

final class FakeRecorder: Recording {
    var starts = 0, stops = 0
    var failStart = false
    var samples: [Float]
    init(samples: [Float]) { self.samples = samples }
    func start() throws { starts += 1; if failStart { throw NSError(domain: "mic", code: 1) } }
    func stop() -> [Float] { stops += 1; return samples }
}

final class FakeTranscriber: Transcribing, @unchecked Sendable {
    var text = "um ship it today"
    var error: Error?
    var calls = 0
    var gate: CheckedContinuation<Void, Never>?
    var suspend = false
    func transcribe(_ samples: [Float], vocabulary: [String]) async throws -> String {
        calls += 1
        if suspend { await withCheckedContinuation { gate = $0 } }
        if let error { throw error }
        return text
    }
}

final class FakeContext: ContextProviding {
    var contexts: [AppContext]
    init(_ contexts: AppContext...) { self.contexts = contexts }
    func current() -> AppContext { contexts.count > 1 ? contexts.removeFirst() : contexts[0] }
    func hasFocusedTextField() -> Bool { true }
}

final class FakePolisher: Polishing, @unchecked Sendable {
    var reply: String?
    var styles: [Style] = []
    init(reply: String?) { self.reply = reply }
    func polish(_ text: String, style: Style, vocabulary: [String]) async -> String? { styles.append(style); return reply }
}

@MainActor final class FakeInserter: Inserting {
    var inserted: [String] = [], copied: [String] = []
    var result = InsertResult.pasted
    func insert(_ text: String) async -> InsertResult { inserted.append(text); return result }
    func copy(_ text: String) { copied.append(text) }
}

let speech: [Float] = (0..<16000).map { 0.2 * sin(2 * .pi * 440 * Float($0) / 16000) }
let slack = AppContext(bundleID: "com.tinyspeck.slackmacgap")
let terminal = AppContext(bundleID: "com.apple.Terminal")

@MainActor @Suite struct PipelineTests {
    let recorder = FakeRecorder(samples: speech)
    let transcriber = FakeTranscriber()
    let polisher = FakePolisher(reply: "Polished.")
    let inserter = FakeInserter()
    let history = History(fileURL: FileManager.default.temporaryDirectory.appendingPathComponent("p-\(UUID().uuidString).json"))

    func pipeline(_ context: FakeContext = FakeContext(slack), ready: Bool = true) -> Pipeline {
        Pipeline(recorder: recorder, transcriber: transcriber, context: context, router: { StyleRouter() },
                 polisher: polisher, inserter: inserter, history: history, vocabulary: { ["PostgreSQL"] },
                 transcriberReady: { ready })
    }

    func dictate(_ p: Pipeline) async -> PipelineOutcome? {
        _ = await p.handle(.beginRecording)
        return await p.handle(.finishRecording)
    }

    @Test func happyPathPolished() async {
        let outcome = await dictate(pipeline())
        #expect(outcome == .inserted("Polished."))
        #expect(inserter.inserted == ["Polished."])
        #expect(history.recent().first?.raw == "um ship it today")
        #expect(history.recent().first?.final == "Polished.")
    }

    @Test func fallsBackToLocalCleanWhenPolishNil() async {
        polisher.reply = nil
        #expect(await dictate(pipeline()) == .inserted("Ship it today"))
    }

    @Test func noSpeechPastesNothing() async {
        recorder.samples = [Float](repeating: 0, count: 16000)
        #expect(await dictate(pipeline()) == .noSpeech)
        #expect(transcriber.calls == 0)
        #expect(inserter.inserted.isEmpty)
    }

    @Test func secureInputSkipsRecording() async {
        let p = pipeline(FakeContext(AppContext(bundleID: "com.apple.Safari", secureInput: true)))
        #expect(await p.handle(.beginRecording) == .skippedSecure)
        #expect(recorder.starts == 0)
        #expect(await p.handle(.finishRecording) == nil)
    }

    @Test func cancelDiscardsAudio() async {
        let p = pipeline()
        _ = await p.handle(.beginRecording)
        #expect(await p.handle(.cancelRecording) == .cancelled)
        #expect(recorder.stops == 1)
        #expect(transcriber.calls == 0)
    }

    @Test func ignoresPressWhilePipelineBusy() async {
        transcriber.suspend = true
        let p = pipeline()
        _ = await p.handle(.beginRecording)
        let finishing = Task { await p.handle(.finishRecording) }
        while transcriber.gate == nil { await Task.yield() }
        #expect(p.isBusy)
        #expect(await p.handle(.beginRecording) == nil)
        #expect(recorder.starts == 1)
        transcriber.gate?.resume()
        _ = await finishing.value
        #expect(!p.isBusy)
    }

    @Test func copiesInsteadOfPastingWhenFrontAppChanged() async {
        let outcome = await dictate(pipeline(FakeContext(slack, terminal)))
        #expect(outcome == .copied("Polished."))
        #expect(inserter.inserted.isEmpty)
        #expect(inserter.copied == ["Polished."])
    }

    @Test func copiedOnlyFromInserterMapsToCopied() async {
        inserter.result = .copiedOnly
        #expect(await dictate(pipeline()) == .copied("Polished."))
    }

    @Test func styleUsesContextAtKeyDown() async {
        _ = await dictate(pipeline(FakeContext(slack, terminal)))
        #expect(polisher.styles == [.slack])
    }

    @Test func transcriptionErrorPastesNothing() async {
        transcriber.error = TranscriberError(description: "boom")
        let outcome = await dictate(pipeline())
        #expect(outcome == .failed("boom"))
        #expect(inserter.inserted.isEmpty)
    }

    @Test func emptyTranscriptIsNoSpeech() async {
        transcriber.text = "   "
        #expect(await dictate(pipeline()) == .noSpeech)
        #expect(inserter.inserted.isEmpty)
    }

    @Test func appliesVocabularyCasingToRaw() async {
        transcriber.text = "the postgresql queue cleared"
        polisher.reply = nil
        #expect(await dictate(pipeline()) == .inserted("The PostgreSQL queue cleared"))
    }

    @Test func micFailureSaysMicrophoneUnavailable() async {
        recorder.failStart = true
        let p = pipeline()
        var notices: [String] = []
        p.onStateChange = { if case .notice(let m) = $0 { notices.append(m) } }
        _ = await p.handle(.beginRecording)
        #expect(notices == [Pipeline.Notice.micUnavailable])
        #expect(!p.isListening)
    }

    @Test func reportsListeningWhileRecording() async {
        let p = pipeline()
        _ = await p.handle(.beginRecording)
        #expect(p.isListening)
        _ = await p.handle(.finishRecording)
        #expect(!p.isListening)
    }

    @Test func refusesToRecordWhileModelLoading() async {
        let p = pipeline(ready: false)
        var notices: [String] = []
        p.onStateChange = { if case .notice(let m) = $0 { notices.append(m) } }
        #expect(await p.handle(.beginRecording) == .modelNotReady)
        #expect(recorder.starts == 0)
        #expect(notices == [Pipeline.Notice.modelLoading])
    }

    @Test func whisperSilenceMarkerIsNoSpeech() async {
        transcriber.text = "[BLANK_AUDIO]"
        #expect(await dictate(pipeline()) == .noSpeech)
        #expect(inserter.inserted.isEmpty)
    }

    @Test func stripsSoundAnnotationsAroundSpeech() async {
        transcriber.text = "[MUSIC] ship it today (coughs)"
        polisher.reply = nil
        #expect(await dictate(pipeline()) == .inserted("Ship it today"))
    }

    @Test func lockKeepsRecordingAndReportsLocked() async {
        let p = pipeline()
        var states: [PipelineState] = []
        p.onStateChange = { states.append($0) }
        _ = await p.handle(.beginRecording)
        #expect(await p.handle(.lockRecording) == nil)
        #expect(p.isListening)
        #expect(states == [.listening, .locked])
        #expect(await p.handle(.finishRecording) == .inserted("Polished."))
    }

    @Test func lockWithoutRecordingIsIgnored() async {
        let p = pipeline()
        var states: [PipelineState] = []
        p.onStateChange = { states.append($0) }
        #expect(await p.handle(.lockRecording) == nil)
        #expect(states.isEmpty)
    }

    @Test func recordsTimings() async {
        let p = pipeline()
        _ = await dictate(p)
        #expect(p.lastTimings != nil)
    }

    @Test func reportsStates() async {
        let p = pipeline()
        var states: [PipelineState] = []
        p.onStateChange = { states.append($0) }
        _ = await dictate(p)
        #expect(states.first == .listening)
        #expect(states.contains(.working))
        #expect(states.last == .idle)
    }
}
