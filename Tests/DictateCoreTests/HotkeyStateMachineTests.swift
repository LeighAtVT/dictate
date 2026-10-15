import CoreGraphics
import Testing
@testable import DictateCore

@Suite struct HotkeyStateMachineTests {
    @Test func holdLongEnoughFinishes() {
        var m = HotkeyStateMachine()
        #expect(m.handle(.keyDown(10.0)) == .beginRecording)
        #expect(m.handle(.keyUp(10.5)) == .finishRecording)
    }

    @Test func shortTapKeepsListeningUntilTimeout() {
        var m = HotkeyStateMachine()
        _ = m.handle(.keyDown(10.0))
        #expect(m.handle(.keyUp(10.1)) == HotkeyAction.none)
        #expect(m.handle(.timeout(10.5)) == .cancelRecording)
    }

    @Test func doubleTapLocksThenTapFinishes() {
        var m = HotkeyStateMachine()
        _ = m.handle(.keyDown(1.0))
        _ = m.handle(.keyUp(1.1))
        #expect(m.handle(.keyDown(1.3)) == .lockRecording)
        #expect(m.handle(.keyUp(1.4)) == HotkeyAction.none)
        #expect(m.handle(.timeout(1.8)) == HotkeyAction.none)
        #expect(m.handle(.keyDown(9.0)) == .finishRecording)
        #expect(m.handle(.keyUp(9.1)) == HotkeyAction.none)
        #expect(m.handle(.keyDown(10.0)) == .beginRecording)
    }

    @Test func escapeCancelsLocked() {
        var m = HotkeyStateMachine()
        _ = m.handle(.keyDown(1.0)); _ = m.handle(.keyUp(1.1)); _ = m.handle(.keyDown(1.3)); _ = m.handle(.keyUp(1.4))
        #expect(m.handle(.escapeDown) == .cancelRecording)
        #expect(m.handle(.keyDown(5.0)) == .beginRecording)
    }

    @Test func otherKeysIgnoredWhileLocked() {
        var m = HotkeyStateMachine()
        _ = m.handle(.keyDown(1.0)); _ = m.handle(.keyUp(1.1)); _ = m.handle(.keyDown(1.3)); _ = m.handle(.keyUp(1.4))
        #expect(m.handle(.otherKeyDown) == HotkeyAction.none)
        #expect(m.handle(.keyDown(3.0)) == .finishRecording)
    }

    @Test func staleTimeoutAfterLockIsIgnored() {
        var m = HotkeyStateMachine()
        _ = m.handle(.keyDown(1.0)); _ = m.handle(.keyUp(1.1))
        #expect(m.handle(.keyDown(1.3)) == .lockRecording)
        #expect(m.handle(.timeout(1.45)) == HotkeyAction.none)
    }

    @Test func cancelsWhenAnotherKeyPressed() {
        var m = HotkeyStateMachine()
        _ = m.handle(.keyDown(10.0))
        #expect(m.handle(.otherKeyDown) == .cancelRecording)
        #expect(m.handle(.keyUp(11.0)) == HotkeyAction.none)
    }

    @Test func otherKeyDuringTapWindowCancels() {
        var m = HotkeyStateMachine()
        _ = m.handle(.keyDown(1.0)); _ = m.handle(.keyUp(1.1))
        #expect(m.handle(.otherKeyDown) == .cancelRecording)
    }

    @Test func upWithoutDownIsNone() {
        var m = HotkeyStateMachine()
        #expect(m.handle(.keyUp(1.0)) == HotkeyAction.none)
    }

    @Test func repeatedDownWhileHeldIsNone() {
        var m = HotkeyStateMachine()
        _ = m.handle(.keyDown(1.0))
        #expect(m.handle(.keyDown(1.1)) == HotkeyAction.none)
    }

    @Test func worksAgainAfterCancel() {
        var m = HotkeyStateMachine()
        _ = m.handle(.keyDown(1.0)); _ = m.handle(.otherKeyDown); _ = m.handle(.keyUp(1.5))
        #expect(m.handle(.keyDown(2.0)) == .beginRecording)
        #expect(m.handle(.keyUp(3.0)) == .finishRecording)
    }
}

@Suite struct HotkeyKeyTests {
    @Test func fnIsDefaultAndMatchesGlobeKey() {
        #expect(Hotkey.default == .fn)
        #expect(Hotkey.fn.keyCode == 63)
        #expect(Hotkey.fn.isDown(flags: CGEventFlags.maskSecondaryFn.rawValue))
        #expect(!Hotkey.fn.isDown(flags: 0))
    }

    @Test func rightOptionUsesDeviceBit() {
        #expect(Hotkey.rightOption.keyCode == 61)
        #expect(Hotkey.rightOption.isDown(flags: 0x80000 | 0x40))
        // Left Option still held, right released: only the left device bit (0x20) remains.
        #expect(!Hotkey.rightOption.isDown(flags: 0x80000 | 0x20))
    }

    @Test func everyKeyHasDistinctCodeAndName() {
        #expect(Set(Hotkey.allCases.map(\.keyCode)).count == Hotkey.allCases.count)
        #expect(Hotkey.allCases.allSatisfy { !$0.displayName.isEmpty })
        #expect(Hotkey(rawValue: "rightCommand") == .rightCommand)
    }
}
