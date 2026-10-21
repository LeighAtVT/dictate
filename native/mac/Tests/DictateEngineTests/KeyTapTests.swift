import DictateCore
import Testing
@testable import EngineKit

// Dictate v2, Task 4: `KeyTap.heldModifiers` is a pure function (the rest of `KeyTap` is a live
// `CGEventTap` and isn't unit-testable), so these are its only tests. See the task brief's Step 1
// for the exact cases.

@Suite struct KeyTapTests {
    @Test func rightShiftAsHotkeyReportsNothingElseHeld() {
        #expect(KeyTap.heldModifiers(flags: 0x04, excluding: .rightShift) == [])
    }

    @Test func fnWithLeftShiftReportsShift() {
        #expect(KeyTap.heldModifiers(flags: 0x02, excluding: .fn) == [.shift])
    }

    @Test func fnWithRightControlAndLeftOptionReportsControlThenAlt() {
        #expect(KeyTap.heldModifiers(flags: 0x2000 | 0x20, excluding: .fn) == [.control, .alt])
    }

    @Test func rightOptionAsHotkeyWithLeftOptionAlsoDownReportsAlt() {
        #expect(KeyTap.heldModifiers(flags: 0x40 | 0x20, excluding: .rightOption) == [.alt])
    }
}
