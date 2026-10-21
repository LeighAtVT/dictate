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
})
