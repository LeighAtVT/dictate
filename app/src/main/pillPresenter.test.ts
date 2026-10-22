import { beforeEach, describe, expect, it } from 'vitest'
import {
  DIAGNOSTICS_COPIED,
  NOTICE_FADE_SECONDS,
  PillPresenter,
  RECONNECTING,
  RESTART_FADE_SECONDS,
  RESTART_NOTICE,
  hotkeyShortName,
  lockedText,
  modeLabel,
  pillBounds,
  type PillSurface
} from './pillPresenter'

/** Records what the window was told, and runs timers by hand. */
class Harness implements PillSurface {
  calls: string[] = []
  timers = new Map<number, { fn: () => void; ms: number }>()
  private next = 1
  hotkey = 'fn'
  readonly presenter = new PillPresenter(
    this,
    () => this.hotkey,
    (fn, ms) => {
      const id = this.next++
      this.timers.set(id, { fn, ms })
      return id
    },
    (id) => this.timers.delete(id as number)
  )

  show(text: string, listening: boolean): void {
    this.calls.push(`show ${listening ? '●' : '○'} ${text}`)
  }
  hide(): void {
    this.calls.push('hide')
  }
  /** Fires every pending timer, returning their delays in ms. */
  fire(): number[] {
    const due = [...this.timers.entries()]
    this.timers.clear()
    for (const [, t] of due) t.fn()
    return due.map(([, t]) => t.ms)
  }
}

let h: Harness
beforeEach(() => {
  h = new Harness()
})

describe('pill text', () => {
  it("follows v1's render for a plain dictation", () => {
    const p = h.presenter
    p.render({ type: 'listening' })
    p.render({ type: 'working' })
    p.render({ type: 'idle' })
    expect(h.calls).toEqual(['show ● Listening…', 'show ○ Working…', 'hide'])
    expect(h.timers.size).toBe(0)
  })

  it('says how to finish a locked (hands-free) recording', () => {
    h.presenter.render({ type: 'listening' })
    h.presenter.render({ type: 'locked' })
    expect(h.calls.at(-1)).toBe('show ● Listening — tap Fn to finish, Esc to cancel')
  })

  it('names the configured talk key and the mode in the locked text', () => {
    expect(lockedText('dictate', 'fn')).toBe('Listening — tap Fn to finish, Esc to cancel')
    expect(lockedText('dictate', 'rightOption')).toBe('Listening — tap Right Option to finish, Esc to cancel')
    expect(lockedText('edit', 'fn')).toBe('Editing selection… tap Fn to finish, Esc to cancel')
    expect(lockedText('note', 'leftControl')).toBe('Note to self… tap Left Control to finish, Esc to cancel')
  })

  it("has v1's key names and mode labels", () => {
    expect(
      ['fn', 'rightOption', 'rightCommand', 'rightControl', 'rightShift', 'leftOption', 'leftControl'].map(hotkeyShortName)
    ).toEqual(['Fn', 'Right Option', 'Right Command', 'Right Control', 'Right Shift', 'Left Option', 'Left Control'])
    expect(hotkeyShortName('unknown')).toBe('Fn')
    expect([modeLabel('dictate'), modeLabel('edit'), modeLabel('note')]).toEqual([null, 'Editing selection…', 'Note to self…'])
  })

  it('shows the mode label when a modifier was held at key-down, before listening began', () => {
    // HotkeyController reports the mode right after sending the begin; the pipeline only says
    // `listening` after context + startRecording reply.
    h.presenter.modeChanged('note', false)
    expect(h.calls).toEqual([])
    h.presenter.render({ type: 'listening' })
    h.presenter.render({ type: 'locked' })
    expect(h.calls).toEqual(['show ● Note to self…', 'show ● Note to self… tap Fn to finish, Esc to cancel'])
  })

  it('switches the label when the mode changes mid-recording', () => {
    h.presenter.render({ type: 'listening' })
    h.presenter.modeChanged('edit', true)
    expect(h.calls).toEqual(['show ● Listening…', 'show ● Editing selection…'])
  })

  it("doesn't carry a mode from a begin that never started into the next recording", () => {
    h.presenter.modeChanged('edit', false)
    h.presenter.render({ type: 'notice', message: 'Password field — skipped' })
    h.presenter.render({ type: 'idle' })
    h.fire()
    h.calls = []
    h.presenter.render({ type: 'listening' })
    expect(h.calls).toEqual(['show ● Listening…'])
  })

  it('starts each recording as plain dictation', () => {
    h.presenter.render({ type: 'listening' })
    h.presenter.modeChanged('note', true)
    h.presenter.render({ type: 'working' })
    h.presenter.render({ type: 'idle' })
    h.calls = []
    h.presenter.render({ type: 'listening' })
    h.presenter.render({ type: 'locked' })
    expect(h.calls).toEqual(['show ● Listening…', 'show ● Listening — tap Fn to finish, Esc to cancel'])
  })
})

