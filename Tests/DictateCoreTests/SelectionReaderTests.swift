import Foundation
import Testing
@testable import DictateCore

@MainActor @Suite struct SelectionReaderTests {
    let original: [[String: Data]] = [["public.utf8-plain-text": Data("what I copied".utf8)]]

    @Test func accessibilityTextWins() async {
        let pb = FakePasteboard(items: original), keys = FakeKeys()
        let text = await SelectionReader(axSelectedText: { "hello" }, pasteboard: pb, keys: keys).selectedText()
        #expect(text == "hello")
        #expect(keys.copies == 0)
    }

    @Test func fallsBackToCopyAndRestoresClipboard() async {
        let pb = FakePasteboard(items: original), keys = FakeKeys()
        keys.onCopy = { pb.setString("copied selection") }
        let text = await SelectionReader(axSelectedText: { nil }, pasteboard: pb, keys: keys, wait: 0.2).selectedText()
        #expect(text == "copied selection")
        #expect(keys.copies == 1)
        #expect(pb.items == original)
    }

    @Test func noSelectionLeavesClipboardAlone() async {
        let pb = FakePasteboard(items: original), keys = FakeKeys()
        let start = Date()
        let text = await SelectionReader(axSelectedText: { "  " }, pasteboard: pb, keys: keys, wait: 0.2).selectedText()
        #expect(text == nil)
        #expect(pb.items == original)
        #expect(pb.changeCount == 0)
        #expect(Date().timeIntervalSince(start) < 1)
    }
}
