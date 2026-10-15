import Foundation

@MainActor
public protocol SelectionReading: AnyObject {
    /// The highlighted text in the frontmost app, or nil when nothing is selected.
    func selectedText() async -> String?
}

/// Reads the selection through Accessibility, falling back to ⌘C for apps that don't expose it
/// (Electron, many web pages). The user's clipboard is put back afterwards.
@MainActor
public final class SelectionReader: SelectionReading {
    let axSelectedText: () -> String?
    let pasteboard: Pasteboarding
    let keys: KeySending
    let wait: TimeInterval

    public init(axSelectedText: @escaping () -> String?, pasteboard: Pasteboarding, keys: KeySending, wait: TimeInterval = 0.2) {
        self.axSelectedText = axSelectedText
        self.pasteboard = pasteboard
        self.keys = keys
        self.wait = wait
    }

    public func selectedText() async -> String? {
        if let text = axSelectedText(), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return text }

        let saved = pasteboard.snapshot()
        let before = pasteboard.changeCount
        keys.sendCommandC()
        let deadline = Date().addingTimeInterval(wait)
        while pasteboard.changeCount == before, Date() < deadline {
            try? await Task.sleep(for: .milliseconds(20))
        }
        guard pasteboard.changeCount != before else { return nil } // nothing was selected
        let copied = pasteboard.readString()
        pasteboard.restore(saved)
        guard let copied, !copied.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return copied
    }
}
