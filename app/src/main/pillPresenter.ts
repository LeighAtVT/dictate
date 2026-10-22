// Dictate v2, Task 11: what the pill says and when it fades, kept free of Electron so it can be
// tested. A port of v1's `AppDelegate.render` and `PillWindow.show/hide`
// (Sources/DictateApp/AppDelegate.swift, PillWindow.swift): notices fade after 1.5 s, the
// restart notice after 3 s, and `hide()` leaves a fading notice alone. New in v2: while the
// engine is down the pill says "Reconnecting…" until it's back (spec section 4).
import type { DictationMode } from './core/modes'
import type { PipelineState } from './core/pipeline'
import { hotkeyShortName } from '../shared/hotkeys'

/** The window side of the pill (pill.ts), or a fake in tests. */
export interface PillSurface {
  show(text: string, listening: boolean): void
  hide(): void
}

export const NOTICE_FADE_SECONDS = 1.5
export const RESTART_FADE_SECONDS = 3
export const RESTART_NOTICE = 'Dictate restarted after an unexpected stop'
export const RECONNECTING = 'Reconnecting…'
/** Ruling R44: the tray's Copy diagnostics confirms with this. */
export const DIAGNOSTICS_COPIED = 'Diagnostics copied'

export { hotkeyShortName }

/** v1's `modeLabel`: what the pill says instead of "Listening…" for edit and note. */
export function modeLabel(mode: DictationMode): string | null {
  switch (mode) {
    case 'edit':
      return 'Editing selection…'
    case 'note':
      return 'Note to self…'
    case 'dictate':
      return null
  }
}

/** v1's `.locked` text, e.g. "Listening — tap Fn to finish, Esc to cancel". */
export function lockedText(mode: DictationMode, hotkey: string): string {
  const finish = `tap ${hotkeyShortName(hotkey)} to finish, Esc to cancel`
  const label = modeLabel(mode)
  return label !== null ? `${label} ${finish}` : `Listening — ${finish}`
}

export class PillPresenter {
  private readonly surface: PillSurface
  private readonly hotkey: () => string
  private readonly schedule: (fn: () => void, ms: number) => unknown
  private readonly cancel: (handle: unknown) => void

  /** Non-null while a notice is showing and waiting to fade (v1's `hideWork`). */
  private fadeTimer: unknown = null
  private mode: DictationMode = 'dictate'
  /**
   * A mode change that arrived before the pipeline said `listening`. HotkeyController reports a
   * modifier held at key-down right after sending the begin, but the pipeline only goes
   * `listening` once `context` and `startRecording` reply, so the label waits here for it.
   */
  private pendingMode: DictationMode | null = null
  private reconnecting = false

  constructor(
    surface: PillSurface,
    hotkey: () => string,
    schedule: (fn: () => void, ms: number) => unknown = setTimeout,
    cancel: (handle: unknown) => void = (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
  ) {
    this.surface = surface
    this.hotkey = hotkey
    this.schedule = schedule
    this.cancel = cancel
  }

  /** v1's `PillWindow.show`: replaces whatever is showing, and fades after `fadeAfter` seconds if given. */
  show(text: string, listening: boolean, fadeAfter?: number): void {
    if (this.fadeTimer !== null) {
      this.cancel(this.fadeTimer)
      this.fadeTimer = null
    }
    this.surface.show(text, listening)
    if (fadeAfter !== undefined) {
      this.fadeTimer = this.schedule(() => {
        this.fadeTimer = null
        this.rest()
      }, fadeAfter * 1000)
    }
  }

  /** v1's `PillWindow.hide`: hides now unless a notice is still fading out. */
  hide(): void {
    if (this.fadeTimer !== null) return
    this.rest()
  }

  render(state: PipelineState): void {
    switch (state.type) {
      case 'listening': {
        this.mode = this.pendingMode ?? 'dictate'
        this.pendingMode = null
        this.show(modeLabel(this.mode) ?? 'Listening…', true)
        return
      }
      case 'locked':
        this.show(lockedText(this.mode, this.hotkey()), true)
        return
      case 'working':
        this.show('Working…', false)
        return
      case 'notice':
        this.show(state.message, false, NOTICE_FADE_SECONDS)
        return
      case 'idle':
        this.pendingMode = null
        this.hide()
        return
    }
  }

  /** HotkeyController.onModeChange. `listening` is Pipeline.isListening at that moment. */
  modeChanged(mode: DictationMode, listening: boolean): void {
    if (!listening) {
      this.pendingMode = mode
      return
    }
    this.mode = mode
    const label = modeLabel(mode)
    if (label !== null) this.show(label, true)
  }

  /** Shown once after launch when the previous run didn't end cleanly. */
  restartNotice(): void {
    this.show(RESTART_NOTICE, false, RESTART_FADE_SECONDS)
  }

  /** Copy diagnostics finished (Ruling R44); fades like a pipeline notice. */
  diagnosticsCopied(): void {
    this.show(DIAGNOSTICS_COPIED, false, NOTICE_FADE_SECONDS)
  }

  /** Engine 'down': "Reconnecting…" until 'up', but a fading notice finishes first. */
  engineDown(): void {
    this.reconnecting = true
    if (this.fadeTimer === null) this.surface.show(RECONNECTING, false)
  }

  /** Engine 'up', or 'failed' (no more restarts, so nothing to wait for). */
  engineUp(): void {
    if (!this.reconnecting) return
    this.reconnecting = false
    this.hide()
  }

  /** What the pill shows with nothing else to say. */
  private rest(): void {
    if (this.reconnecting) this.surface.show(RECONNECTING, false)
    else this.surface.hide()
  }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where the pill window goes: centered under the cursor with its top 24 px below it (v1's
 * `PillWindow.show`, in top-left screen coordinates), kept inside the cursor's display.
 */
export function pillBounds(cursor: { x: number; y: number }, size: { width: number; height: number }, workArea: Rect): Rect {
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi))
  const x = clamp(Math.round(cursor.x - size.width / 2), workArea.x, workArea.x + workArea.width - size.width)
  const y = clamp(Math.round(cursor.y + 24), workArea.y, workArea.y + workArea.height - size.height)
  return { x, y, width: size.width, height: size.height }
}
