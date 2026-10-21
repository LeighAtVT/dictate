// Ported from Sources/DictateCore/Pipeline.swift: one dictation, start to
// finish. record -> speech check -> transcribe -> polish (or local clean) ->
// paste -> history. Edit mode rewrites the selection instead; note mode saves
// a note to self instead of pasting.
//
// v1's separate Recording/Transcribing/ContextProviding/Inserting fakes
// collapse into one EngineApi + FakeEngine: the engine (native/mac, Task 6-9)
// now owns the microphone, the speech gate, and Whisper, so `stopRecording`
// alone replaces `recorder.stop()` + `transcriber.transcribe()`. See the
// task-10 brief's six v2 decisions for what else changed from v1.
import type { EngineRequest, ReplyMap } from '../../shared/protocol'
import { EngineGone, EngineTimeout } from '../engine'
import type { HotkeyAction } from './hotkeyStateMachine'
import { LocalCleaner } from './localCleaner'
import { outputLanguage } from './language'
import type { DictationMode } from './modes'
import type { History, HistoryEntry } from './history'
import type { NoteDestination, NoteSaving } from './noteSaver'
import type { Polishing } from './polisher'
import type { Settings } from './settingsStore'
import { matchShortcut, type Shortcut } from './shortcuts'
import { styleFor, type Style } from './styleRouter'

/** The subset of Engine.request the pipeline uses, so tests can pass a FakeEngine. */
export interface EngineApi {
  request<O extends EngineRequest['op']>(req: Extract<EngineRequest, { op: O }>): Promise<ReplyMap[O]>
}

export type PipelineOutcome =
  | { type: 'inserted'; text: string }
  | { type: 'copied'; text: string }
  | { type: 'noSpeech' }
  | { type: 'skippedSecure' }
  | { type: 'modelNotReady' }
  | { type: 'cancelled' }
  | { type: 'failed'; reason: string }
  /** Nothing was done; `notice` is the message shown. */
  | { type: 'skipped'; notice: string }
  | { type: 'noted'; destination: NoteDestination }

export type PipelineState =
  | { type: 'idle' }
  | { type: 'listening' }
  | { type: 'locked' }
  | { type: 'working' }
  | { type: 'notice'; message: string }

export interface StageTimings {
  transcribe: number
  polish: number
  insert: number
  total: number
}

export interface PipelineDeps {
  engine: EngineApi
  polisher: () => Polishing
  settings: () => Settings
  vocabulary: () => string[]
  shortcuts: () => Shortcut[]
  history: History
  notes: NoteSaving
  modelReady: () => boolean
  hasKey: () => boolean
  platform: 'mac' | 'windows'
}

type AppTarget = ReplyMap['context']

/** Internal signal: an engine op threw EngineGone/EngineTimeout mid-flow (decision 5). */
class RecordingLost extends Error {}

export class Pipeline {
  static readonly Notice = {
    noSpeech: "Didn't catch that",
    secure: 'Password field — skipped',
    failed: 'Transcription failed',
    micUnavailable: 'Microphone unavailable',
    modelLoading: 'Speech model still downloading',
    highlightFirst: 'Highlight text first',
    editNeedsKey: 'Voice editing needs an OpenRouter key',
    polishOff: 'Polish is off for this app',
    polishRefused: 'Pasted without cleanup — check Settings → Polish',
    editFailed: 'Edit failed — text unchanged',
    savedTasks: 'Saved to Tasks',
    savedFile: 'Saved to Dictate Notes',
    noteFailed: "Couldn't save note — copied",
    notTranslated: "Pasted as spoken — couldn't translate",
    translateNeedsKey: 'Pasted as spoken — add an OpenRouter key to translate',
    recordingLost: 'Recording lost — please say it again',
    copied: (platform: 'mac' | 'windows'): string => (platform === 'mac' ? 'Copied — press ⌘V' : 'Copied — press Ctrl+V')
  } as const

  private readonly deps: PipelineDeps
  private target: AppTarget | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private busy = false
  private timings: StageTimings | null = null

  onState?: (s: PipelineState) => void

  constructor(deps: PipelineDeps) {
    this.deps = deps
  }

  get isBusy(): boolean {
    return this.busy
  }

  get isListening(): boolean {
    return this.target !== null
  }

  get lastTimings(): StageTimings | null {
    return this.timings
  }

