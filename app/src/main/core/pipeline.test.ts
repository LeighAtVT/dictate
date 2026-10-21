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
import { FakeEngine, FakePolisher, slackContext, terminalContext, textStopReply, waitUntil } from './pipelineFakes'
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

  function pipeline(opts: { ready?: boolean } = {}): Pipeline {
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
      platform: 'mac'
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
    engine.setReply('stopRecording', { result: 'noSpeech', seconds: 1 })
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

  // @Test ignoresPressWhilePipelineBusy, adapted for v2 decision 1 (one strict promise chain).
  // In v1 a begin pressed while finish() is suspended is rejected synchronously by the busy
  // check. In v2 every `handle` call is appended to one chain in arrival order, so the begin
  // instead queues behind the in-flight finish and only runs once it completes (by which point
  // busy has gone back to false) -- `isBusy` is still observably true while finish is suspended,
  // and the queued begin starts a second, independent dictation rather than being dropped.
  it('reports busy while finish is suspended, and queues a press that arrives during it', async () => {
    const release = engine.suspend('stopRecording')
    const p = pipeline()
    await p.handle('beginRecording')
    const finishing = p.handle('finishRecording')
    await waitUntil(() => engine.calledOps.has('stopRecording'))
    expect(p.isBusy).toBe(true)
    const queuedBegin = p.handle('beginRecording')
    release()
    expect(await finishing).toEqual({ type: 'inserted', text: 'Polished.' })
    expect(p.isBusy).toBe(false)
    expect(await queuedBegin).toBeNull() // began listening again; nothing to report
    expect(engine.callsFor('startRecording')).toHaveLength(2)
    expect(p.isListening).toBe(true)
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
