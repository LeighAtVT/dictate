import AppKit
import DictateCore
import Foundation

// Dictate v2 Mac Preview, Task 1: proves a signed Swift engine, spawned by the
// Electron shell, shares the app's Accessibility grant through a listen-only
// CGEventTap. (The spike's periodic accessibility/microphone status reporting and
// 3-second test recording were removed once the spike passed; see the design spec,
// section 4, for the evidence.) The real engine protocol (JSON-line requests and
// events, spec section 2.3) is built in a later task.

/// Prints one line to stdout and flushes immediately: stdout is fully buffered when
/// piped (not a tty), and the Electron parent reads lines as they arrive.
func emit(_ line: String) {
    print(line)
    fflush(stdout)
}

/// Listen-only CGEventTap, created exactly as `HotkeyMonitor.start()` does, narrowed
/// to the default hotkey (Fn) only.
final class KeyTap: @unchecked Sendable {
    private var tap: CFMachPort?

    func start() {
        guard tap == nil else { return }
        let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, refcon in
            guard let refcon else { return Unmanaged.passUnretained(event) }
            Unmanaged<KeyTap>.fromOpaque(refcon).takeUnretainedValue().handle(type, event)
            return Unmanaged.passUnretained(event)
        }
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                                          eventsOfInterest: CGEventMask(mask), callback: callback,
                                          userInfo: Unmanaged.passUnretained(self).toOpaque()) else {
            emit("{\"event\":\"error\",\"message\":\"CGEventTap creation failed\"}")
            return
        }
        self.tap = tap
        CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(nil, tap, 0), .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
    }

    private func handle(_ type: CGEventType, _ event: CGEvent) {
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
        case .flagsChanged where event.getIntegerValueField(.keyboardEventKeycode) == Hotkey.fn.keyCode:
            emit("{\"event\":\"key\",\"down\":\(Hotkey.fn.isDown(flags: event.flags.rawValue))}")
        default:
            break
        }
    }
}

emit("{\"event\":\"start\"}")
let keyTap = KeyTap()
keyTap.start()
RunLoop.main.run()