  /**
   * Returns null when the action was ignored (busy, or nothing to finish). `mode` is what the
   * modifiers held so far chose; the value given with 'finishRecording' wins. Every call is
   * appended, in arrival order, to one promise chain (decision 1), so e.g. a cancelRecording
   * arriving while `begin` still awaits `context()` waits for `begin` to finish setting its
   * target before it runs. An error in one call never breaks the chain for the next.
   */
  async handle(action: HotkeyAction, mode: DictationMode = 'dictate'): Promise<PipelineOutcome | null> {
    const result = this.chain.then(() => this.process(action, mode))
    this.chain = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async process(action: HotkeyAction, mode: DictationMode): Promise<PipelineOutcome | null> {
    try {
      switch (action) {
        case 'none':
          return null
        case 'beginRecording':
          return await this.begin()
        case 'lockRecording':
          if (this.target !== null) this.onState?.({ type: 'locked' })
          return null
        case 'cancelRecording':
          return await this.cancel()
        case 'finishRecording':
          return await this.finish(mode)
        default:
          return null
      }
    } catch (err) {
      if (err instanceof RecordingLost) {
        this.target = null
        this.busy = false
        return this.done({ type: 'failed', reason: 'recording lost' }, Pipeline.Notice.recordingLost)
      }
      throw err
    }
  }

  private async begin(): Promise<PipelineOutcome | null> {
    if (this.busy || this.target !== null) return null
    const ctx = await this.engineCall(this.deps.engine.request({ op: 'context' }))
    if (ctx.secureInput) {
      this.notify(Pipeline.Notice.secure)
      return { type: 'skippedSecure' }
    }
    if (!this.deps.modelReady()) {
      this.notify(Pipeline.Notice.modelLoading)
      return { type: 'modelNotReady' }
    }
    try {
      await this.engineCall(this.deps.engine.request({ op: 'startRecording' }))
    } catch (err) {
      if (err instanceof RecordingLost) throw err
      this.notify(Pipeline.Notice.micUnavailable)
      return { type: 'failed', reason: err instanceof Error ? err.message : String(err) }
    }
    this.target = ctx
    this.onState?.({ type: 'listening' })
    return null
  }

  private async cancel(): Promise<PipelineOutcome | null> {
    if (this.target === null) return null
    await this.engineCall(this.deps.engine.request({ op: 'cancelRecording' }))
    this.target = null
    this.onState?.({ type: 'idle' })
    return { type: 'cancelled' }
  }

  private async finish(mode: DictationMode): Promise<PipelineOutcome | null> {
    const target = this.target
    if (target === null) return null
    this.target = null
    this.busy = true
    this.onState?.({ type: 'working' })
    try {
      const settings = this.deps.settings()
      const style = styleFor(target, settings.overrides)

      // Check edits up front, and read the selection before the user has a chance to move on.
      // A refused edit is still transcribed below and kept in history, so no words are lost.
      let selected = ''
      let refusal: string | null = null
      if (mode === 'edit') {
        if (!this.deps.hasKey()) {
          refusal = Pipeline.Notice.editNeedsKey
        } else if (style === 'off') {
          refusal = Pipeline.Notice.polishOff
        } else {
          const sel = await this.engineCall(this.deps.engine.request({ op: 'selection' }))
          if (sel.text !== null) selected = sel.text
          else refusal = Pipeline.Notice.highlightFirst
        }
      }

      const vocab = this.deps.vocabulary()
      const transcribeStart = Date.now()
      let stopResult: ReplyMap['stopRecording']
      try {
        stopResult = await this.engineCall(
          this.deps.engine.request({ op: 'stopRecording', language: settings.spokenLanguage, vocabulary: vocab })
        )
      } catch (err) {
        if (err instanceof RecordingLost) throw err
        return this.done(
          { type: 'failed', reason: err instanceof Error ? err.message : String(err) },
          Pipeline.Notice.failed
        )
      }
      if (stopResult.result === 'noSpeech') return this.done({ type: 'noSpeech' }, Pipeline.Notice.noSpeech)

      const raw = LocalCleaner.applyVocabulary(LocalCleaner.stripAnnotations(stopResult.text ?? ''), vocab)
      const transcribeTime = (Date.now() - transcribeStart) / 1000

      const cleaned = LocalCleaner.clean(raw)
      if (cleaned.length === 0) return this.done({ type: 'noSpeech' }, Pipeline.Notice.noSpeech)

      const polishStart = Date.now()

      if (mode === 'note') {
        const [final] = await this.polishForOutput(raw, cleaned, 'docs', vocab)
        this.addHistory({ date: new Date().toISOString(), bundleID: 'note', raw, final })
        const destination = await this.deps.notes.save(final)
        if (destination === 'tasks') return this.done({ type: 'noted', destination: 'tasks' }, Pipeline.Notice.savedTasks)
        if (destination === 'file') return this.done({ type: 'noted', destination: 'file' }, Pipeline.Notice.savedFile)
        await this.engineCall(this.deps.engine.request({ op: 'copy', text: final }))
        return this.done({ type: 'copied', text: final }, Pipeline.Notice.noteFailed)
      }

      if (mode === 'edit') {
        if (refusal !== null) {
          this.addHistory({ date: new Date().toISOString(), bundleID: target.appId, raw, final: cleaned })
          return this.done({ type: 'skipped', notice: refusal }, refusal)
        }
        const rewritten = await this.deps.polisher().edit(selected, cleaned, vocab)
        if (rewritten === null) {
          this.addHistory({ date: new Date().toISOString(), bundleID: target.appId, raw, final: cleaned })
          return this.done({ type: 'failed', reason: 'edit' }, Pipeline.Notice.editFailed)
        }
        return await this.deliver(rewritten, raw, target, null, transcribeTime, polishStart)
      }

      // dictate
      const shortcut = matchShortcut(cleaned, this.deps.shortcuts())
      if (shortcut) {
        return await this.deliver(shortcut.text, raw, target, null, transcribeTime, polishStart)
      }
      const [final, notice] = await this.polishForOutput(raw, cleaned, style, vocab)
      return await this.deliver(final, raw, target, notice, transcribeTime, polishStart)
    } finally {
      this.busy = false
    }
  }

  /**
   * Polished text in the "Paste in" language. Falls back to the local clean-up, with a notice
   * when a translation was wanted but couldn't happen, or when OpenRouter refused the cleanup
   * request.
   */
  private async polishForOutput(
    raw: string,
    cleaned: string,
    style: Style,
    vocabulary: string[]
  ): Promise<[string, string | null]> {
    const settings = this.deps.settings()
    const output = outputLanguage(settings.spokenLanguage, settings.pasteLanguage)
    const polisher = this.deps.polisher()
    if (output.kind === 'same') {
      const polished = await polisher.polish(raw, style, vocabulary, output)
      if (polished !== null) return [polished, null]
      return [cleaned, polisher.lastConfigError() === null ? null : Pipeline.Notice.polishRefused]
    }
    if (style === 'off') return [cleaned, Pipeline.Notice.notTranslated]
    if (!this.deps.hasKey()) return [cleaned, Pipeline.Notice.translateNeedsKey]
    const translated = await polisher.polish(raw, style, vocabulary, output)
    if (translated === null) return [cleaned, Pipeline.Notice.notTranslated]
    return [translated, null]
  }

  /** Pastes into the app dictation started in, or copies when focus has moved; records history. */
  private async deliver(
    final: string,
    raw: string,
    target: AppTarget,
    notice: string | null,
    transcribeTime: number,
    polishStart: number
  ): Promise<PipelineOutcome> {
    const polishTime = (Date.now() - polishStart) / 1000
    const insertStart = Date.now()

    const fresh = await this.engineCall(this.deps.engine.request({ op: 'context' }))
    let outcome: PipelineOutcome
    if (fresh.appId !== target.appId) {
      // Focus moved while we worked; never paste into the wrong app.
      await this.engineCall(this.deps.engine.request({ op: 'copy', text: final }))
      outcome = { type: 'copied', text: final }
    } else {
      const res = await this.engineCall(this.deps.engine.request({ op: 'paste', text: final }))
      outcome = res.result === 'pasted' ? { type: 'inserted', text: final } : { type: 'copied', text: final }
    }

    const insertTime = (Date.now() - insertStart) / 1000
    this.timings = { transcribe: transcribeTime, polish: polishTime, insert: insertTime, total: transcribeTime + polishTime + insertTime }
    this.addHistory({ date: new Date().toISOString(), bundleID: target.appId, raw, final })
    return this.done(outcome, outcome.type === 'copied' ? Pipeline.Notice.copied(this.deps.platform) : notice)
  }

  private addHistory(entry: HistoryEntry): void {
    if (this.deps.settings().keepHistory) this.deps.history.add(entry)
  }

  private done(outcome: PipelineOutcome, notice: string | null): PipelineOutcome {
    if (notice !== null) this.notify(notice)
    else this.onState?.({ type: 'idle' })
    return outcome
  }

  private notify(message: string): void {
    this.onState?.({ type: 'notice', message })
    this.onState?.({ type: 'idle' })
  }

  /** Maps EngineGone/EngineTimeout to RecordingLost (decision 5); any other error passes through. */
  private async engineCall<T>(promise: Promise<T>): Promise<T> {
    try {
      return await promise
    } catch (err) {
      if (err instanceof EngineGone || err instanceof EngineTimeout) throw new RecordingLost()
      throw err
    }
  }
}
