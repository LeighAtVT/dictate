// Dictate v2, Task 11: end-to-end test helper (scripts/e2e-mac.sh). Holds the Fn key for the given
// number of seconds by posting synthetic `flagsChanged` events for keycode 63, as a real Fn press
// does: one with `maskSecondaryFn` set, then, after the hold, one with it cleared.
//
//   swiftc native/mac/Tools/press-fn.swift -o press-fn && ./press-fn 1.5
//
// Posting keyboard events needs the posting process (or the app that launched it, e.g. the
// terminal) to be allowed under Privacy & Security → Accessibility.
import CoreGraphics
import Foundation

let fnKeyCode: CGKeyCode = 63

guard CommandLine.arguments.count == 2, let seconds = Double(CommandLine.arguments[1]), seconds >= 0 else {
    FileHandle.standardError.write(Data("usage: press-fn <seconds>\n".utf8))
    exit(2)
}

func postFn(down: Bool) {
    guard let event = CGEvent(keyboardEventSource: nil, virtualKey: fnKeyCode, keyDown: down) else {
        FileHandle.standardError.write(Data("press-fn: couldn't create the event\n".utf8))
        exit(1)
    }
    event.type = .flagsChanged
    event.flags = down ? .maskSecondaryFn : []
    event.post(tap: .cghidEventTap)
}

postFn(down: true)
Thread.sleep(forTimeInterval: seconds)
postFn(down: false)
