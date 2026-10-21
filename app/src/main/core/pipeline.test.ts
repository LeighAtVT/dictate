// Ported from Tests/DictateCoreTests/PipelineTests.swift. FakeEngine (pipelineFakes.ts)
// replaces FakeRecorder + FakeTranscriber + FakeContext + FakeInserter: the engine now owns
// the microphone, the speech gate, and Whisper, so one `stopRecording` reply stands in for a
// recorder's samples plus a transcriber's text. NoteSaver is real but never reaches the
// network in these dictate-only tests (mode defaults to 'dictate').
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EngineGone } from '../engine'
import { History } from './history'
import { NoteSaver } from './noteSaver'
import { FakeEngine, FakePolisher, silenceStopReply, slackContext, terminalContext, textStopReply, waitUntil } from './pipelineFakes'
import { Pipeline, type PipelineDeps, type PipelineOutcome, type PipelineState } from './pipeline'
import { defaultSettings, type Settings } from './settingsStore'

describe('Pipeline', () => {
  let engine: FakeEngine
  let polisher: FakePolisher
  let history: History
  let notes: NoteSaver
  let settings: Settings
  let dir: string

  beforeEach(() => {
    engine = new FakeEngine()
    polisher = new FakePolisher('Polished.')
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictate-pipeline-'))
    history = new History(path.join(dir, 'history.json'))
    notes = new NoteSaver({ fetch: (() => Promise.reject(new Error('unused'))) as typeof fetch, token: () => null, file: path.join(dir, 'notes.md') })
    settings = { ...defaultSettings(), overrides: {} }
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function pipeline(opts: { ready?: boolean; platform?: 'mac' | 'windows' } = {}): Pipeline {
    const deps: PipelineDeps = {
      engine,
      polisher: () => polisher,
      settings: () => settings,
      vocabulary: () => ['PostgreSQL'],
      shortcuts: () => [],
      history,
      notes,
      modelReady: () => opts.ready ?? true,
      hasKey: () => true,
      platform: opts.platform ?? 'mac'
    }
    return new Pipeline(deps)
  }

  async function dictate(p: Pipeline): Promise<PipelineOutcome | null> {
    await p.handle('beginRecording')
    return p.handle('finishRecording')
  }

  // @Test happyPathPolished
  it('pastes the polished text and records history', async () => {
    const outcome = await dictate(pipeline())
    expect(outcome).toEqual({ type: 'inserted', text: 'Polished.' })
    expect(engine.callsFor('paste')).toHaveLength(1)
    expect(history.recent()[0]?.raw).toBe('um ship it today')
    expect(history.recent()[0]?.final).toBe('Polished.')
  })

  // @Test fallsBackToLocalCleanWhenPolishNil
  it('falls back to local clean-up when polish is nil', async () => {
    polisher.reply = null
    expect(await dictate(pipeline())).toEqual({ type: 'inserted', text: 'Ship it today' })
  })

  // @Test noSpeechPastesNothing
  it('pastes nothing when there is no speech', async () => {
    engine.setReply('stopRecording', silenceStopReply)
    expect(await dictate(pipeline())).toEqual({ type: 'noSpeech' })
    expect(engine.callsFor('paste')).toHaveLength(0)
  })

  // @Test secureInputSkipsRecording
  it('skips recording in a secure input field', async () => {
    engine.setReply('context', { appId: 'com.apple.Safari', windowTitle: null, secureInput: true, elevated: false })
    const p = pipeline()
    expect(await p.handle('beginRecording')).toEqual({ type: 'skippedSecure' })
    expect(engine.callsFor('startRecording')).toHaveLength(0)
    expect(await p.handle('finishRecording')).toBeNull()
  })

  // @Test cancelDiscardsAudio
  it('discards audio on cancel', async () => {
    const p = pipeline()
    await p.handle('beginRecording')
    expect(await p.handle('cancelRecording')).toEqual({ type: 'cancelled' })
    expect(engine.callsFor('cancelRecording')).toHaveLength(1)
    expect(engine.callsFor('stopRecording')).toHaveLength(0)
  })

  // @Test ignoresPressWhilePipelineBusy. Review round 1 (ruling R9): v1's rule is that a press
  // arriving while the pipeline is busy is dropped outright, not queued to run once busy goes
  // back to false. `pendingFinishes` (see pipeline.ts's `handle`) restores that for v2's strict
  // promise chain (decision 1): a beginRecording arriving while busy, or while a finishRecording
  // is already queued ahead of it, resolves to null immediately instead of being appended.
  it('ignores a press while the pipeline is busy', async () => {
    const release = engine.suspend('stopRecording')
    const p = pipeline()
    await p.handle('beginRecording')
    const finishing = p.handle('finishRecording')
    await waitUntil(() => engine.calledOps.has('stopRecording'))
    expect(p.isBusy).toBe(true)
    expect(await p.handle('beginRecording')).toBeNull()
    expect(engine.callsFor('startRecording')).toHaveLength(1)
    release()
    await finishing
    expect(p.isBusy).toBe(false)
  })

  // Added for review round 1 (ruling R9): a finishRecording/cancelRecording that arrives right
  // behind a dropped beginRecording must be a true no-op -- it still gets queued (only
  // beginRecording is dropped outright), but there's no target to act on, so it does nothing.
  it('a finishRecording or cancelRecording after a dropped beginRecording is a no-op', async () => {
    const release = engine.suspend('stopRecording')
    const p = pipeline()
    const notices: string[] = []
    p.onState = (s: PipelineState): void => {
      if (s.type === 'notice') notices.push(s.message)
    }
    await p.handle('beginRecording')
    const finishing = p.handle('finishRecording')
    await waitUntil(() => engine.calledOps.has('stopRecording'))

    expect(await p.handle('beginRecording')).toBeNull() // dropped: busy
    const droppedFinish = p.handle('finishRecording')
    const droppedCancel = p.handle('cancelRecording')

    release()
    expect(await finishing).toEqual({ type: 'inserted', text: 'Polished.' })
    expect(await droppedFinish).toBeNull()
    expect(await droppedCancel).toBeNull()
    expect(notices).toEqual([])
    expect(engine.callsFor('startRecording')).toHaveLength(1)
    expect(engine.callsFor('cancelRecording')).toHaveLength(0)
    expect(p.isListening).toBe(false)
  })

  // Added for review round 1 (ruling R9): a hold-and-release that arrives while a previous
  // dictation is still Working must not start a second recording or leave a stray "Didn't catch
  // that" notice once the first dictation's paste lands.
  it('a hold-and-release during Working produces no extra recording or stray notice', async () => {
    const release = engine.suspend('stopRecording')
    const p = pipeline()
    const notices: string[] = []
    p.onState = (s: PipelineState): void => {
      if (s.type === 'notice') notices.push(s.message)
    }
    await p.handle('beginRecording')
    const finishing = p.handle('finishRecording')
    await waitUntil(() => engine.calledOps.has('stopRecording'))

    const heldBegin = p.handle('beginRecording')
    const heldFinish = p.handle('finishRecording')

    release()
    expect(await finishing).toEqual({ type: 'inserted', text: 'Polished.' })
    expect(await heldBegin).toBeNull()
    expect(await heldFinish).toBeNull()
    expect(engine.callsFor('startRecording')).toHaveLength(1)
    expect(notices).toEqual([])
  })

  // @Test copiesInsteadOfPastingWhenFrontAppChanged
  it('copies instead of pasting when the front app changed', async () => {
    engine.setReply('context', slackContext, terminalContext)
    const outcome = await dictate(pipeline())
    expect(outcome).toEqual({ type: 'copied', text: 'Polished.' })
    expect(engine.callsFor('paste')).toHaveLength(0)
    expect(engine.callsFor('copy')).toHaveLength(1)
  })

  // @Test copiedOnlyFromInserterMapsToCopied
  it('maps a copy-only paste reply to copied', async () => {
    engine.setReply('paste', { result: 'copied' })
    expect(await dictate(pipeline())).toEqual({ type: 'copied', text: 'Polished.' })
  })

  // @Test styleUsesContextAtKeyDown
  it('uses the style for the app recording started in, not the one it ends in', async () => {
    engine.setReply('context', slackContext, terminalContext)
    await dictate(pipeline())
    expect(polisher.styles).toEqual(['slack'])
  })

  // @Test transcriptionErrorPastesNothing
  it('pastes nothing when transcription fails', async () => {
    engine.setError('stopRecording', new Error('boom'))
    const outcome = await dictate(pipeline())
    expect(outcome).toEqual({ type: 'failed', reason: 'boom' })
    expect(engine.callsFor('paste')).toHaveLength(0)
  })

  // @Test emptyTranscriptIsNoSpeech
  it('treats an empty transcript as no speech', async () => {
    engine.setReply('stopRecording', textStopReply('   '))
    expect(await dictate(pipeline())).toEqual({ type: 'noSpeech' })
    expect(engine.callsFor('paste')).toHaveLength(0)
  })

  // @Test appliesVocabularyCasingToRaw
  it('applies vocabulary casing to the raw transcript', async () => {
    engine.setReply('stopRecording', textStopReply('the postgresql queue cleared'))
    polisher.reply = null
    expect(await dictate(pipeline())).toEqual({ type: 'inserted', text: 'The PostgreSQL queue cleared' })
  })

  // @Test micFailureSaysMicrophoneUnavailable
  it('says microphone unavailable when startRecording fails', async () => {
    engine.setError('startRecording', new Error('mic'))
    const p = pipeline()
    const notices: string[] = []
    p.onState = (s: PipelineState): void => {
      if (s.type === 'notice') notices.push(s.message)
    }
    await p.handle('beginRecording')
    expect(notices).toEqual([Pipeline.Notice.micUnavailable])
    expect(p.isListening).toBe(false)
  })

  // @Test reportsListeningWhileRecording
  it('reports listening while recording', async () => {
    const p = pipeline()
    await p.handle('beginRecording')
    expect(p.isListening).toBe(true)
    await p.handle('finishRecording')
    expect(p.isListening).toBe(false)
  })

  // @Test refusesToRecordWhileModelLoading
  it('refuses to record while the model is loading', async () => {
    const p = pipeline({ ready: false })
    const notices: string[] = []
    p.onState = (s: PipelineState): void => {
      if (s.type === 'notice') notices.push(s.message)
    }
    expect(await p.handle('beginRecording')).toEqual({ type: 'modelNotReady' })
    expect(engine.callsFor('startRecording')).toHaveLength(0)
    expect(notices).toEqual([Pipeline.Notice.modelLoading])
  })

  // @Test whisperSilenceMarkerIsNoSpeech
  it('treats a Whisper silence marker as no speech', async () => {
    engine.setReply('stopRecording', textStopReply('[BLANK_AUDIO]'))
    expect(await dictate(pipeline())).toEqual({ type: 'noSpeech' })
    expect(engine.callsFor('paste')).toHaveLength(0)
  })

  // @Test stripsSoundAnnotationsAroundSpeech
  it('strips sound annotations around speech', async () => {
    engine.setReply('stopRecording', textStopReply('[MUSIC] ship it today (coughs)'))
    polisher.reply = null
    expect(await dictate(pipeline())).toEqual({ type: 'inserted', text: 'Ship it today' })
  })

  // @Test lockKeepsRecordingAndReportsLocked
  it('keeps recording and reports locked', async () => {
    const p = pipeline()
    const states: PipelineState[] = []
    p.onState = (s: PipelineState): void => {
      states.push(s)
    }
    await p.handle('beginRecording')
    expect(await p.handle('lockRecording')).toBeNull()
    expect(p.isListening).toBe(true)
    expect(states).toEqual([{ type: 'listening' }, { type: 'locked' }])
    expect(await p.handle('finishRecording')).toEqual({ type: 'inserted', text: 'Polished.' })
  })

  // @Test lockWithoutRecordingIsIgnored
  it('ignores a lock press without a recording', async () => {
    const p = pipeline()
    const states: PipelineState[] = []
    p.onState = (s: PipelineState): void => {
      states.push(s)
    }
    expect(await p.handle('lockRecording')).toBeNull()
    expect(states).toEqual([])
  })

  // @Test recordsTimings
  it('records stage timings', async () => {
    const p = pipeline()
    await dictate(p)
    expect(p.lastTimings).not.toBeNull()
  })

  // @Test reportsStates
  it('reports listening, working, then idle', async () => {
    const p = pipeline()
    const states: PipelineState[] = []
    p.onState = (s: PipelineState): void => {
      states.push(s)
    }
    await dictate(p)
    expect(states[0]).toEqual({ type: 'listening' })
    expect(states).toContainEqual({ type: 'working' })
    expect(states[states.length - 1]).toEqual({ type: 'idle' })
  })

  // Added by the task-10 brief, step 1: cancelRecording arriving while begin's context() is
  // still pending must wait for begin to finish (decision 1's strict chain), so it sees the
  // target begin just set and actually cancels it, instead of racing past a still-null target.
  it('queues a cancel that arrives while begin is still awaiting context()', async () => {
    const release = engine.suspend('context')
    const p = pipeline()
    const beginning = p.handle('beginRecording')
    await waitUntil(() => engine.calledOps.has('context'))
    const cancelling = p.handle('cancelRecording')
    release()
    expect(await beginning).toBeNull()
    expect(await cancelling).toEqual({ type: 'cancelled' })
    expect(engine.calls.map((c) => c.op)).toEqual(['context', 'startRecording', 'cancelRecording'])
  })

  // Added by the task-10 brief, step 1 (decision 5): a crash mid-stopRecording is reported as
  // "recording lost", not surfaced as a raw transcription failure, and the pipeline recovers.
  it('reports recording lost when the engine crashes during stopRecording, and recovers', async () => {
    engine.setError('stopRecording', new EngineGone())
    const p = pipeline()
    const notices: string[] = []
    const states: PipelineState[] = []
    p.onState = (s: PipelineState): void => {
      states.push(s)
      if (s.type === 'notice') notices.push(s.message)
    }
    const outcome = await dictate(p)
    expect(outcome).toEqual({ type: 'failed', reason: 'recording lost' })
    expect(notices).toEqual([Pipeline.Notice.recordingLost])
    expect(states[states.length - 1]).toEqual({ type: 'idle' })
    expect(p.isListening).toBe(false)
    expect(p.isBusy).toBe(false)

    engine.clearError('stopRecording')
    expect(await dictate(p)).toEqual({ type: 'inserted', text: 'Polished.' })
  })

  // Added for review round 1 (ruling R10): EngineGone during begin's own context() lookup is
  // still "recording lost" (decision 5), and the pipeline recovers for the next dictation.
  it("reports recording lost when the engine crashes during begin's context lookup, and recovers", async () => {
    engine.setError('context', new EngineGone())
    const p = pipeline()
    const notices: string[] = []
    p.onState = (s: PipelineState): void => {
      if (s.type === 'notice') notices.push(s.message)
    }
    const outcome = await p.handle('beginRecording')
    expect(outcome).toEqual({ type: 'failed', reason: 'recording lost' })
    expect(notices).toEqual([Pipeline.Notice.recordingLost])
    expect(engine.callsFor('startRecording')).toHaveLength(0)
    expect(p.isListening).toBe(false)
    expect(p.isBusy).toBe(false)

    engine.clearError('context')
    expect(await dictate(p)).toEqual({ type: 'inserted', text: 'Polished.' })
  })

  // Added for review round 1 (ruling R10): a crash during paste is still "recording lost", not
  // a raw paste failure, and the pipeline recovers.
  it('reports recording lost when the engine crashes during paste, and recovers', async () => {
    engine.setError('paste', new EngineGone())
    const p = pipeline()
    const notices: string[] = []
    p.onState = (s: PipelineState): void => {
      if (s.type === 'notice') notices.push(s.message)
    }
    const outcome = await dictate(p)
    expect(outcome).toEqual({ type: 'failed', reason: 'recording lost' })
    expect(notices).toEqual([Pipeline.Notice.recordingLost])
    expect(p.isListening).toBe(false)
    expect(p.isBusy).toBe(false)

    engine.clearError('paste')
    expect(await dictate(p)).toEqual({ type: 'inserted', text: 'Polished.' })
  })

  // Added for review round 1 (ruling R10, Critical Fix 1): a plain engine failure on `selection`
  // (not EngineGone/EngineTimeout) is treated like v1's nil selection result -- refuse the edit,
  // but stopRecording still runs so the mic doesn't stay open, and the pipeline recovers.
  it('treats a selection failure as a refusal, still runs stopRecording, and recovers', async () => {
    engine.setError('selection', new Error('boom'))
    const p = pipeline()
    const notices: string[] = []
    p.onState = (s: PipelineState): void => {
      if (s.type === 'notice') notices.push(s.message)
    }
    await p.handle('beginRecording')
    const outcome = await p.handle('finishRecording', 'edit')
    expect(outcome).toEqual({ type: 'skipped', notice: Pipeline.Notice.highlightFirst })
    expect(notices).toEqual([Pipeline.Notice.highlightFirst])
    expect(engine.callsFor('stopRecording')).toHaveLength(1)
    expect(p.isListening).toBe(false)
    expect(p.isBusy).toBe(false)

    engine.clearError('selection')
    expect(await dictate(p)).toEqual({ type: 'inserted', text: 'Polished.' })
  })

  // Added for review round 1 (ruling R10, Critical Fix 2): a plain paste failure falls back to
  // copy instead of losing the text, and the pipeline recovers.
  it('falls back to copy when paste fails with a plain error, and recovers', async () => {
    engine.setError('paste', new Error('paste boom'))
    const p = pipeline()
    const notices: string[] = []
    p.onState = (s: PipelineState): void => {
      if (s.type === 'notice') notices.push(s.message)
    }
    const outcome = await dictate(p)
    expect(outcome).toEqual({ type: 'copied', text: 'Polished.' })
    expect(engine.callsFor('paste')).toHaveLength(1)
    expect(engine.callsFor('copy')).toHaveLength(1)
    expect(notices).toEqual([Pipeline.Notice.copied('mac')])

    engine.clearError('paste')
    expect(await dictate(p)).toEqual({ type: 'inserted', text: 'Polished.' })
  })

  // Added for review round 1 (ruling R10, Critical Fix 2): when the copy fallback also fails,
  // the outcome is `failed` with Notice.failed, not a stuck pipeline -- and it recovers.
  it('reports failed when paste and its copy fallback both fail, and recovers', async () => {
    engine.setError('paste', new Error('paste boom'))
    engine.setError('copy', new Error('copy boom'))
    const p = pipeline()
    const notices: string[] = []
    const states: PipelineState[] = []
    p.onState = (s: PipelineState): void => {
      states.push(s)
      if (s.type === 'notice') notices.push(s.message)
    }
    const outcome = await dictate(p)
    expect(outcome).toEqual({ type: 'failed', reason: 'copy boom' })
    expect(notices).toEqual([Pipeline.Notice.failed])
    expect(states[states.length - 1]).toEqual({ type: 'idle' })
    expect(p.isListening).toBe(false)
    expect(p.isBusy).toBe(false)

    engine.clearError('paste')
    engine.clearError('copy')
    expect(await dictate(p)).toEqual({ type: 'inserted', text: 'Polished.' })
  })

  // Added for review round 1 (ruling R10, Critical Fix 3): copy failing on the "front app
  // changed" branch (no paste attempted at all) is still a clean `failed`, and it recovers.
  it('reports failed when copy fails after the front app changed, and recovers', async () => {
    engine.setReply('context', slackContext, terminalContext)
    engine.setError('copy', new Error('copy boom'))
    const p = pipeline()
    const notices: string[] = []
    p.onState = (s: PipelineState): void => {
      if (s.type === 'notice') notices.push(s.message)
    }
    const outcome = await dictate(p)
    expect(outcome).toEqual({ type: 'failed', reason: 'copy boom' })
    expect(notices).toEqual([Pipeline.Notice.failed])
    expect(engine.callsFor('paste')).toHaveLength(0)
    expect(p.isListening).toBe(false)
    expect(p.isBusy).toBe(false)

    engine.clearError('copy')
    engine.setReply('context', slackContext)
    expect(await dictate(p)).toEqual({ type: 'inserted', text: 'Polished.' })
  })

  // Added for review round 1 (ruling R10, Critical Fix 3): the fresh context() lookup at the
  // top of deliver can fail too (distinct from begin's own context lookup, which must still
  // succeed) -- that's also a clean `failed`, and it recovers.
  it('reports failed when the fresh context lookup in deliver fails with a plain error, and recovers', async () => {
    engine.queueReply('context', slackContext) // begin()'s lookup
    engine.queueError('context', new Error('context boom')) // deliver()'s fresh lookup
    const p = pipeline()
    const notices: string[] = []
    p.onState = (s: PipelineState): void => {
      if (s.type === 'notice') notices.push(s.message)
    }
    const outcome = await dictate(p)
    expect(outcome).toEqual({ type: 'failed', reason: 'context boom' })
    expect(notices).toEqual([Pipeline.Notice.failed])
    expect(engine.callsFor('paste')).toHaveLength(0)
    expect(engine.callsFor('copy')).toHaveLength(0)
    expect(p.isListening).toBe(false)
    expect(p.isBusy).toBe(false)

    expect(await dictate(p)).toEqual({ type: 'inserted', text: 'Polished.' })
  })

  // Added for review round 1 (ruling R10, Critical Fix 3): cancelRecording failing with a plain
  // error must not leave `target` stuck set (which would block every future recording) -- the
  // catch-all resets it and makes a best-effort second cancel attempt.
  it('reports failed when cancelRecording fails with a plain error, and recovers', async () => {
    engine.setError('cancelRecording', new Error('cancel boom'))
    const p = pipeline()
    const notices: string[] = []
    p.onState = (s: PipelineState): void => {
      if (s.type === 'notice') notices.push(s.message)
    }
    await p.handle('beginRecording')
    const outcome = await p.handle('cancelRecording')
    expect(outcome).toEqual({ type: 'failed', reason: 'cancel boom' })
    expect(notices).toEqual([Pipeline.Notice.failed])
    expect(engine.callsFor('cancelRecording')).toHaveLength(2) // the failed attempt, plus the catch-all's best-effort retry
    expect(p.isListening).toBe(false)
    expect(p.isBusy).toBe(false)

    engine.clearError('cancelRecording')
    expect(await dictate(p)).toEqual({ type: 'inserted', text: 'Polished.' })
  })

  // Added for review round 1 (Minor 2): the copied notice text is platform-specific.
  it('shows the Windows copied notice text', async () => {
    engine.setReply('paste', { result: 'copied' })
    const p = pipeline({ platform: 'windows' })
    const notices: string[] = []
    p.onState = (s: PipelineState): void => {
      if (s.type === 'notice') notices.push(s.message)
    }
    expect(await dictate(p)).toEqual({ type: 'copied', text: 'Polished.' })
    expect(notices).toEqual(['Copied — press Ctrl+V'])
  })

  // Added by the task-10 brief, step 1: history is opt-in.
  it('writes no history entries when keepHistory is false', async () => {
    settings = { ...settings, keepHistory: false }
    await dictate(pipeline())
    expect(history.recent()).toEqual([])
  })

  // The rest of this describe block ports PolishFailureTests.swift's PipelinePolishFailureTests
  // suite (Polisher's own refusal-tracking tests are in polisher.test.ts instead).

  // @Test refusedCleanupPastesLocalCleanWithNotice
  it('pastes the local clean-up with a notice when OpenRouter refused the cleanup', async () => {
    polisher.reply = null
    polisher.configError = 'No endpoints found matching your data policy'
    const p = pipeline()
    const notices: string[] = []
    p.onState = (s: PipelineState): void => {
      if (s.type === 'notice') notices.push(s.message)
    }
    const outcome = await dictate(p)
    expect(outcome).toEqual({ type: 'inserted', text: 'Ship it today' })
    expect(notices).toEqual([Pipeline.Notice.polishRefused])
  })

  // @Test plainFallbackStaysQuiet
  it('a plain fallback (no config error) stays quiet', async () => {
    polisher.reply = null
    const p = pipeline()
    const notices: string[] = []
    p.onState = (s: PipelineState): void => {
      if (s.type === 'notice') notices.push(s.message)
    }
    const outcome = await dictate(p)
    expect(outcome).toEqual({ type: 'inserted', text: 'Ship it today' })
    expect(notices).toEqual([])
  })
})
