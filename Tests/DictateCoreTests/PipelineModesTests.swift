import Foundation
import Testing
@testable import DictateCore

@MainActor final class FakeSelection: SelectionReading {
    var text: String?
    var reads = 0
    init(_ text: String?) { self.text = text }
    func selectedText() async -> String? { reads += 1; return text }
}

final class FakeNotes: NoteSaving, @unchecked Sendable {
    var destination: NoteDestination?
    var saved: [String] = []
    init(_ destination: NoteDestination?) { self.destination = destination }
    func save(_ text: String) async -> NoteDestination? { saved.append(text); return destination }
}

@MainActor @Suite struct PipelineModesTests {
    let recorder = FakeRecorder(samples: speech)
    let transcriber = FakeTranscriber()
    let polisher = FakePolisher(reply: "Polished.")
    let inserter = FakeInserter()
    let selection = FakeSelection("Original paragraph.")
    let notes = FakeNotes(.tasks)
    let history = History(fileURL: FileManager.default.temporaryDirectory.appendingPathComponent("pm-\(UUID().uuidString).json"))

    func pipeline(_ context: FakeContext = FakeContext(slack), overrides: [String: Style] = [:], hasKey: Bool = true,
                  language: LanguageSettings = .default, shortcuts: [Shortcut] = []) -> Pipeline {
        Pipeline(recorder: recorder, transcriber: transcriber, context: context, router: { StyleRouter(overrides: overrides) },
                 polisher: polisher, inserter: inserter, history: history, vocabulary: { [] },
                 shortcuts: { shortcuts }, selection: selection, notes: notes, hasKey: { hasKey }, language: { language })
    }

    func run(_ p: Pipeline, _ mode: DictationMode = .dictate) async -> (PipelineOutcome?, [String]) {
        var notices: [String] = []
        p.onStateChange = { if case .notice(let m) = $0 { notices.append(m) } }
        _ = await p.handle(.beginRecording)
        return (await p.handle(.finishRecording, mode: mode), notices)
    }

    // MARK: Shortcuts

    @Test func shortcutPastesSavedTextWithoutPolish() async {
        transcriber.text = "um, my zoom link."
        let zoom = Shortcut(phrase: "my zoom link", text: "https://zoom.us/j/1")
        let (outcome, _) = await run(pipeline(shortcuts: [zoom]))
        #expect(outcome == .inserted("https://zoom.us/j/1"))
        #expect(polisher.styles.isEmpty)
        #expect(history.recent().first?.final == "https://zoom.us/j/1")
    }

    @Test func nonMatchingTranscriptStillPolishes() async {
        transcriber.text = "send my zoom link"
        let (outcome, _) = await run(pipeline(shortcuts: [Shortcut(phrase: "my zoom link", text: "x")]))
        #expect(outcome == .inserted("Polished."))
    }

    @Test func shortcutIsVerbatimEvenWhenTranslating() async {
        transcriber.text = "my signature"
        let sig = Shortcut(phrase: "my signature", text: "Thanks,\nL")
        let (outcome, _) = await run(pipeline(language: LanguageSettings(spoken: "es", paste: "en"), shortcuts: [sig]))
        #expect(outcome == .inserted("Thanks,\nL"))
        #expect(polisher.outputs.isEmpty)
    }

    // MARK: Voice editing

    @Test func editReplacesSelection() async {
        transcriber.text = "um make it friendlier"
        polisher.editReply = "Rewritten."
        let (outcome, _) = await run(pipeline(), .edit)
        #expect(outcome == .inserted("Rewritten."))
        #expect(polisher.edits.first?.text == "Original paragraph.")
        #expect(polisher.edits.first?.instruction == "Make it friendlier")
        #expect(polisher.styles.isEmpty)
        #expect(history.recent().first?.raw == "um make it friendlier")
        #expect(history.recent().first?.final == "Rewritten.")
    }

    @Test func editWithoutSelectionAsksToHighlight() async {
        selection.text = nil
        let (outcome, notices) = await run(pipeline(), .edit)
        #expect(outcome == .skipped(Pipeline.Notice.highlightFirst))
        #expect(notices == [Pipeline.Notice.highlightFirst])
        #expect(inserter.inserted.isEmpty)
    }

    @Test func editNeedsAKey() async {
        let (outcome, _) = await run(pipeline(hasKey: false), .edit)
        #expect(outcome == .skipped(Pipeline.Notice.editNeedsKey))
        #expect(selection.reads == 0)
    }

