import AppKit
import DictateCore

// Dictate v2, Task 4: the engine's real keyboard tap. Reports the talk key, other modifier
// changes, Esc, and "some other key" to the brain over `EngineEvent`, using modifier names
// (never a keycode — this is the keyboard listener, so a non-Esc key's identity is never sent
// or logged). Built on the same tap setup and timeout re-enable as `HotkeyMonitor.start()`
// (`Sources/DictateCore/HotkeyMonitor.swift`), but it reports raw per-event data instead of
// running `HotkeyStateMachine` — that belongs to the brain, which owns hold/double-tap/lock
// timing over the protocol.

/// Listen-only `CGEventTap` that turns raw keyboard events into `EngineEvent`s. Used only on the
/// main thread: `start()` adds the tap's run loop source to `CFRunLoopGetMain()`, and `hotkey`
/// must only be changed from the main thread (callers hop onto it, e.g. via `MainActor.run`)
/// since the tap callback reads it on that same thread without locking.
public final class KeyTap: @unchecked Sendable { // used only on the main thread
    static let escapeKeyCode: Int64 = 53
    private static let altBits: UInt64 = 0x20 | 0x40
    private static let commandBits: UInt64 = 0x08 | 0x10

    public var hotkey: Hotkey
    private let emit: (EngineEvent) -> Void
    private var tap: CFMachPort?

    public init(hotkey: Hotkey, emit: @escaping (EngineEvent) -> Void) {
        self.hotkey = hotkey
        self.emit = emit
    }

    /// Returns false when Accessibility permission hasn't been granted (tap creation fails).
    /// Callers retry: the brain has no "start tap" request in the protocol, so the engine's own
    /// `main.swift` retries this every second until it succeeds, rather than waiting on the brain
    /// to ask again.
    public func start() -> Bool {
        guard tap == nil else { return true }
        let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, refcon in
            guard let refcon else { return Unmanaged.passUnretained(event) }
            Unmanaged<KeyTap>.fromOpaque(refcon).takeUnretainedValue().handle(type, event)
            return Unmanaged.passUnretained(event)
        }
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                                          eventsOfInterest: CGEventMask(mask), callback: callback,
                                          userInfo: Unmanaged.passUnretained(self).toOpaque()) else { return false }
        self.tap = tap
        CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(nil, tap, 0), .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        return true
    }

    private func handle(_ type: CGEventType, _ event: CGEvent) {
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
        case .keyDown:
            // The keycode of a non-Esc key is never sent or logged.
            emit(event.getIntegerValueField(.keyboardEventKeycode) == Self.escapeKeyCode ? .escape : .otherKey)
        case .flagsChanged where event.getIntegerValueField(.keyboardEventKeycode) == hotkey.keyCode:
            let flags = event.flags.rawValue
            emit(.key(down: hotkey.isDown(flags: flags), held: Self.heldModifiers(flags: flags, excluding: hotkey)))
        case .flagsChanged:
            emit(.modifiers(held: Self.heldModifiers(flags: event.flags.rawValue, excluding: hotkey)))
        default:
            break
        }
    }

    /// Pure: which modifiers are held in `flags`, excluding the hotkey's own bit first (so e.g.
    /// Right Shift as the hotkey isn't also reported as held Shift). Order: shift, control, alt,
    /// command.
    static func heldModifiers(flags: UInt64, excluding hotkey: Hotkey) -> [Modifier] {
        let held = flags & ~hotkey.downMask
        var result: [Modifier] = []
        if held & DictationMode.shiftBits != 0 { result.append(.shift) }
        if held & DictationMode.controlBits != 0 { result.append(.control) }
        if held & altBits != 0 { result.append(.alt) }
        if held & commandBits != 0 { result.append(.command) }
        return result
    }
}
