import Foundation
import Testing
@testable import DictateCore

@MainActor @Suite struct SelectionReaderTests {
    let original: [[String: Data]] = [["public.utf8-plain-text": Data("what I copied".utf8)]]

    @Test func accessibilityTextWins() async {
        let pb = FakePasteboard(items: original), keys = FakeKeys()
        let text = await SelectionReader(probe: { .text("hello") }, pasteboard: pb, keys: keys).selectedText()
        #expect(text == "hello")
        #expect(keys.copies == 0)
    }

    @Test func fallsBackToCopyAndRestoresClipboard() async {
        let pb = FakePasteboard(items: original), keys = FakeKeys()
        keys.onCopy = { pb.setString("copied selection") }
        let text = await SelectionReader(probe: { .unknown }, pasteboard: pb, keys: keys, wait: 0.2).selectedText()
        #expect(text == "copied selection")
        #expect(keys.copies == 1)
        #expect(pb.items == original)
    }

    @Test func noSelectionLeavesClipboardAlone() async {
        let pb = FakePasteboard(items: original), keys = FakeKeys()
        let start = Date()
        let text = await SelectionReader(probe: { .unknown }, pasteboard: pb, keys: keys, wait: 0.2).selectedText()
        #expect(text == nil)
        #expect(pb.items == original)
        #expect(pb.changeCount == 0)
        #expect(Date().timeIntervalSince(start) < 1)
    }

    @Test func copyLineIsNotASelection() async {
        // VS Code copies the whole line on ⌘C when nothing is selected.
        let pb = FakePasteboard(items: original), keys = FakeKeys()
        keys.onCopy = { pb.setString("let x = 1\n") }
        let text = await SelectionReader(probe: { .empty }, pasteboard: pb, keys: keys, wait: 0.2).selectedText()
        #expect(text == nil)
        #expect(pb.items == original)
    }

    @Test func emptyProbeStillTrustsARealCopy() async {
        // Google Docs and others under-report the selection; a genuine multi-word copy still counts.
        let pb = FakePasteboard(items: original), keys = FakeKeys()
        keys.onCopy = { pb.setString("Two lines\nof text") }
        let text = await SelectionReader(probe: { .empty }, pasteboard: pb, keys: keys, wait: 0.2).selectedText()
        #expect(text == "Two lines\nof text")
    }

    @Test func lateCopyIsRolledBack() async throws {
        let pb = FakePasteboard(items: original), keys = FakeKeys()
        keys.onCopy = {
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(300)) // a slow app answers after we gave up
                pb.setString("late")
            }
        }
        let text = await SelectionReader(probe: { .unknown }, pasteboard: pb, keys: keys, wait: 0.1).selectedText()
        #expect(text == nil)
        try await Task.sleep(for: .milliseconds(600))
        #expect(pb.items == original)
    }
}
