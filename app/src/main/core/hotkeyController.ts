// Ported from Sources/DictateCore/HotkeyMonitor.swift's `handle`/`dispatch`
// (the dispatch logic only -- the CGEventTap plumbing in `start()` has no
// TS counterpart; the Electron "engine" process does that natively and
// reports `EngineEvent`s over stdio instead).
//
// Also covers the press-to-start / press-to-finish shortcut toggle path
// (Windows default), which v1 didn't have: a `shortcut` EngineEvent begins a
// recording with the shortcut's mode while idle, and finishes it (keeping
// that same mode) on the next `shortcut` event.
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
  /** True whenever either path (hold-to-talk or shortcut toggle) has an active recording. */
  private recording = false
  /** Tracks the hold-to-talk key's current down/up state, for gating modifier changes. */
  private keyIsDown = false
  /** Non-null while a shortcut-toggle recording is in progress; holds the mode it began with. */
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
    if (this.recording) {
      this.onAction('cancelRecording', this.toggleMode ?? this.modes.mode)
    }
    this.machine = new HotkeyStateMachine()
    this.modes = new ModeTracker(this.noteModifier)
    this.recording = false
    this.keyIsDown = false
    this.toggleMode = null
  }

  onEvent(event: EngineEvent): void {
    switch (event.event) {
      case 'key':
        this.keyIsDown = event.down
        this.dispatch(event.down ? { t: 'keyDown', at: this.now() } : { t: 'keyUp', at: this.now() }, event.held)
        return
      case 'otherKey':
        this.dispatch({ t: 'otherKeyDown' })
        return
      case 'escape':
        this.handleEscape()
        return
      case 'modifiers':
        if (this.recording) {
          const mode = this.modes.update(event.held, this.keyIsDown)
          if (mode) this.onModeChange?.(mode)
        }
        return
      case 'shortcut':
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
      this.recording = false
      this.onAction('cancelRecording', mode)
      return
    }
    this.dispatch({ t: 'escapeDown' })
  }

  private handleShortcut(action: ModeAction): void {
    if (this.toggleMode === null) {
      this.toggleMode = action
      this.recording = true
      this.onAction('beginRecording', action)
    } else {
      const mode = this.toggleMode
      this.toggleMode = null
      this.recording = false
      this.onAction('finishRecording', mode)
    }
  }

  private dispatch(event: HotkeyEvent, held: Modifier[] = []): void {
    const action = this.machine.handle(event)
    if (action === 'beginRecording') {
      this.modes.begin(held) // modifiers already down count too
      this.recording = true
    }
    if (action !== 'none') this.onAction(action, this.modes.mode)
    if (action === 'beginRecording' && this.modes.mode !== 'dictate') this.onModeChange?.(this.modes.mode)
    if (action === 'finishRecording' || action === 'cancelRecording') this.recording = false
    if (this.machine.awaitingSecondTap) {
      this.schedule(() => this.dispatch({ t: 'timeout', at: this.now() }), HotkeyStateMachine.DOUBLE_TAP_WINDOW * 1000)
    }
  }
}
