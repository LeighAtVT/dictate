import AppKit

/// Listen-only event tap that turns presses of the chosen key into hotkey actions on the main thread.
public final class HotkeyMonitor: @unchecked Sendable { // used only on the main thread
    static let escapeKeyCode: Int64 = 53

    /// Changing the key resets any dictation in progress.
    public var hotkey: Hotkey {
        didSet {
            if machine.state != .idle { onAction(.cancelRecording) }
            machine = HotkeyStateMachine()
        }
    }

    private let onAction: (HotkeyAction) -> Void
    private var machine = HotkeyStateMachine()
    private var tap: CFMachPort?

    public init(hotkey: Hotkey = .default, onAction: @escaping (HotkeyAction) -> Void) {
        self.hotkey = hotkey
        self.onAction = onAction
    }

    /// Returns false when Accessibility permission has not been granted.
    public func start() -> Bool {
        guard tap == nil else { return true }
        let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, refcon in
            guard let refcon else { return Unmanaged.passUnretained(event) }
            Unmanaged<HotkeyMonitor>.fromOpaque(refcon).takeUnretainedValue().handle(type, event)
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
        let now = ProcessInfo.processInfo.systemUptime
        let hotkeyEvent: HotkeyEvent?
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            hotkeyEvent = nil
        case .keyDown:
            hotkeyEvent = event.getIntegerValueField(.keyboardEventKeycode) == Self.escapeKeyCode ? .escapeDown : .otherKeyDown
        case .flagsChanged where event.getIntegerValueField(.keyboardEventKeycode) == hotkey.keyCode:
            hotkeyEvent = hotkey.isDown(flags: event.flags.rawValue) ? .keyDown(now) : .keyUp(now)
        default:
            hotkeyEvent = nil
        }
        guard let hotkeyEvent else { return }
        dispatch(hotkeyEvent)
    }

    private func dispatch(_ event: HotkeyEvent) {
        let action = machine.handle(event)
        if action != .none { onAction(action) }
        if machine.awaitingSecondTap {
            DispatchQueue.main.asyncAfter(deadline: .now() + HotkeyStateMachine.doubleTapWindow) { [weak self] in
                self?.dispatch(.timeout(ProcessInfo.processInfo.systemUptime))
            }
        }
    }
}
