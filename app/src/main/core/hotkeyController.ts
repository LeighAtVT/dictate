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
//
// Review round 2 (ruling R11): a begin the pipeline drops (busy, or a finish
// already queued -- see Pipeline.acceptsBegin) must not let the controller
// think a recording started anyway. For the toggle path that would leave
// `toggleMode` set forever, since only a matching `shortcut`/`escape` clears
// it -- and while it's set, every `key`/`otherKey` event is thrown away
// (:70/:79), so the hold-to-talk key would go dead with no sign why. For the
// hold path, `holdActive`/`modes.begin`/`onModeChange` must likewise not
// reflect a begin that never actually happened.
//
// Review round 3 (ruling R12): R11's hold-path fix left `holdActive` false
// on a dropped begin, but `HotkeyStateMachine` isn't gated on `canBegin` at
// all -- it still moves to `holding`, then `tapped`/`lockedDown`/`locked` on
// release, with its own timers and follow-up actions (a stale double-tap
// timeout, a lock) still firing through `onAction` for a recording that
// never started. With `holdActive` false, a toggle shortcut pressed in the
// meantime is no longer blocked either, so it can start a real recording
// that the stale timer then cancels out from under it. The fix pushes the
// state machine straight to its `cancelled` state on a dropped begin (the
// same state `otherKeyDown` mid-hold produces), which only reacts to
// `keyUp` (back to `idle`) -- no timer, no lock, no stale-mode finish.
//
// Review round 3 (ruling R13): a toggle (or hold) begin the pipeline
// *accepts* (`canBegin()` true) can still end without ever starting a
// recording -- secure input, the model still loading, a dead mic. `onAction`
// is fire-and-forget, so the controller has no way to learn that on its own;
// `pipelineSettled` is how the eventual wiring (Task 11) tells it.
import type { EngineEvent, Modifier, ModeAction } from '../../shared/protocol'
import { HotkeyStateMachine, type HotkeyAction, type HotkeyEvent } from './hotkeyStateMachine'
import { ModeTracker, type DictationMode } from './modes'

export class HotkeyController {
  private readonly noteModifier: Modifier
  private readonly onAction: (action: HotkeyAction, mode: DictationMode) => void
  private readonly now: () => number
  private readonly schedule: (fn: () => void, ms: number) => unknown
  /** Whether a beginRecording right now would actually be accepted (Pipeline.acceptsBegin). */
  private readonly canBegin: () => boolean

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
    schedule: (fn: () => void, ms: number) => unknown = setTimeout,
    canBegin: () => boolean = () => true
  ) {
    this.noteModifier = noteModifier
    this.onAction = onAction
    this.now = now
    this.schedule = schedule
    this.canBegin = canBegin
    this.modes = new ModeTracker(noteModifier)
  }

  /**
   * Review round 3 (ruling R13): call this on every pipeline `idle`/`notice` state, with whether
   * the pipeline is still listening (recording) afterward. A begin the pipeline accepted but
   * that never actually started recording (secure input, the model still loading, a dead mic)
   * leaves `toggleMode`/`holdActive` set with nothing behind them, since `onAction` never reports
   * back. When `listening` is false, this clears both so the talk key and the shortcut toggle
   * work again; it's a no-op while a real recording is still in progress. Not wired up yet --
   * that lands with Task 11's production wiring.
   */
  pipelineSettled(listening: boolean): void {
    if (listening) return
    this.toggleMode = null
    this.holdActive = false
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
      // Review round 2 (R11): if the pipeline would just drop this begin, don't set toggleMode
      // at all -- otherwise it stays set forever (only a matching shortcut/escape clears it),
      // and every key/otherKey event gets thrown away in the meantime (:70/:79), killing the
      // hold-to-talk key with no sign why.
      if (!this.canBegin()) return
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
    if (action === 'beginRecording' && !this.canBegin()) {
      // Review round 3 (R12): don't leave the state machine mid-cycle (holding/tapped/locked)
      // for a begin the pipeline will drop -- push it straight to `cancelled` (the same state
      // otherKeyDown mid-hold produces), which only reacts to keyUp (back to idle). The returned
      // action from this synthetic event is `cancelRecording` (cancelling a recording that never
      // started), so it's discarded rather than sent to onAction -- and the real `beginRecording`
      // above was never sent either, matching the comment on Pipeline.acceptsBegin.
      this.machine.handle({ t: 'otherKeyDown' })
      return
    }
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
