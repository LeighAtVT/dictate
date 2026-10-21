// Ported from Tests/DictateCoreTests/HotkeyStateMachineTests.swift. The
// `HotkeyKeyTests` suite in that file covers the Swift `Hotkey` enum (key
// codes/names), which has no TS counterpart in this task, so it isn't ported
// here.
import { describe, expect, it } from 'vitest'
import { HotkeyStateMachine } from './hotkeyStateMachine'

describe('HotkeyStateMachine', () => {
  // @Test holdLongEnoughFinishes
  it('finishes when held long enough', () => {
    const m = new HotkeyStateMachine()
    expect(m.handle({ t: 'keyDown', at: 10.0 })).toBe('beginRecording')
    expect(m.handle({ t: 'keyUp', at: 10.5 })).toBe('finishRecording')
  })

  // @Test shortTapKeepsListeningUntilTimeout
  it('keeps listening after a short tap until timeout', () => {
    const m = new HotkeyStateMachine()
    m.handle({ t: 'keyDown', at: 10.0 })
    expect(m.handle({ t: 'keyUp', at: 10.1 })).toBe('none')
    expect(m.handle({ t: 'timeout', at: 10.5 })).toBe('cancelRecording')
  })

  // @Test doubleTapLocksThenTapFinishes
  it('locks on double-tap, then a tap finishes', () => {
    const m = new HotkeyStateMachine()
    m.handle({ t: 'keyDown', at: 1.0 })
    m.handle({ t: 'keyUp', at: 1.1 })
    expect(m.handle({ t: 'keyDown', at: 1.3 })).toBe('lockRecording')
    expect(m.handle({ t: 'keyUp', at: 1.4 })).toBe('none')
    expect(m.handle({ t: 'timeout', at: 1.8 })).toBe('none')
    expect(m.handle({ t: 'keyDown', at: 9.0 })).toBe('finishRecording')
    expect(m.handle({ t: 'keyUp', at: 9.1 })).toBe('none')
    expect(m.handle({ t: 'keyDown', at: 10.0 })).toBe('beginRecording')
  })

  // @Test escapeCancelsLocked
  it('escape cancels a locked (hands-free) recording', () => {
    const m = new HotkeyStateMachine()
    m.handle({ t: 'keyDown', at: 1.0 })
    m.handle({ t: 'keyUp', at: 1.1 })
    m.handle({ t: 'keyDown', at: 1.3 })
    m.handle({ t: 'keyUp', at: 1.4 })
    expect(m.handle({ t: 'escapeDown' })).toBe('cancelRecording')
    expect(m.handle({ t: 'keyDown', at: 5.0 })).toBe('beginRecording')
  })

  // @Test otherKeysIgnoredWhileLocked
  it('ignores other keys while locked', () => {
    const m = new HotkeyStateMachine()
    m.handle({ t: 'keyDown', at: 1.0 })
    m.handle({ t: 'keyUp', at: 1.1 })
    m.handle({ t: 'keyDown', at: 1.3 })
    m.handle({ t: 'keyUp', at: 1.4 })
    expect(m.handle({ t: 'otherKeyDown' })).toBe('none')
    expect(m.handle({ t: 'keyDown', at: 3.0 })).toBe('finishRecording')
  })

  // @Test staleTimeoutAfterLockIsIgnored
  it('ignores a stale timeout after locking', () => {
    const m = new HotkeyStateMachine()
    m.handle({ t: 'keyDown', at: 1.0 })
    m.handle({ t: 'keyUp', at: 1.1 })
    expect(m.handle({ t: 'keyDown', at: 1.3 })).toBe('lockRecording')
    expect(m.handle({ t: 'timeout', at: 1.45 })).toBe('none')
  })

  // @Test cancelsWhenAnotherKeyPressed
  it('cancels when another key is pressed while holding', () => {
    const m = new HotkeyStateMachine()
    m.handle({ t: 'keyDown', at: 10.0 })
    expect(m.handle({ t: 'otherKeyDown' })).toBe('cancelRecording')
    expect(m.handle({ t: 'keyUp', at: 11.0 })).toBe('none')
  })

  // @Test otherKeyDuringTapWindowCancels
  it('cancels when another key is pressed during the tap window', () => {
    const m = new HotkeyStateMachine()
    m.handle({ t: 'keyDown', at: 1.0 })
    m.handle({ t: 'keyUp', at: 1.1 })
    expect(m.handle({ t: 'otherKeyDown' })).toBe('cancelRecording')
  })

  // @Test upWithoutDownIsNone
  it('does nothing for a key-up with no prior key-down', () => {
    const m = new HotkeyStateMachine()
    expect(m.handle({ t: 'keyUp', at: 1.0 })).toBe('none')
  })

  // @Test repeatedDownWhileHeldIsNone
  it('does nothing for a repeated key-down while already held', () => {
    const m = new HotkeyStateMachine()
    m.handle({ t: 'keyDown', at: 1.0 })
    expect(m.handle({ t: 'keyDown', at: 1.1 })).toBe('none')
  })

  // @Test worksAgainAfterCancel
  it('works again after a cancel', () => {
    const m = new HotkeyStateMachine()
    m.handle({ t: 'keyDown', at: 1.0 })
    m.handle({ t: 'otherKeyDown' })
    m.handle({ t: 'keyUp', at: 1.5 })
    expect(m.handle({ t: 'keyDown', at: 2.0 })).toBe('beginRecording')
    expect(m.handle({ t: 'keyUp', at: 3.0 })).toBe('finishRecording')
  })
})
