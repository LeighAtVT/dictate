import Foundation

/// What Accessibility says about the selection in the focused element.
public enum SelectionProbe: Sendable, Equatable {
    case text(String) // selected text, read directly
    case empty // the element reports a zero-length selection (some apps under-report this)
    case unknown // the element doesn't expose its selection
}

@MainActor
public protocol SelectionReading: AnyObject {
    /// The highlighted text in the frontmost app, or nil when nothing is selected.
    func selectedText() async -> String?
}

/// Reads the selection through Accessibility, falling back to ⌘C for apps that don't expose it
/// (Electron, many web pages). The user's clipboard is put back afterwards.
@MainActor
public final class SelectionReader: SelectionReading {
    let probe: () -> SelectionProbe
    let pasteboard: Pasteboarding
    let keys: KeySending
    let wait: TimeInterval

    public init(probe: @escaping () -> SelectionProbe, pasteboard: Pasteboarding, keys: KeySending, wait: TimeInterval = 0.2) {
        self.probe = probe
        self.pasteboard = pasteboard
        self.keys = keys
        self.wait = wait
    }

    public func selectedText() async -> String? {
        let probed = probe()
        if case .text(let text) = probed, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return text }

        let saved = pasteboard.snapshot()
        let before = pasteboard.changeCount
        keys.sendCommandC()
        let deadline = Date().addingTimeInterval(wait)
        while pasteboard.changeCount == before, Date() < deadline {
            try? await Task.sleep(for: .milliseconds(20))
        }
        guard pasteboard.changeCount != before else {
            rollBackLateCopy(saved, since: before)
            return nil // nothing was selected
        }
        let copied = pasteboard.readString()
        pasteboard.restore(saved)
        guard let copied, !copied.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        // Code editors copy the whole current line when nothing is selected. When Accessibility also says
        // the selection is empty, a single line ending in a newline is that, not a selection.
        if probed == .empty, copied.hasSuffix("\n"), !copied.dropLast().contains(where: \.isNewline) { return nil }
        return copied
    }

    /// A slow app may answer ⌘C after we gave up; put the user's clipboard back if it does.
    private func rollBackLateCopy(_ saved: [[String: Data]], since count: Int) {
        Task { @MainActor [pasteboard] in
            let deadline = Date().addingTimeInterval(1)
            while Date() < deadline {
                try? await Task.sleep(for: .milliseconds(50))
                if pasteboard.changeCount != count {
                    pasteboard.restore(saved)
                    return
                }
            }
        }
    }
}
