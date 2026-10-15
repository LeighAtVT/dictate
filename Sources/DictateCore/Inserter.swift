import AppKit

public protocol Pasteboarding: AnyObject {
    var changeCount: Int { get }
    func snapshot() -> [[String: Data]]
    func restore(_ items: [[String: Data]])
    func setString(_ s: String)
}

public protocol KeySending {
    func sendCommandV()
}

public enum InsertResult: Equatable, Sendable {
    case pasted, copiedOnly
}

@MainActor
public protocol Inserting: AnyObject {
    func insert(_ text: String) async -> InsertResult
    /// Put text on the clipboard without pasting it anywhere.
    func copy(_ text: String)
}

/// Pastes by borrowing the clipboard, then puts back whatever the user had copied.
@MainActor
public final class Inserter: Inserting {
    let pasteboard: Pasteboarding
    let keys: KeySending
    let restoreDelay: TimeInterval
    let hasFocusedTextField: () -> Bool

    public init(pasteboard: Pasteboarding, keys: KeySending, restoreDelay: TimeInterval = 0.25, hasFocusedTextField: @escaping () -> Bool) {
        self.pasteboard = pasteboard
        self.keys = keys
        self.restoreDelay = restoreDelay
        self.hasFocusedTextField = hasFocusedTextField
    }

    public func insert(_ text: String) async -> InsertResult {
        guard hasFocusedTextField() else {
            copy(text)
            return .copiedOnly
        }
        let saved = pasteboard.snapshot()
        pasteboard.setString(text)
        let ours = pasteboard.changeCount
        keys.sendCommandV()
        try? await Task.sleep(for: .seconds(restoreDelay))
        // If the user copied something in the meantime, leave their new clipboard alone.
        if pasteboard.changeCount == ours {
            pasteboard.restore(saved)
        }
        return .pasted
    }

    public func copy(_ text: String) {
        pasteboard.setString(text)
    }
}

public final class SystemPasteboard: Pasteboarding {
    private let pb = NSPasteboard.general

    public init() {}

    public var changeCount: Int { pb.changeCount }

    public func snapshot() -> [[String: Data]] {
        (pb.pasteboardItems ?? []).map { item in
            var types: [String: Data] = [:]
            for type in item.types {
                if let data = item.data(forType: type) { types[type.rawValue] = data }
            }
            return types
        }
    }

    public func restore(_ items: [[String: Data]]) {
        pb.clearContents()
        guard !items.isEmpty else { return }
        pb.writeObjects(items.map { types in
            let item = NSPasteboardItem()
            for (type, data) in types { item.setData(data, forType: NSPasteboard.PasteboardType(type)) }
            return item
        })
    }

    public func setString(_ s: String) {
        pb.clearContents()
        pb.setString(s, forType: .string)
    }
}

public struct CGEventKeySender: KeySending {
    static let vKey: CGKeyCode = 9

    public init() {}

    public func sendCommandV() {
        let source = CGEventSource(stateID: .combinedSessionState)
        for down in [true, false] {
            let event = CGEvent(keyboardEventSource: source, virtualKey: Self.vKey, keyDown: down)
            event?.flags = .maskCommand
            event?.post(tap: .cghidEventTap)
        }
    }
}
