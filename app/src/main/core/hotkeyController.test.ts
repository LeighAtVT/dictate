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

  // Added for review round 2 (ruling R11): a toggle-shortcut begin the pipeline drops (canBegin
  // false, e.g. a previous dictation still Working) must not leave toggleMode set -- otherwise
  // every key/otherKey event is thrown away (:70/:79) and the hold-to-talk key goes dead with no
  // sign why, recoverable only by another shortcut tap or Escape. Replaces the round-1 test that
  // covered this spot (it never actually dropped anything, so it couldn't have caught R11).
  it('a dropped toggle-shortcut begin (canBegin false) does not wedge the hold-to-talk key', () => {
    const actions: Array<[HotkeyAction, DictationMode]> = []
    let canBegin = false
    let t = 1.0
    const controller = new HotkeyController(
      'control',
      (a, m) => actions.push([a, m]),
      () => t,
      () => 0,
      () => canBegin
    )

    controller.onEvent({ event: 'shortcut', action: 'note' }) // dropped: canBegin is false, toggleMode stays null
    canBegin = true
    controller.onEvent({ event: 'key', down: true, held: [] }) // begin hold
    t = 1.5
    controller.onEvent({ event: 'key', down: false, held: [] }) // finish hold

    expect(actions).toEqual([
      ['beginRecording', 'dictate'],
      ['finishRecording', 'dictate'],
    ])
  })

  // Added for review round 2 (ruling R11): the hold path's state machine fires beginRecording
  // regardless of canBegin (it has no notion of the pipeline), and the pipeline's own drop check
  // makes that harmless -- but holdActive/modes.begin/onModeChange must not act as if a
  // recording actually started, or a stray onModeChange would fire for a dictation that never
  // began.
  it('a hold while canBegin is false fires no onModeChange, even with a mode modifier already held', () => {
    const actions: Array<[HotkeyAction, DictationMode]> = []
    const modeChanges: DictationMode[] = []
    let t = 1.0
    const controller = new HotkeyController(
      'control',
      (a, m) => actions.push([a, m]),
      () => t,
      () => 0,
      () => false
    )
    controller.onModeChange = (m) => modeChanges.push(m)

    controller.onEvent({ event: 'key', down: true, held: ['shift'] }) // begin dropped by canBegin; shift would normally mean edit mode
    t = 1.5
    controller.onEvent({ event: 'key', down: false, held: [] }) // finish

    expect(modeChanges).toEqual([])
    expect(actions).toEqual([
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
