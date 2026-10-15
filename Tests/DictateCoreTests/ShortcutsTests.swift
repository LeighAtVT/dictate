import Foundation
import Testing
@testable import DictateCore

@Suite struct ShortcutsTests {
    let zoom = Shortcut(phrase: "my zoom link", text: "https://zoom.us/j/1")

    @Test func normalizes() {
        #expect(ShortcutMatcher.normalize("  My, Zoom   link! ") == "my zoom link")
    }

    @Test func matchesWholeUtteranceOnly() {
        #expect(ShortcutMatcher.match("My zoom link.", in: [zoom]) == zoom)
        #expect(ShortcutMatcher.match("send my zoom link", in: [zoom]) == nil)
    }

    @Test func blankPhraseNeverMatches() {
        #expect(ShortcutMatcher.match("", in: [Shortcut(phrase: " ", text: "x")]) == nil)
        #expect(ShortcutMatcher.match("!", in: [Shortcut(phrase: "?", text: "x")]) == nil)
    }

    @Test func storeRoundTripsAndDropsBlankPhrases() throws {
        let store = ShortcutStore(fileURL: FileManager.default.temporaryDirectory.appendingPathComponent("s-\(UUID()).json"))
        #expect(store.load().isEmpty)
        try store.save([zoom, Shortcut(phrase: "  ", text: "dropped")])
        #expect(store.load() == [zoom])
    }

    @Test func loadsFilesWithoutIDs() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("s-\(UUID()).json")
        try Data(#"[{"phrase":"sig","text":"Thanks,\nL"}]"#.utf8).write(to: url)
        let loaded = ShortcutStore(fileURL: url).load()
        #expect(loaded.count == 1)
        #expect(loaded.first?.text == "Thanks,\nL")
    }
}
