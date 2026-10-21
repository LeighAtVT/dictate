// Ported from Sources/DictateCore/HotkeyMonitor.swift's `handle`/`dispatch`
// (the dispatch logic only -- the CGEventTap plumbing in `start()` has no
// TS counterpart; the Electron "engine" process does that natively and
// reports `EngineEvent`s over stdio instead).
//
// Also covers the press-to-start / press-to-finish shortcut toggle path
// (Windows default), which v1 didn't have: a `shortcut` EngineEvent begins a
// recording with the shortcut's mode while idle, and finishes it (keeping
// that same mode) on the next `shortcut` event.
//
// Fix round 1: the hold-to-talk path (driven by `key`/`escape`/`otherKey`)
// and the shortcut-toggle path (driven by `shortcut`/`escape`) must not be
// able to both claim a recording at once. Whichever path began the
// recording owns it until it ends: while a hold recording is active,
// `shortcut` events are ignored; while a toggle recording is active, `key`
// and `otherKey` events are ignored. `escape` always cancels whichever path
// owns the recording.
import type { EngineEvent, Modifier, ModeAction } from '../../shared/protocol'
import { HotkeyStateMachine, type HotkeyAction, type HotkeyEvent } from './hotkeyStateMachine'
import { ModeTracker, type DictationMode } from './modes'

export class HotkeyController {
  private readonly noteModifier: Modifier
  private readonly onAction: (action: HotkeyAction, mode: DictationMode) => void
  private readonly now: () => number
  private readonly schedule: (fn: () => void, ms: number) => unknown

  private machine = new HotkeyStateMachine()
  private modes: ModeTracker
  /** True while the hold-to-talk path (begun by `key`) owns an active recording. */
  private holdActive = false
  /** Tracks the hold-to-talk key's current down/up state, for gating modifier changes. */
  private keyIsDown = false
  /** Non-null while the shortcut-toggle path owns an active recording; holds the mode it began with. */
  private toggleMode: ModeAction | null = null

  /** Called during a recording when Shift or the note modifier changes what it's for. */
  onModeChange?: (mode: DictationMode) => void

  constructor(
    noteModifier: Modifier,
    onAction: (action: HotkeyAction, mode: DictationMode) => void,
    now: () => number = () => performance.now() / 1000,
    schedule: (fn: () => void, ms: number) => unknown = setTimeout
  ) {
    this.noteModifier = noteModifier
    this.onAction = onAction
    this.now = now
    this.schedule = schedule
    this.modes = new ModeTracker(noteModifier)
  }

  /** For a hotkey change or engine restart: cancels any recording in progress, as HotkeyMonitor.hotkey.didSet does. */
  reset(): void {
    if (this.holdActive || this.toggleMode !== null) {
      this.onAction('cancelRecording', this.toggleMode ?? this.modes.mode)
    }
    this.machine = new HotkeyStateMachine()
    this.modes = new ModeTracker(this.noteModifier)
    this.holdActive = false
    this.keyIsDown = false
    this.toggleMode = null
  }

  onEvent(event: EngineEvent): void {
    switch (event.event) {
      case 'key':
        // A toggle recording owns the key path until it finishes; key
        // down/up never reaches the hold-to-talk state machine while one is
        // in progress (that's what let a key-down start a second, bookkeeping-
        // clobbering recording on top of an active toggle one).
        if (this.toggleMode !== null) return
        this.keyIsDown = event.down
        this.dispatch(event.down ? { t: 'keyDown', at: this.now() } : { t: 'keyUp', at: this.now() }, event.held)
        return
      case 'otherKey':
        // otherKey cancels a hold-to-talk recording, but a toggle recording
        // isn't driven by key events at all, so it doesn't cancel that one.
        if (this.toggleMode !== null) return
        this.dispatch({ t: 'otherKeyDown' })
        return
      case 'escape':
        this.handleEscape()
        return
      case 'modifiers':
        // Only the hold-to-talk path's mode can change mid-recording; a
        // toggle recording's mode is fixed to the shortcut that began it.
        if (this.holdActive) {
          const mode = this.modes.update(event.held, this.keyIsDown)
          if (mode) this.onModeChange?.(mode)
        }
        return
      case 'shortcut':
        // A hold recording owns the shortcut path until it finishes; a
        // shortcut never starts a second recording on top of an active hold
        // one (that's what let it fire a duplicate beginRecording).
        if (this.holdActive) return
        this.handleShortcut(event.action)
        return
      default:
        return
    }
  }

  private handleEscape(): void {
    // The shortcut toggle path has no underlying state-machine state of its
    // own (the machine stays idle, since only `key` events drive it), so
    // escape has to cancel it directly instead of going through dispatch().
    if (this.toggleMode !== null) {
      const mode = this.toggleMode
      this.toggleMode = null
      this.onAction('cancelRecording', mode)
      return
    }
    this.dispatch({ t: 'escapeDown' })
  }

  private handleShortcut(action: ModeAction): void {
    if (this.toggleMode === null) {
      this.toggleMode = action
      this.onAction('beginRecording', action)
    } else {
      const mode = this.toggleMode
      this.toggleMode = null
      this.onAction('finishRecording', mode)
    }
  }

  private dispatch(event: HotkeyEvent, held: Modifier[] = []): void {
    const action = this.machine.handle(event)
    if (action === 'beginRecording') {
      this.modes.begin(held) // modifiers already down count too
      this.holdActive = true
    }
    if (action !== 'none') this.onAction(action, this.modes.mode)
    if (action === 'beginRecording' && this.modes.mode !== 'dictate') this.onModeChange?.(this.modes.mode)
    if (action === 'finishRecording' || action === 'cancelRecording') this.holdActive = false
    if (this.machine.awaitingSecondTap) {
      this.schedule(() => this.dispatch({ t: 'timeout', at: this.now() }), HotkeyStateMachine.DOUBLE_TAP_WINDOW * 1000)
    }
  }
}
