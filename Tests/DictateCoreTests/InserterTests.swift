import Foundation
import Testing
@testable import DictateCore

final class FakePasteboard: Pasteboarding, @unchecked Sendable {
    var items: [[String: Data]]
    var changeCount = 0
    var onSet: (() -> Void)?

    init(items: [[String: Data]] = []) { self.items = items }

    func snapshot() -> [[String: Data]] { items }
    func restore(_ items: [[String: Data]]) { self.items = items; changeCount += 1 }
    func setString(_ s: String) {
        items = [["public.utf8-plain-text": Data(s.utf8)]]
        changeCount += 1
        onSet?()
    }
    var string: String? { items.first?["public.utf8-plain-text"].map { String(decoding: $0, as: UTF8.self) } }
}

final class FakeKeys: KeySending, @unchecked Sendable {
    var pastes = 0
    var onPaste: (() -> Void)?
    func sendCommandV() { pastes += 1; onPaste?() }
}

@MainActor @Suite struct InserterTests {
    let original: [[String: Data]] = [["public.utf8-plain-text": Data("what I copied".utf8)]]

    @Test func pastesAndRestoresText() async {
        let pb = FakePasteboard(items: original), keys = FakeKeys()
        var clipboardAtPaste: String?
        keys.onPaste = { clipboardAtPaste = pb.string }
        let result = await Inserter(pasteboard: pb, keys: keys, restoreDelay: 0.01, hasFocusedTextField: { true }).insert("Hello")
        #expect(result == .pasted)
        #expect(keys.pastes == 1)
        #expect(clipboardAtPaste == "Hello")
        #expect(pb.items == original)
    }

    @Test func copiedOnlyWhenNoTextField() async {
        let pb = FakePasteboard(items: original), keys = FakeKeys()
        let result = await Inserter(pasteboard: pb, keys: keys, restoreDelay: 0.01, hasFocusedTextField: { false }).insert("Hello")
        #expect(result == .copiedOnly)
        #expect(keys.pastes == 0)
        #expect(pb.string == "Hello")
    }

    @Test func doesNotRestoreIfUserCopiedMeanwhile() async {
        let pb = FakePasteboard(items: original), keys = FakeKeys()
        keys.onPaste = { pb.items = [["public.utf8-plain-text": Data("newer copy".utf8)]]; pb.changeCount += 1 }
        _ = await Inserter(pasteboard: pb, keys: keys, restoreDelay: 0.01, hasFocusedTextField: { true }).insert("Hello")
        #expect(pb.string == "newer copy")
    }

    @Test func restoresNonTextPasteboardItems() async {
        let image: [[String: Data]] = [
            ["public.png": Data([0x89, 0x50, 0x4E, 0x47, 0x00, 0xFF])],
            ["public.file-url": Data("file:///Users/me/report.pdf".utf8), "public.utf8-plain-text": Data("report.pdf".utf8)],
        ]
        let pb = FakePasteboard(items: image), keys = FakeKeys()
        _ = await Inserter(pasteboard: pb, keys: keys, restoreDelay: 0.01, hasFocusedTextField: { true }).insert("Hello")
        #expect(pb.items == image)
    }
}
