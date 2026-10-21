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

  // Updated for review round 3 (ruling R12): a refused hold now sends no begin and no finish at
  // all (the state machine is pushed straight to `cancelled` instead of running its normal
  // holding/tapped/locked cycle for a recording that never started -- see dispatch()). Previously
  // this asserted a stale `beginRecording`/`finishRecording` pair still went out, which is the
  // R12 defect: leaving the state machine mid-cycle let a later shortcut's toggle get cancelled
  // by a stale timer, or a later real press get eaten as a finish.
  it('a hold while canBegin is false fires no onModeChange, no begin, and no finish, even with a mode modifier already held', () => {
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
    controller.onEvent({ event: 'key', down: false, held: [] }) // the eventual release is a harmless no-op

    expect(modeChanges).toEqual([])
    expect(actions).toEqual([])
  })

  // Added for review round 3 (ruling R12): reproduces the reviewer's scratch-test scenario --
  // a tap dropped while busy must not leave a double-tap timer armed to cancel a real recording
  // that starts later.
  it('a tap while canBegin is false does not leave a stale timer to cancel a later toggle recording', () => {
    const actions: Array<[HotkeyAction, DictationMode]> = []
    let canBegin = false
    let scheduled: { fn: () => void; ms: number } | null = null
    let t = 1.0
    const controller = new HotkeyController(
      'control',
      (a, m) => actions.push([a, m]),
      () => t,
      (fn, ms) => {
        scheduled = { fn, ms }
      },
      () => canBegin
    )

    controller.onEvent({ event: 'key', down: true, held: [] }) // tap begins, dropped: canBegin is false
    t = 1.1
    controller.onEvent({ event: 'key', down: false, held: [] }) // tap release

    canBegin = true
    controller.onEvent({ event: 'shortcut', action: 'note' }) // begins a real toggle recording
    // TS narrows `scheduled`'s flow type to `null` here since its only reassignment is inside the
    // schedule callback above, which TS can't see `onEvent` ever invokes -- the cast restores the
    // declared type so the null check below type-checks.
    const timer = scheduled as { fn: () => void; ms: number } | null
    if (timer) timer.fn() // the stale double-tap timer, if one somehow got armed, must not cancel it
    controller.onEvent({ event: 'shortcut', action: 'note' }) // finishes the toggle

    expect(actions).toEqual([
      ['beginRecording', 'note'],
      ['finishRecording', 'note'],
    ])
  })

  // Added for review round 3 (ruling R12): a double-tap performed entirely while canBegin is
  // false must not leave the state machine `locked`, which would turn the next real press into
  // an eaten finishRecording instead of a normal begin.
  it('a double-tap while canBegin is false does not leave the state machine locked for the next press', () => {
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

    controller.onEvent({ event: 'key', down: true, held: [] }) // tap 1 begins, dropped
    t = 1.1
    controller.onEvent({ event: 'key', down: false, held: [] }) // tap 1 release
    t = 1.2
    controller.onEvent({ event: 'key', down: true, held: [] }) // tap 2, within the double-tap window, also dropped
    t = 1.3
    controller.onEvent({ event: 'key', down: false, held: [] }) // tap 2 release

    canBegin = true
    t = 2.0
    controller.onEvent({ event: 'key', down: true, held: [] }) // the next real press
    t = 2.5
    controller.onEvent({ event: 'key', down: false, held: [] })

    expect(actions).toEqual([
      ['beginRecording', 'dictate'],
      ['finishRecording', 'dictate'],
    ])
  })

  // Added for review round 3 (ruling R12): holding the talk key through a refused begin must not
  // leave holdActive stuck true, which would block a shortcut used while the key is still
  // physically down; the eventual release must also stay a harmless no-op.
  it('holding the key through a refused begin and then using a shortcut leaves nothing stuck', () => {
    const actions: Array<[HotkeyAction, DictationMode]> = []
    let canBegin = false
    const controller = new HotkeyController(
      'control',
      (a, m) => actions.push([a, m]),
      () => 1.0,
      () => 0,
      () => canBegin
    )

    controller.onEvent({ event: 'key', down: true, held: [] }) // held down through a refused begin
    canBegin = true
    controller.onEvent({ event: 'shortcut', action: 'note' }) // must not be blocked by a stuck holdActive
    expect(actions).toEqual([['beginRecording', 'note']])

    controller.onEvent({ event: 'key', down: false, held: [] }) // eventually releasing the held key: harmless no-op
    expect(actions).toEqual([['beginRecording', 'note']])
  })

  // Added for review round 3 (ruling R13): a toggle begin the pipeline accepted but that never
  // started recording (secure input, model loading, dead mic) must not leave toggleMode stuck --
  // pipelineSettled(false) is how the eventual wiring reports that back.
  it('pipelineSettled(false) after a toggle begin that never started recording leaves the talk key working', () => {
    const actions: Array<[HotkeyAction, DictationMode]> = []
    let t = 1.0
    const controller = new HotkeyController(
      'control',
      (a, m) => actions.push([a, m]),
      () => t,
      () => 0
    )

    controller.onEvent({ event: 'shortcut', action: 'note' }) // begins a toggle that never actually starts recording
    controller.pipelineSettled(false) // the pipeline reports idle/notice, not listening

    controller.onEvent({ event: 'key', down: true, held: [] }) // the talk key must work normally now
    t = 1.5 // past MIN_HOLD, so release finishes rather than counting as a tap
    controller.onEvent({ event: 'key', down: false, held: [] })

    expect(actions).toEqual([
      ['beginRecording', 'note'],
      ['beginRecording', 'dictate'],
      ['finishRecording', 'dictate'],
    ])
  })

  // Added for review round 3 (ruling R13): pipelineSettled(true) must be a no-op while a
  // recording is genuinely still in progress.
  it('pipelineSettled(true) during a live toggle changes nothing', () => {
    const actions: Array<[HotkeyAction, DictationMode]> = []
    const controller = new HotkeyController('control', (a, m) => actions.push([a, m]))

    controller.onEvent({ event: 'shortcut', action: 'note' }) // begin toggle
    controller.pipelineSettled(true) // still listening; must not clear toggleMode

    controller.onEvent({ event: 'shortcut', action: 'dictate' }) // finish toggle

    expect(actions).toEqual([
      ['beginRecording', 'note'],
      ['finishRecording', 'note'],
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
