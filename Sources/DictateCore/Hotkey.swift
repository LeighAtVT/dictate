import Foundation

/// The key that activates dictation. Only modifier-style keys: holding them types nothing.
public enum Hotkey: String, CaseIterable, Codable, Sendable {
    case fn, rightOption, rightCommand, rightControl, rightShift, leftOption, leftControl

    public static let `default` = Hotkey.fn

    public var displayName: String {
        switch self {
        case .fn: "Fn (🌐)"
        case .rightOption: "Right Option (⌥)"
        case .rightCommand: "Right Command (⌘)"
        case .rightControl: "Right Control (⌃)"
        case .rightShift: "Right Shift (⇧)"
        case .leftOption: "Left Option (⌥)"
        case .leftControl: "Left Control (⌃)"
        }
    }

    /// Short name for instructions: "tap Fn to finish".
    public var shortName: String {
        switch self {
        case .fn: "Fn"
        case .rightOption: "Right Option"
        case .rightCommand: "Right Command"
        case .rightControl: "Right Control"
        case .rightShift: "Right Shift"
        case .leftOption: "Left Option"
        case .leftControl: "Left Control"
        }
    }

    public var keyCode: Int64 {
        switch self {
        case .fn: 63
        case .rightOption: 61
        case .rightCommand: 54
        case .rightControl: 62
        case .rightShift: 60
        case .leftOption: 58
        case .leftControl: 59
        }
    }

    /// The flag bit that is set while this exact key is down. Side-specific device bits are used so the
    /// opposite-side key being held doesn't hide a release.
    var downMask: UInt64 {
        switch self {
        case .fn: 0x800000 // maskSecondaryFn
        case .rightOption: 0x40
        case .rightCommand: 0x10
        case .rightControl: 0x2000
        case .rightShift: 0x04
        case .leftOption: 0x20
        case .leftControl: 0x01
        }
    }

    public func isDown(flags: UInt64) -> Bool { flags & downMask != 0 }
}
