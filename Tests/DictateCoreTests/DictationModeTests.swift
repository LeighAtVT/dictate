import Testing
@testable import DictateCore

@Suite struct DictationModeTests {
    @Test func resolvesFromDeviceBits() {
        #expect(DictationMode.from(flags: 0x800000 | 0x02, excluding: .fn) == .edit)
        #expect(DictationMode.from(flags: 0x800000 | 0x04, excluding: .fn) == .edit)
        #expect(DictationMode.from(flags: 0x800000 | 0x2000, excluding: .fn) == .note)
        #expect(DictationMode.from(flags: 0x800000 | 0x01, excluding: .fn) == .note)
        #expect(DictationMode.from(flags: 0x02 | 0x01, excluding: .fn) == .note)
        #expect(DictationMode.from(flags: 0x800000, excluding: .fn) == .dictate)
    }

    @Test func dictationKeyNeverCountsAsItsOwnModifier() {
        #expect(DictationMode.from(flags: 0x04, excluding: .rightShift) == .dictate)
        #expect(DictationMode.from(flags: 0x04 | 0x02, excluding: .rightShift) == .edit)
        #expect(DictationMode.from(flags: 0x2000, excluding: .rightControl) == .dictate)
        #expect(DictationMode.from(flags: 0x01, excluding: .leftControl) == .dictate)
    }

    @Test func shiftPressedBeforeTheKeyCounts() {
        var tracker = ModeTracker(hotkey: .fn)
        tracker.begin(flags: 0x800000 | 0x02) // Shift already down when Fn goes down
        #expect(tracker.mode == .edit)
    }

    @Test func modifierHeldBrieflyStillCounts() {
        var tracker = ModeTracker(hotkey: .fn)
        tracker.begin(flags: 0x800000)
        #expect(tracker.update(flags: 0x800000 | 0x2000) == .note) // changed
        #expect(tracker.update(flags: 0x800000) == nil) // released, but the mode sticks
        #expect(tracker.mode == .note)
        tracker.begin(flags: 0x800000) // next recording starts fresh
        #expect(tracker.mode == .dictate)
    }

    @Test func modifiersOnlyCountWhileTheKeyIsHeld() {
        var tracker = ModeTracker(hotkey: .fn)
        tracker.begin(flags: 0x800000)
        #expect(tracker.update(flags: 0x02) == nil) // hands-free, Fn released: typing a capital letter
        #expect(tracker.mode == .dictate)
    }
}