    @Test func editRespectsPolishOff() async {
        let (outcome, _) = await run(pipeline(overrides: [slack.bundleID: .off]), .edit)
        #expect(outcome == .skipped(Pipeline.Notice.polishOff))
        #expect(polisher.edits.isEmpty)
    }

    @Test func editWorksInRawApps() async {
        polisher.editReply = "ls -la"
        let (outcome, _) = await run(pipeline(FakeContext(terminal)), .edit)
        #expect(outcome == .inserted("ls -la"))
    }

    @Test func failedEditLeavesTextAlone() async {
        polisher.editReply = nil
        let (outcome, notices) = await run(pipeline(), .edit)
        #expect(outcome == .failed("edit"))
        #expect(notices == [Pipeline.Notice.editFailed])
        #expect(inserter.inserted.isEmpty && inserter.copied.isEmpty)
    }

    @Test func editCopiesWhenFocusMoved() async {
        polisher.editReply = "Rewritten."
        let (outcome, _) = await run(pipeline(FakeContext(slack, terminal)), .edit)
        #expect(outcome == .copied("Rewritten."))
    }

    // MARK: Note to self

    @Test func noteGoesToTasks() async {
        let (outcome, notices) = await run(pipeline(FakeContext(slack, terminal)), .note)
        #expect(outcome == .noted(.tasks))
        #expect(notices == [Pipeline.Notice.savedTasks])
        #expect(polisher.styles == [.docs])
        #expect(notes.saved == ["Polished."])
        #expect(inserter.inserted.isEmpty && inserter.copied.isEmpty)
        #expect(history.recent().first?.bundleID == "note")
    }

    @Test func noteFallsBackToFileNotice() async {
        notes.destination = .file
        let (outcome, notices) = await run(pipeline(), .note)
        #expect(outcome == .noted(.file))
        #expect(notices == [Pipeline.Notice.savedFile])
    }

    @Test func unsavableNoteIsCopied() async {
        notes.destination = nil
        let (outcome, notices) = await run(pipeline(), .note)
        #expect(outcome == .copied("Polished."))
        #expect(notices == [Pipeline.Notice.noteFailed])
        #expect(inserter.copied == ["Polished."])
    }

    @Test func noteHonorsTranslation() async {
        _ = await run(pipeline(language: LanguageSettings(spoken: "es", paste: "en")), .note)
        #expect(polisher.outputs == [.language("English")])
    }

    // MARK: Language

    @Test func transcribesInTheSpokenLanguage() async {
        _ = await run(pipeline(language: LanguageSettings(spoken: "es", paste: "same")))
        #expect(transcriber.languages == ["es"])
        #expect(polisher.outputs == [.same])
    }

    @Test func translatesWhenPasteLanguageDiffers() async {
        let (outcome, notices) = await run(pipeline(language: LanguageSettings(spoken: "es", paste: "en")))
        #expect(polisher.outputs == [.language("English")])
        #expect(outcome == .inserted("Polished."))
        #expect(notices.isEmpty)
    }

    @Test func failedTranslationPastesAsSpoken() async {
        transcriber.text = "hola equipo"
        polisher.reply = nil
        let (outcome, notices) = await run(pipeline(language: LanguageSettings(spoken: "es", paste: "en")))
        #expect(outcome == .inserted("Hola equipo"))
        #expect(notices == [Pipeline.Notice.notTranslated])
    }

    @Test func translationWithoutKeyPastesAsSpoken() async {
        transcriber.text = "hola equipo"
        let (outcome, notices) = await run(pipeline(hasKey: false, language: LanguageSettings(spoken: "es", paste: "en")))
        #expect(outcome == .inserted("Hola equipo"))
        #expect(polisher.outputs.isEmpty)
        #expect(notices == [Pipeline.Notice.translateNeedsKey])
    }

    @Test func offAppsNeverTranslate() async {
        transcriber.text = "hola equipo"
        let (outcome, notices) = await run(pipeline(overrides: [slack.bundleID: .off], language: LanguageSettings(spoken: "es", paste: "en")))
        #expect(outcome == .inserted("Hola equipo"))
        #expect(polisher.outputs.isEmpty)
        #expect(notices == [Pipeline.Notice.notTranslated])
    }
}
