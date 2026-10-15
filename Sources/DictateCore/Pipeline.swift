import Foundation

public enum PipelineOutcome: Equatable, Sendable {
    case inserted(String), copied(String), noSpeech, skippedSecure, modelNotReady, cancelled, failed(String)
}

public enum PipelineState: Equatable, Sendable {
    case idle, listening, locked, working, notice(String)
}

public struct StageTimings: Sendable {
    public var transcribe: TimeInterval
    public var polish: TimeInterval
    public var insert: TimeInterval
    public var total: TimeInterval { transcribe + polish + insert }
}

/// One dictation: record → speech check → transcribe → polish (or local clean) → paste → history.
@MainActor
public final class Pipeline {
    public enum Notice {
        public static let noSpeech = "Didn't catch that"
        public static let secure = "Password field — skipped"
        public static let copied = "Copied — press ⌘V"
        public static let failed = "Transcription failed"
        public static let micUnavailable = "Microphone unavailable"
        public static let modelLoading = "Speech model still downloading"
    }

    let recorder: Recording
    let transcriber: Transcribing
    let context: ContextProviding
    let router: () -> StyleRouter
    public var polisher: Polishing
    let inserter: Inserting
    let history: History
    let vocabulary: () -> [String]
    let transcriberReady: () -> Bool

    public private(set) var isBusy = false
    public var isListening: Bool { target != nil }
    public private(set) var lastTimings: StageTimings?
    public var onStateChange: ((PipelineState) -> Void)?

    private var target: AppContext?

    public init(recorder: Recording, transcriber: Transcribing, context: ContextProviding, router: @escaping () -> StyleRouter,
                polisher: Polishing, inserter: Inserting, history: History, vocabulary: @escaping () -> [String],
                transcriberReady: @escaping () -> Bool = { true }) {
        self.recorder = recorder
        self.transcriber = transcriber
        self.context = context
        self.router = router
        self.polisher = polisher
        self.inserter = inserter
        self.history = history
        self.vocabulary = vocabulary
        self.transcriberReady = transcriberReady
    }

    /// Returns nil when the action was ignored (busy, or nothing to finish).
    /// `mode` is what the modifiers held so far chose; the value given with `.finishRecording` wins.
    public func handle(_ action: HotkeyAction, mode: DictationMode = .dictate) async -> PipelineOutcome? {
        switch action {
        case .none: return nil
        case .beginRecording: return begin()
        case .lockRecording:
            if target != nil { onStateChange?(.locked) }
            return nil
        case .cancelRecording: return cancel()
        case .finishRecording: return await finish(mode)
        }
    }

    private func begin() -> PipelineOutcome? {
        guard !isBusy, target == nil else { return nil }
        let ctx = context.current()
        if ctx.secureInput {
            notify(Notice.secure)
            return .skippedSecure
        }
        guard transcriberReady() else {
            notify(Notice.modelLoading)
            return .modelNotReady
        }
        do {
            try recorder.start()
        } catch {
            notify(Notice.micUnavailable)
            return .failed(error.localizedDescription)
        }
        target = ctx
        onStateChange?(.listening)
        return nil
    }

    private func cancel() -> PipelineOutcome? {
        guard target != nil else { return nil }
        _ = recorder.stop()
        target = nil
        onStateChange?(.idle)
        return .cancelled
    }

    private func finish(_ mode: DictationMode) async -> PipelineOutcome? {
        guard let target else { return nil }
        self.target = nil
        isBusy = true
        defer { isBusy = false }
        onStateChange?(.working)

        let samples = recorder.stop()
        guard SpeechGate.hasSpeech(samples) else { return done(.noSpeech, notice: Notice.noSpeech) }

        let vocab = vocabulary()
        var clock = Date()
        let raw: String
        do {
            let transcript = LocalCleaner.stripAnnotations(try await transcriber.transcribe(samples, vocabulary: vocab))
            raw = LocalCleaner.applyVocabulary(transcript, terms: vocab)
        } catch {
            return done(.failed(String(describing: error)), notice: Notice.failed)
        }
        let transcribeTime = Date().timeIntervalSince(clock)

        let cleaned = LocalCleaner.clean(raw)
        guard !cleaned.isEmpty else { return done(.noSpeech, notice: Notice.noSpeech) }

        clock = Date()
        let style = router().style(for: target)
        let final = await polisher.polish(raw, style: style, vocabulary: vocab) ?? cleaned
        let polishTime = Date().timeIntervalSince(clock)

        clock = Date()
        let outcome: PipelineOutcome
        if context.current().bundleID != target.bundleID {
            // Focus moved while we worked; never paste into the wrong app.
            inserter.copy(final)
            outcome = .copied(final)
        } else {
            outcome = await inserter.insert(final) == .pasted ? .inserted(final) : .copied(final)
        }
        lastTimings = StageTimings(transcribe: transcribeTime, polish: polishTime, insert: Date().timeIntervalSince(clock))
        history.add(HistoryEntry(date: Date(), bundleID: target.bundleID, raw: raw, final: final))
        return done(outcome, notice: outcome == .copied(final) ? Notice.copied : nil)
    }

    private func done(_ outcome: PipelineOutcome, notice: String?) -> PipelineOutcome {
        if let notice { notify(notice) } else { onStateChange?(.idle) }
        return outcome
    }

    private func notify(_ message: String) {
        onStateChange?(.notice(message))
        onStateChange?(.idle)
    }
}