describe('pill fades', () => {
  it('fades a notice after 1.5 s, and the idle right after it leaves it showing', () => {
    h.presenter.render({ type: 'notice', message: "Didn't catch that" })
    h.presenter.render({ type: 'idle' })
    expect(h.calls).toEqual(["show ○ Didn't catch that"])
    expect(h.fire()).toEqual([NOTICE_FADE_SECONDS * 1000])
    expect(NOTICE_FADE_SECONDS).toBe(1.5)
    expect(h.calls.at(-1)).toBe('hide')
  })

  it('shows the restart notice for 3 s', () => {
    h.presenter.restartNotice()
    expect(h.calls).toEqual([`show ○ ${RESTART_NOTICE}`])
    expect(RESTART_NOTICE).toBe('Dictate restarted after an unexpected stop')
    expect(h.fire()).toEqual([RESTART_FADE_SECONDS * 1000])
    expect(RESTART_FADE_SECONDS).toBe(3)
    expect(h.calls.at(-1)).toBe('hide')
  })

  // Ruling R44: Copy diagnostics confirms with a short notice.
  it('shows "Diagnostics copied" and fades it like any notice', () => {
    h.presenter.diagnosticsCopied()
    expect(h.calls).toEqual(['show ○ Diagnostics copied'])
    expect(DIAGNOSTICS_COPIED).toBe('Diagnostics copied')
    expect(h.fire()).toEqual([NOTICE_FADE_SECONDS * 1000])
    expect(h.calls.at(-1)).toBe('hide')
  })

  it('lets a new dictation replace a fading notice, and the old fade no longer hides it', () => {
    h.presenter.render({ type: 'notice', message: 'Copied — press ⌘V' })
    h.presenter.render({ type: 'idle' })
    h.presenter.render({ type: 'listening' })
    expect(h.timers.size).toBe(0) // the notice's fade was cancelled
    expect(h.calls.at(-1)).toBe('show ● Listening…')
  })

  it("never fades listening, working, or locked", () => {
    h.presenter.render({ type: 'listening' })
    h.presenter.render({ type: 'locked' })
    h.presenter.render({ type: 'working' })
    expect(h.timers.size).toBe(0)
  })
})

describe('engine restarts', () => {
  it('says "Reconnecting…" until the engine is back', () => {
    h.presenter.engineDown()
    expect(h.calls).toEqual([`show ○ ${RECONNECTING}`])
    expect(RECONNECTING).toBe('Reconnecting…')
    // A plain idle from the pipeline doesn't hide it.
    h.presenter.render({ type: 'idle' })
    expect(h.calls.at(-1)).toBe(`show ○ ${RECONNECTING}`)
    h.presenter.engineUp()
    expect(h.calls.at(-1)).toBe('hide')
  })

  it('shows "Recording lost" in full, then goes back to "Reconnecting…" if the engine is still down', () => {
    h.presenter.render({ type: 'listening' })
    h.presenter.engineDown()
    h.presenter.render({ type: 'notice', message: 'Recording lost — please say it again' })
    h.presenter.render({ type: 'idle' })
    expect(h.calls).toEqual([
      'show ● Listening…',
      `show ○ ${RECONNECTING}`,
      'show ○ Recording lost — please say it again'
    ])
    h.fire()
    expect(h.calls.at(-1)).toBe(`show ○ ${RECONNECTING}`)
    h.presenter.engineUp()
    expect(h.calls.at(-1)).toBe('hide')
  })

  it('lets a fading notice finish when the engine comes back first', () => {
    h.presenter.engineDown()
    h.presenter.render({ type: 'notice', message: 'Recording lost — please say it again' })
    h.presenter.engineUp()
    expect(h.calls.at(-1)).toBe('show ○ Recording lost — please say it again')
    h.fire()
    expect(h.calls.at(-1)).toBe('hide')
  })

  it('does nothing on the first start', () => {
    h.presenter.engineUp()
    expect(h.calls).toEqual([])
  })
})

describe('pillBounds', () => {
  const screen = { x: 0, y: 0, width: 1440, height: 900 }
  const size = { width: 560, height: 44 }

  it('centers the pill under the cursor, its top 24 px below it', () => {
    expect(pillBounds({ x: 700, y: 300 }, size, screen)).toEqual({ x: 420, y: 324, width: 560, height: 44 })
  })

  it('keeps the pill on the cursor’s display', () => {
    expect(pillBounds({ x: 10, y: 890 }, size, screen)).toEqual({ x: 0, y: 856, width: 560, height: 44 })
    expect(pillBounds({ x: 1435, y: 0 }, size, screen)).toEqual({ x: 880, y: 24, width: 560, height: 44 })
    const second = { x: 1440, y: -200, width: 1920, height: 1080 }
    expect(pillBounds({ x: 2400, y: -100 }, size, second)).toEqual({ x: 2120, y: -76, width: 560, height: 44 })
  })
})
