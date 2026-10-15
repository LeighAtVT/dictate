import Foundation

public enum PipelineOutcome: Equatable, Sendable {
    case inserted(String), copied(String), noSpeech, skippedSecure, modelNotReady, cancelled, failed(String)
    /// Nothing was done; the associated value is the notice shown.
    case skipped(String)
    case noted(NoteDestination)
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
/// Edit mode rewrites the selection instead; note mode saves a note to self instead of pasting.
@MainActor
public final class Pipeline {
    public enum Notice {
        public static let noSpeech = "Didn't catch that"
        public static let secure = "Password field — skipped"
        public static let copied = "Copied — press ⌘V"
        public static let failed = "Transcription failed"
        public static let micUnavailable = "Microphone unavailable"
        public static let modelLoading = "Speech model still downloading"
        public static let highlightFirst = "Highlight text first"
        public static let editNeedsKey = "Voice editing needs an OpenRouter key"
        public static let polishOff = "Polish is off for this app"
        public static let editFailed = "Edit failed — text unchanged"
        public static let savedTasks = "Saved to Tasks"
        public static let savedFile = "Saved to Dictate Notes"
        public static let noteFailed = "Couldn't save note — copied"
        public static let notTranslated = "Pasted as spoken — couldn't translate"
        public static let translateNeedsKey = "Pasted as spoken — add an OpenRouter key to translate"
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
    let shortcuts: () -> [Shortcut]
    let selection: SelectionReading?
    let notes: NoteSaving?
    let hasKey: () -> Bool
    let language: () -> LanguageSettings

    public private(set) var isBusy = false
    public var isListening: Bool { target != nil }
    public private(set) var lastTimings: StageTimings?
    public var onStateChange: ((PipelineState) -> Void)?

    private var target: AppContext?

    public init(recorder: Recording, transcriber: Transcribing, context: ContextProviding, router: @escaping () -> StyleRouter,
                polisher: Polishing, inserter: Inserting, history: History, vocabulary: @escaping () -> [String],
                transcriberReady: @escaping () -> Bool = { true }, shortcuts: @escaping () -> [Shortcut] = { [] },
                selection: SelectionReading? = nil, notes: NoteSaving? = nil, hasKey: @escaping () -> Bool = { true },
                language: @escaping () -> LanguageSettings = { .default }) {
        self.recorder = recorder
        self.transcriber = transcriber
        self.context = context
        self.router = router
        self.polisher = polisher
        self.inserter = inserter
        self.history = history
        self.vocabulary = vocabulary
        self.transcriberReady = transcriberReady
        self.shortcuts = shortcuts
        self.selection = selection
        self.notes = notes
        self.hasKey = hasKey
        self.language = language
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
        let style = router().style(for: target)

        // Check edits up front, and read the selection before the user has a chance to move on.
        var selected = ""
        if mode == .edit {
            guard hasKey() else { return done(.skipped(Notice.editNeedsKey), notice: Notice.editNeedsKey) }
            guard style != .off else { return done(.skipped(Notice.polishOff), notice: Notice.polishOff) }
            guard let text = await selection?.selectedText() else { return done(.skipped(Notice.highlightFirst), notice: Notice.highlightFirst) }
            selected = text
        }

        let vocab = vocabulary()
        var clock = Date()
        let raw: String
        do {
            let transcript = try await transcriber.transcribe(samples, vocabulary: vocab, language: language().spoken)
            raw = LocalCleaner.applyVocabulary(LocalCleaner.stripAnnotations(transcript), terms: vocab)
        } catch {
            return done(.failed(String(describing: error)), notice: Notice.failed)
        }
        let transcribeTime = Date().timeIntervalSince(clock)

        let cleaned = LocalCleaner.clean(raw)
        guard !cleaned.isEmpty else { return done(.noSpeech, notice: Notice.noSpeech) }

        clock = Date()
        switch mode {
        case .note:
            let (final, _) = await polishForOutput(raw, cleaned: cleaned, style: .docs, vocabulary: vocab)
            history.add(HistoryEntry(date: Date(), bundleID: "note", raw: raw, final: final))
            switch await notes?.save(final) {
            case .tasks: return done(.noted(.tasks), notice: Notice.savedTasks)
            case .file: return done(.noted(.file), notice: Notice.savedFile)
            case nil:
                inserter.copy(final)
                return done(.copied(final), notice: Notice.noteFailed)
            }

        case .edit:
            guard let rewritten = await polisher.edit(selected, instruction: cleaned, vocabulary: vocab) else {
                return done(.failed("edit"), notice: Notice.editFailed)
            }
            return await deliver(rewritten, raw: raw, target: target, notice: nil, timings: (transcribeTime, clock))

        case .dictate:
            if let shortcut = ShortcutMatcher.match(cleaned, in: shortcuts()) {
                return await deliver(shortcut.text, raw: raw, target: target, notice: nil, timings: (transcribeTime, clock))
            }
            let (final, notice) = await polishForOutput(raw, cleaned: cleaned, style: style, vocabulary: vocab)
            return await deliver(final, raw: raw, target: target, notice: notice, timings: (transcribeTime, clock))
        }
    }

    /// Polished text in the "Paste in" language. Falls back to the local clean-up, with a notice when a
    /// translation was wanted but couldn't happen.
    private func polishForOutput(_ raw: String, cleaned: String, style: Style, vocabulary: [String]) async -> (String, String?) {
        let output = language().output
        guard output != .same else {
            return (await polisher.polish(raw, style: style, vocabulary: vocabulary, output: .same) ?? cleaned, nil)
        }
        guard style != .off else { return (cleaned, Notice.notTranslated) }
        guard hasKey() else { return (cleaned, Notice.translateNeedsKey) }
        guard let translated = await polisher.polish(raw, style: style, vocabulary: vocabulary, output: output) else {
            return (cleaned, Notice.notTranslated)
        }
        return (translated, nil)
    }

    /// Pastes into the app dictation started in, or copies when focus has moved; records history.
    private func deliver(_ final: String, raw: String, target: AppContext, notice: String?,
                         timings: (transcribe: TimeInterval, polishStart: Date)) async -> PipelineOutcome {
        let polishTime = Date().timeIntervalSince(timings.polishStart)
        let clock = Date()
        let outcome: PipelineOutcome
        if context.current().bundleID != target.bundleID {
            // Focus moved while we worked; never paste into the wrong app.
            inserter.copy(final)
            outcome = .copied(final)
        } else {
            outcome = await inserter.insert(final) == .pasted ? .inserted(final) : .copied(final)
        }
        lastTimings = StageTimings(transcribe: timings.transcribe, polish: polishTime, insert: Date().timeIntervalSince(clock))
        history.add(HistoryEntry(date: Date(), bundleID: target.bundleID, raw: raw, final: final))
        return done(outcome, notice: outcome == .copied(final) ? Notice.copied : notice)
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
