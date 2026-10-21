// Ported from Tests/DictateCoreTests/DictationModeTests.swift, translating
// flag bits into modifier names (shift bits -> 'shift', control bits ->
// 'control'; the Swift tests use Control as the note modifier throughout).
//
// `resolvesFromDeviceBits` and `dictationKeyNeverCountsAsItsOwnModifier` both
// exercised `DictationMode.from(flags:excluding:)`'s hotkey-bit masking. That
// masking moved to the engine (Task 6) in v2 -- see the comment in modes.ts
// -- so `modeFrom` here only ever sees an already-excluded `held` list.
// `dictationKeyNeverCountsAsItsOwnModifier`'s Swift cases all reduce, once
// the hotkey's own bit is excluded, to the same inputs/outputs as
// `resolvesFromDeviceBits`'s plain cases; it's ported as an explicit
// assertion that an empty/non-hotkey held list still resolves correctly.
import { describe, expect, it } from 'vitest'
import { modeFrom, ModeTracker } from './modes'

describe('modeFrom', () => {
  // @Test resolvesFromDeviceBits
  it('resolves dictate/edit/note from held modifiers, note winning over edit', () => {
    expect(modeFrom(['shift'], 'control')).toBe('edit') // 0x800000 | 0x02 (left shift)
    expect(modeFrom(['shift'], 'control')).toBe('edit') // 0x800000 | 0x04 (right shift)
    expect(modeFrom(['control'], 'control')).toBe('note') // 0x800000 | 0x2000 (right control)
    expect(modeFrom(['control'], 'control')).toBe('note') // 0x800000 | 0x01 (left control)
    expect(modeFrom(['shift', 'control'], 'control')).toBe('note') // 0x02 | 0x01: control wins
    expect(modeFrom([], 'control')).toBe('dictate') // 0x800000 alone
  })

  // @Test dictationKeyNeverCountsAsItsOwnModifier
  it('never reads the dictation key itself as a modifier (exclusion happens upstream)', () => {
    // Swift: DictationMode.from(flags: 0x04, excluding: .rightShift) == .dictate
    // (0x04 is the hotkey's own bit here, so once excluded, held is empty)
    expect(modeFrom([], 'control')).toBe('dictate')
    // Swift: DictationMode.from(flags: 0x04 | 0x02, excluding: .rightShift) == .edit
    expect(modeFrom(['shift'], 'control')).toBe('edit')
    // Swift: DictationMode.from(flags: 0x2000, excluding: .rightControl) == .dictate
    expect(modeFrom([], 'control')).toBe('dictate')
    // Swift: DictationMode.from(flags: 0x01, excluding: .leftControl) == .dictate
    expect(modeFrom([], 'control')).toBe('dictate')
  })
})

describe('ModeTracker', () => {
  // @Test shiftPressedBeforeTheKeyCounts
  it('counts a modifier already held when the key goes down', () => {
    const tracker = new ModeTracker('control')
    tracker.begin(['shift']) // Shift already down when the dictation key goes down
    expect(tracker.mode).toBe('edit')
  })

  // @Test modifierHeldBrieflyStillCounts
  it('keeps the mode sticky after a briefly-held modifier is released', () => {
    const tracker = new ModeTracker('control')
    tracker.begin([])
    expect(tracker.update(['control'], true)).toBe('note') // changed
    expect(tracker.update([], true)).toBeNull() // released, but the mode sticks
    expect(tracker.mode).toBe('note')
    tracker.begin([]) // next recording starts fresh
    expect(tracker.mode).toBe('dictate')
  })

  // @Test modifiersOnlyCountWhileTheKeyIsHeld
  it('ignores modifier changes while the dictation key is up', () => {
    const tracker = new ModeTracker('control')
    tracker.begin([])
    expect(tracker.update(['shift'], false)).toBeNull() // hands-free: typing a capital letter
    expect(tracker.mode).toBe('dictate')
  })
})
