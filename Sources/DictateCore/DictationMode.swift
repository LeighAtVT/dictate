import Foundation

/// What a recording is for, chosen by modifiers held with the dictation key.
public enum DictationMode: Sendable, Equatable {
    case dictate, edit, note

    static let shiftBits: UInt64 = 0x02 | 0x04 // left, right
    static let controlBits: UInt64 = 0x01 | 0x2000 // left, right

    /// Shift → edit, Control → note (Control wins: a note never changes the document).
    /// The dictation key's own bit is ignored, so Right Shift as the key isn't read as Shift.
    public static func from(flags: UInt64, excluding hotkey: Hotkey) -> DictationMode {
        let held = flags & ~hotkey.downMask
        if held & controlBits != 0 { return .note }
        if held & shiftBits != 0 { return .edit }
        return .dictate
    }
}

/// Collects every modifier held at any point during one recording.
public struct ModeTracker: Sendable {
    let hotkey: Hotkey
    private var held: UInt64 = 0

    public init(hotkey: Hotkey) {
        self.hotkey = hotkey
    }

    public var mode: DictationMode { DictationMode.from(flags: held, excluding: hotkey) }

    public mutating func begin(flags: UInt64) {
        held = flags
    }

    /// Returns the new mode when this change altered it.
    public mutating func update(flags: UInt64) -> DictationMode? {
        let before = mode
        held |= flags
        return mode == before ? nil : mode
    }
}
