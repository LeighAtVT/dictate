// Ported from Sources/DictateCore/HotkeyStateMachine.swift.
//
// Hold-to-talk plus hands-free, kept free of event-tap plumbing so it can be
// tested. Hold the key: record while held, finish on release. Double-tap:
// keep recording hands-free; tap once more to finish, Esc to cancel.
// Recording starts on the first key-down so no word is clipped. Using the
// key as a modifier (another key pressed while held) cancels.

export type HotkeyEvent =
  | { t: 'keyDown'; at: number }
  | { t: 'keyUp'; at: number }
  | { t: 'otherKeyDown' }
  | { t: 'escapeDown' }
  /** Delivered DOUBLE_TAP_WINDOW after a short tap's release. */
  | { t: 'timeout'; at: number }

export type HotkeyAction = 'none' | 'beginRecording' | 'lockRecording' | 'finishRecording' | 'cancelRecording'

type State =
  | { kind: 'idle' }
  | { kind: 'holding'; since: number }
  | { kind: 'tapped'; at: number }
  | { kind: 'lockedDown' }
  | { kind: 'locked' }
  | { kind: 'finishingDown' }
  | { kind: 'cancelled' }

export class HotkeyStateMachine {
  static readonly DOUBLE_TAP_WINDOW = 0.35
  static readonly MIN_HOLD = 0.3

  private readonly minHold: number
  private state: State = { kind: 'idle' }

  constructor(minHold: number = HotkeyStateMachine.MIN_HOLD) {
    this.minHold = minHold
  }

  /** True right after a short tap: the caller should deliver `timeout` after DOUBLE_TAP_WINDOW. */
  get awaitingSecondTap(): boolean {
    return this.state.kind === 'tapped'
  }

  handle(event: HotkeyEvent): HotkeyAction {
    const state = this.state
    switch (state.kind) {
      case 'idle':
        if (event.t === 'keyDown') {
          this.state = { kind: 'holding', since: event.at }
          return 'beginRecording'
        }
        return 'none'

      case 'holding':
        if (event.t === 'keyUp') {
          if (event.at - state.since >= this.minHold) {
            this.state = { kind: 'idle' }
            return 'finishRecording'
          }
          this.state = { kind: 'tapped', at: event.at }
          return 'none'
        }
        if (event.t === 'otherKeyDown' || event.t === 'escapeDown') {
          this.state = { kind: 'cancelled' }
          return 'cancelRecording'
        }
        return 'none'

      case 'tapped':
        if (event.t === 'keyDown') {
          if (event.at - state.at <= HotkeyStateMachine.DOUBLE_TAP_WINDOW) {
            this.state = { kind: 'lockedDown' }
            return 'lockRecording'
          }
          this.state = { kind: 'idle' }
          return 'cancelRecording'
        }
        if (event.t === 'timeout' && event.at - state.at >= HotkeyStateMachine.DOUBLE_TAP_WINDOW - 0.01) {
          this.state = { kind: 'idle' }
          return 'cancelRecording'
        }
        if (event.t === 'otherKeyDown' || event.t === 'escapeDown') {
          this.state = { kind: 'idle' }
          return 'cancelRecording'
        }
        return 'none'

      case 'lockedDown':
        if (event.t === 'keyUp') {
          this.state = { kind: 'locked' }
          return 'none'
        }
        if (event.t === 'keyDown') {
          this.state = { kind: 'finishingDown' }
          return 'finishRecording'
        }
        if (event.t === 'escapeDown') {
          this.state = { kind: 'idle' }
          return 'cancelRecording'
        }
        return 'none'

      case 'locked':
        if (event.t === 'keyDown') {
          this.state = { kind: 'finishingDown' }
          return 'finishRecording'
        }
        if (event.t === 'escapeDown') {
          this.state = { kind: 'idle' }
          return 'cancelRecording'
        }
        return 'none'

      case 'finishingDown':
      case 'cancelled':
        if (event.t === 'keyUp') {
          this.state = { kind: 'idle' }
          return 'none'
        }
        return 'none'

      default:
        return 'none'
    }
  }
}
