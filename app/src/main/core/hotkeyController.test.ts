// Controller tests for Task 7 (dictate v2 plan 1), per the task brief: ports
// of HotkeyMonitor.handle/dispatch (hotkeyStateMachine.test.ts and
// modes.test.ts cover the ported Swift @Test cases directly). These exercise
// the controller's wiring of EngineEvents into HotkeyStateMachine/ModeTracker
// actions, plus the shortcut toggle path that has no v1 counterpart. Uses
// injected `now`/`schedule` throughout -- no real timers.
import { describe, expect, it } from 'vitest'
import { HotkeyController } from './hotkeyController'
import type { HotkeyAction } from './hotkeyStateMachine'
import type { DictationMode } from './modes'

describe('HotkeyController', () => {
  it('hold 0.5s begins, then finishes with mode edit when shift was held while the key was down', () => {
    const actions: Array<[HotkeyAction, DictationMode]> = []
    const modeChanges: DictationMode[] = []
    let t = 10.0
    const controller = new HotkeyController(
      'control',
      (a, m) => actions.push([a, m]),
      () => t,
      () => 0
    )
    controller.onModeChange = (m) => modeChanges.push(m)

    controller.onEvent({ event: 'key', down: true, held: [] })
    controller.onEvent({ event: 'modifiers', held: ['shift'] })
    t = 10.5
    controller.onEvent({ event: 'key', down: false, held: [] })

    expect(actions).toEqual([
      ['beginRecording', 'dictate'],
      ['finishRecording', 'edit'],
    ])
    expect(modeChanges).toEqual(['edit'])
  })

  it('shift pressed during hands-free dictation (key up) does not change the mode', () => {
    const actions: Array<[HotkeyAction, DictationMode]> = []
    const modeChanges: DictationMode[] = []
    let t = 1.0
    const controller = new HotkeyController(
      'control',
      (a, m) => actions.push([a, m]),
      () => t,
      () => 0
    )
    controller.onModeChange = (m) => modeChanges.push(m)

    controller.onEvent({ event: 'key', down: true, held: [] }) // t=1.0: begin
    t = 1.1
    controller.onEvent({ event: 'key', down: false, held: [] }) // short tap
    t = 1.3
    controller.onEvent({ event: 'key', down: true, held: [] }) // second tap: lockRecording
    t = 1.4
    controller.onEvent({ event: 'key', down: false, held: [] }) // hands-free: key released (locked)

    controller.onEvent({ event: 'modifiers', held: ['shift'] }) // shift pressed while key is up

    t = 9.0
    controller.onEvent({ event: 'key', down: true, held: [] }) // finishing tap

    expect(modeChanges).toEqual([])
    expect(actions).toEqual([
      ['beginRecording', 'dictate'],
      ['lockRecording', 'dictate'],
      ['finishRecording', 'dictate'],
    ])
  })

  it('a short tap with no second tap cancels after the double-tap window (fake schedule)', () => {
    const actions: Array<[HotkeyAction, DictationMode]> = []
    let scheduled: { fn: () => void; ms: number } | null = null
    let t = 1.0
    const controller = new HotkeyController(
      'control',
      (a, m) => actions.push([a, m]),
      () => t,
      (fn, ms) => {
        scheduled = { fn, ms }
      }
    )

    controller.onEvent({ event: 'key', down: true, held: [] }) // begin
    t = 1.1
    controller.onEvent({ event: 'key', down: false, held: [] }) // short tap: awaiting second tap

    expect(scheduled).not.toBeNull()
    expect(scheduled!.ms).toBe(350)

    t = 1.45 // 1.1 + DOUBLE_TAP_WINDOW
    scheduled!.fn()

    expect(actions).toEqual([
      ['beginRecording', 'dictate'],
      ['cancelRecording', 'dictate'],
    ])
  })

  it('shortcut toggle: note begins, dictate finishes with the mode it began with', () => {
    const actions: Array<[HotkeyAction, DictationMode]> = []
    const controller = new HotkeyController('control', (a, m) => actions.push([a, m]))

    controller.onEvent({ event: 'shortcut', action: 'note' })
    controller.onEvent({ event: 'shortcut', action: 'dictate' })

    expect(actions).toEqual([
      ['beginRecording', 'note'],
      ['finishRecording', 'note'],
    ])
  })

  it('reset() while recording cancels it', () => {
    const actions: Array<[HotkeyAction, DictationMode]> = []
    const controller = new HotkeyController('control', (a, m) => actions.push([a, m]))

    controller.onEvent({ event: 'key', down: true, held: [] }) // begin
    controller.reset()

    expect(actions).toEqual([
      ['beginRecording', 'dictate'],
      ['cancelRecording', 'dictate'],
    ])
  })

  // Fix round 1: whichever path began the recording owns it until it ends.
  it('a shortcut during a hold recording is ignored; key-up still finishes with the hold mode', () => {
    const actions: Array<[HotkeyAction, DictationMode]> = []
    let t = 1.0
    const controller = new HotkeyController(
      'control',
      (a, m) => actions.push([a, m]),
      () => t,
      () => 0
    )

    controller.onEvent({ event: 'key', down: true, held: [] }) // begin hold
    controller.onEvent({ event: 'shortcut', action: 'note' }) // ignored: hold owns the recording
    t = 1.5
    controller.onEvent({ event: 'key', down: false, held: [] }) // finish hold

    expect(actions).toEqual([
      ['beginRecording', 'dictate'],
      ['finishRecording', 'dictate'],
    ])
  })

  it('key down/up during a toggle recording is ignored; the next shortcut still finishes with the toggle mode', () => {
    const actions: Array<[HotkeyAction, DictationMode]> = []
    let t = 1.0
    const controller = new HotkeyController(
      'control',
      (a, m) => actions.push([a, m]),
      () => t,
      () => 0
    )

    controller.onEvent({ event: 'shortcut', action: 'note' }) // begin toggle
    controller.onEvent({ event: 'key', down: true, held: [] }) // ignored: toggle owns the recording
    t = 1.5
    controller.onEvent({ event: 'key', down: false, held: [] }) // ignored
    controller.onEvent({ event: 'shortcut', action: 'dictate' }) // finish toggle

    expect(actions).toEqual([
      ['beginRecording', 'note'],
      ['finishRecording', 'note'],
    ])
  })

  it('a hold works normally after a toggle recording finishes', () => {
    const actions: Array<[HotkeyAction, DictationMode]> = []
    let t = 1.0
    const controller = new HotkeyController(
      'control',
      (a, m) => actions.push([a, m]),
      () => t,
      () => 0
    )

    controller.onEvent({ event: 'shortcut', action: 'note' }) // begin toggle
    controller.onEvent({ event: 'shortcut', action: 'dictate' }) // finish toggle

    controller.onEvent({ event: 'key', down: true, held: [] }) // begin hold
    t = 1.5
    controller.onEvent({ event: 'key', down: false, held: [] }) // finish hold

    expect(actions).toEqual([
      ['beginRecording', 'note'],
      ['finishRecording', 'note'],
      ['beginRecording', 'dictate'],
      ['finishRecording', 'dictate'],
    ])
  })

  // Added for review round 1 (ruling R9): Pipeline.handle now drops a beginRecording outright
  // while busy (pendingFinishes), but HotkeyController's onAction is fire-and-forget -- its
  // signature returns void, so the controller never inspects what the pipeline did with the
  // action. holdActive/toggleMode are driven purely by the state machine's own transitions, so a
  // begin the pipeline silently drops can't corrupt the matching finish or the next hold cycle.
  it('consecutive hold-to-talk cycles stay independent of whatever the pipeline did with the previous one', () => {
    const actions: Array<[HotkeyAction, DictationMode]> = []
    let t = 1.0
    const controller = new HotkeyController(
      'control',
      (a, m) => actions.push([a, m]),
      () => t,
      () => 0
    )

    controller.onEvent({ event: 'key', down: true, held: [] }) // begin #1
    t = 1.5
    controller.onEvent({ event: 'key', down: false, held: [] }) // finish #1

    t = 2.0
    controller.onEvent({ event: 'key', down: true, held: [] }) // begin #2
    t = 2.5
    controller.onEvent({ event: 'key', down: false, held: [] }) // finish #2

    expect(actions).toEqual([
      ['beginRecording', 'dictate'],
      ['finishRecording', 'dictate'],
      ['beginRecording', 'dictate'],
      ['finishRecording', 'dictate'],
    ])
  })

  it('escape cancels a toggle recording; otherKey does not', () => {
    const actions: Array<[HotkeyAction, DictationMode]> = []
    const controller = new HotkeyController('control', (a, m) => actions.push([a, m]))

    controller.onEvent({ event: 'shortcut', action: 'edit' }) // begin toggle
    controller.onEvent({ event: 'otherKey' }) // ignored: doesn't cancel a toggle recording
    controller.onEvent({ event: 'escape' }) // cancels the toggle recording

    expect(actions).toEqual([
      ['beginRecording', 'edit'],
      ['cancelRecording', 'edit'],
    ])
  })
})
