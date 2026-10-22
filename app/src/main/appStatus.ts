// Dictate v2, Task 11: the app's health bookkeeping, kept out of index.ts so it can be tested.
// What v1's AppDelegate tracks for the menu and the icon: is the speech model ready (and what the
// menu should say about it), has the engine been given up on, and are the permissions in place.
// Pure: index.ts feeds it engine events and permission reports and writes the log lines it returns.
import type { EngineEvent, ReplyMap } from '../shared/protocol'
import type { PipelineOutcome, StageTimings } from './core/pipeline'
import { MODEL_PREPARING, modelStatusLine } from './trayModel'

type ModelEvent = Extract<EngineEvent, { event: 'model' }>
type Permissions = ReplyMap['permissions']

/** The engine process, for Copy diagnostics: before the first 'up', running, restarting, given up on. */
export type EngineState = 'starting' | 'up' | 'down' | 'failed'

export class AppStatus {
  modelReady = false
  /** The menu's model line; null when there's nothing to say. */
  modelStatus: string | null = MODEL_PREPARING
  /** The engine kept crashing and won't be restarted again. */
  engineFailed = false
  /** Null until the first permissions report. */
  permissions: Permissions | null = null
  engine: EngineState = 'starting'
  /** The engine's latest `model` event, progress ticks included; null before the first. */
  lastModelEvent: ModelEvent | null = null
  private lastModelState: ModelEvent['state'] | null = null
  /** Whether permissions were OK at the last report; null before the first. */
  private lastOK: boolean | null = null

  /** Until the first report, assume OK so the icon doesn't flash a warning at launch. */
  get permissionsOK(): boolean {
    const p = this.permissions
    return p === null || (p.accessibility && p.microphone === 'granted')
  }

  /** Returns a log line when the model's state changed (not on every download-progress tick). */
  model(event: ModelEvent): string | null {
    this.lastModelEvent = event
    this.modelStatus = modelStatusLine(event)
    this.modelReady = event.state === 'ready'
    const changed = event.state !== this.lastModelState
    this.lastModelState = event.state
    return changed ? `speech model ${event.state}` : null
  }

  engineUp(): void {
    this.engine = 'up'
  }

  /** The engine process went away; it reloads the model when it comes back. */
  engineDown(): void {
    this.engine = 'down'
    this.modelReady = false
    this.modelStatus = MODEL_PREPARING
    this.lastModelState = null
  }

  /** The engine won't be restarted, so no model is coming: the menu shows only the failure. */
  engineFailedForGood(): void {
    this.engine = 'failed'
    this.engineFailed = true
    this.modelReady = false
    this.modelStatus = null
  }

  /**
   * Records a permissions poll result. `log` is set on the first report and on every change;
   * `openOnboarding` on each transition from OK (or unknown) to something missing, so the window
   * isn't reopened every second while a permission stays missing.
   */
  permissionsReport(p: Permissions): { log: string | null; openOnboarding: boolean } {
    const prev = this.permissions
    const changed = prev === null || p.accessibility !== prev.accessibility || p.microphone !== prev.microphone
    this.permissions = p
    const ok = this.permissionsOK
    const openOnboarding = !ok && this.lastOK !== false
    this.lastOK = ok
    return {
      log: changed ? `permissions accessibility=${p.accessibility} microphone=${p.microphone}` : null,
      openOnboarding
    }
  }
}

/** The dictate.log line for a finished dictation. Never includes the dictated text. */
export function outcomeLogLine(outcome: PipelineOutcome | null, timings: StageTimings | null): string | null {
  if (outcome === null) return null
  if (outcome.type === 'inserted' && timings) {
    const f = (n: number): string => n.toFixed(2)
    return `dictation inserted transcribe=${f(timings.transcribe)}s polish=${f(timings.polish)}s insert=${f(timings.insert)}s total=${f(timings.total)}s`
  }
  if (outcome.type === 'failed') return `dictation failed: ${outcome.reason}`
  return `dictation ${outcome.type}`
}
