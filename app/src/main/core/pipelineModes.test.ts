// Ported from Tests/DictateCoreTests/PipelineModesTests.swift. FakeEngine replaces
// FakeRecorder/FakeTranscriber/FakeContext/FakeInserter, and `selection` is just another
// FakeEngine reply (v1's separate FakeSelection fake). See pipeline.test.ts's header comment
// for why.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { History } from './history'
import { FakeEngine, FakeNotes, FakePolisher, slackContext, terminalContext, textStopReply } from './pipelineFakes'
import { Pipeline, type PipelineDeps, type PipelineOutcome, type PipelineState } from './pipeline'
import { defaultSettings } from './settingsStore'
import type { Shortcut } from './shortcuts'
import type { Style } from './styleRouter'
import type { DictationMode } from './modes'
import type { ReplyMap } from '../../shared/protocol'

describe('Pipeline modes', () => {
  let engine: FakeEngine
  let polisher: FakePolisher
  let notes: FakeNotes
  let history: History
  let dir: string

  beforeEach(() => {
    engine = new FakeEngine()
    engine.setReply('selection', { text: 'Original paragraph.' })
    polisher = new FakePolisher('Polished.')
    notes = new FakeNotes('tasks')
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictate-pipeline-modes-'))
    history = new History(path.join(dir, 'history.json'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function pipeline(
    opts: {
      contexts?: ReplyMap['context'][]
      overrides?: Record<string, Style>
      hasKey?: boolean
      spoken?: string
      paste?: string
      shortcuts?: Shortcut[]
    } = {}
  ): Pipeline {
    engine.setReply('context', ...(opts.contexts ?? [slackContext]))
    const deps: PipelineDeps = {
      engine,
      polisher: () => polisher,
      settings: () => ({
        ...defaultSettings(),
        overrides: opts.overrides ?? {},
        spokenLanguage: opts.spoken ?? 'en',
        pasteLanguage: opts.paste ?? 'same'
      }),
      vocabulary: () => [],
      shortcuts: () => opts.shortcuts ?? [],
      history,
      notes,
      modelReady: () => true,
      hasKey: () => opts.hasKey ?? true,
      platform: 'mac'
    }
    return new Pipeline(deps)
  }

  async function run(p: Pipeline, mode: DictationMode = 'dictate'): Promise<[PipelineOutcome | null, string[]]> {
    const notices: string[] = []
    p.onState = (s: PipelineState): void => {
      if (s.type === 'notice') notices.push(s.message)
    }
    await p.handle('beginRecording')
    const outcome = await p.handle('finishRecording', mode)
    return [outcome, notices]
  }

  // MARK: Shortcuts

  // @Test shortcutPastesSavedTextWithoutPolish
  it('a matching shortcut pastes its saved text without polish', async () => {
    engine.setReply('stopRecording', textStopReply('um, my zoom link.'))
    const zoom: Shortcut = { id: '1', phrase: 'my zoom link', text: 'https://zoom.us/j/1' }
    const [outcome] = await run(pipeline({ shortcuts: [zoom] }))
    expect(outcome).toEqual({ type: 'inserted', text: 'https://zoom.us/j/1' })
    expect(polisher.styles).toEqual([])
    expect(history.recent()[0]?.final).toBe('https://zoom.us/j/1')
  })

  // @Test nonMatchingTranscriptStillPolishes
  it('a non-matching transcript still polishes', async () => {
    engine.setReply('stopRecording', textStopReply('send my zoom link'))
    const [outcome] = await run(pipeline({ shortcuts: [{ id: '1', phrase: 'my zoom link', text: 'x' }] }))
    expect(outcome).toEqual({ type: 'inserted', text: 'Polished.' })
  })

  // @Test shortcutIsVerbatimEvenWhenTranslating
  it('a shortcut is pasted verbatim even when translating', async () => {
    engine.setReply('stopRecording', textStopReply('my signature'))
    const sig: Shortcut = { id: '2', phrase: 'my signature', text: 'Thanks,\nL' }
    const [outcome] = await run(pipeline({ spoken: 'es', paste: 'en', shortcuts: [sig] }))
    expect(outcome).toEqual({ type: 'inserted', text: 'Thanks,\nL' })
    expect(polisher.outputs).toEqual([])
  })

  // MARK: Voice editing

  // @Test editReplacesSelection
  it('edit replaces the selection', async () => {
    engine.setReply('stopRecording', textStopReply('um make it friendlier'))
    polisher.editReply = 'Rewritten.'
    const [outcome] = await run(pipeline(), 'edit')
    expect(outcome).toEqual({ type: 'inserted', text: 'Rewritten.' })
    expect(polisher.edits[0]?.text).toBe('Original paragraph.')
    expect(polisher.edits[0]?.instruction).toBe('Make it friendlier')
    expect(polisher.styles).toEqual([])
    expect(history.recent()[0]?.raw).toBe('um make it friendlier')
    expect(history.recent()[0]?.final).toBe('Rewritten.')
  })

  // @Test editWithoutSelectionAsksToHighlight
  it('edit without a selection asks to highlight', async () => {
    engine.setReply('selection', { text: null })
    const [outcome, notices] = await run(pipeline(), 'edit')
    expect(outcome).toEqual({ type: 'skipped', notice: Pipeline.Notice.highlightFirst })
    expect(notices).toEqual([Pipeline.Notice.highlightFirst])
    expect(engine.callsFor('paste')).toHaveLength(0)
    expect(history.recent()[0]?.raw).toBe('um ship it today') // what was said is kept
  })

  // @Test editNeedsAKey
  it('edit needs a key', async () => {
    const [outcome] = await run(pipeline({ hasKey: false }), 'edit')
    expect(outcome).toEqual({ type: 'skipped', notice: Pipeline.Notice.editNeedsKey })
    expect(engine.callsFor('selection')).toHaveLength(0)
    expect(history.recent()[0]?.raw).toBe('um ship it today')
  })

  // @Test editRespectsPolishOff
  it('edit respects polish being off for the app', async () => {
    const [outcome] = await run(pipeline({ overrides: { [slackContext.appId]: 'off' } }), 'edit')
    expect(outcome).toEqual({ type: 'skipped', notice: Pipeline.Notice.polishOff })
    expect(polisher.edits).toEqual([])
  })

  // @Test editWorksInRawApps
  it('edit works in raw apps', async () => {
    polisher.editReply = 'ls -la'
    const [outcome] = await run(pipeline({ contexts: [terminalContext] }), 'edit')
    expect(outcome).toEqual({ type: 'inserted', text: 'ls -la' })
  })

  // @Test failedEditLeavesTextAlone
  it('a failed edit leaves the text alone', async () => {
    polisher.editReply = null
    const [outcome, notices] = await run(pipeline(), 'edit')
    expect(outcome).toEqual({ type: 'failed', reason: 'edit' })
    expect(notices).toEqual([Pipeline.Notice.editFailed])
    expect(engine.callsFor('paste')).toHaveLength(0)
    expect(engine.callsFor('copy')).toHaveLength(0)
    expect(history.recent()[0]?.raw).toBe('um ship it today')
  })

  // @Test editCopiesWhenFocusMoved
  it('edit copies when focus moved', async () => {
    polisher.editReply = 'Rewritten.'
    const [outcome] = await run(pipeline({ contexts: [slackContext, terminalContext] }), 'edit')
    expect(outcome).toEqual({ type: 'copied', text: 'Rewritten.' })
  })

  // MARK: Note to self

  // @Test noteGoesToTasks
  it('a note goes to Tasks', async () => {
    const [outcome, notices] = await run(pipeline({ contexts: [slackContext, terminalContext] }), 'note')
    expect(outcome).toEqual({ type: 'noted', destination: 'tasks' })
    expect(notices).toEqual([Pipeline.Notice.savedTasks])
    expect(polisher.styles).toEqual(['docs'])
    expect(notes.saved).toEqual(['Polished.'])
    expect(engine.callsFor('paste')).toHaveLength(0)
    expect(engine.callsFor('copy')).toHaveLength(0)
    expect(history.recent()[0]?.bundleID).toBe('note')
  })

  // @Test noteFallsBackToFileNotice
  it('a note falls back to the file notice', async () => {
    notes.destination = 'file'
    const [outcome, notices] = await run(pipeline(), 'note')
    expect(outcome).toEqual({ type: 'noted', destination: 'file' })
    expect(notices).toEqual([Pipeline.Notice.savedFile])
  })

  // @Test unsavableNoteIsCopied
  it('an unsavable note is copied', async () => {
    notes.destination = null
    const [outcome, notices] = await run(pipeline(), 'note')
    expect(outcome).toEqual({ type: 'copied', text: 'Polished.' })
    expect(notices).toEqual([Pipeline.Notice.noteFailed])
    expect(engine.callsFor('copy')).toHaveLength(1)
  })

  // @Test noteHonorsTranslation
  it('a note honors translation', async () => {
    await run(pipeline({ spoken: 'es', paste: 'en' }), 'note')
    expect(polisher.outputs).toEqual([{ kind: 'language', name: 'English' }])
  })

  // Added for review round 2 (Minor 2): a history write failure before notes.save must not lose
  // the note itself -- addHistory swallows write errors (matching v1's History.swift `try?`), so
  // the note still gets saved and reported normally.
  it('a history save failure still gives the normal note outcome', async () => {
    let addCalls = 0
    const throwingHistory = {
      add: () => {
        addCalls++
        throw new Error('disk full')
      }
    } as unknown as History
    engine.setReply('context', slackContext)
    const deps: PipelineDeps = {
      engine,
      polisher: () => polisher,
      settings: () => ({ ...defaultSettings(), overrides: {}, spokenLanguage: 'en', pasteLanguage: 'same' }),
      vocabulary: () => [],
      shortcuts: () => [],
      history: throwingHistory,
      notes,
      modelReady: () => true,
      hasKey: () => true,
      platform: 'mac'
    }
    const p = new Pipeline(deps)
    const [outcome] = await run(p, 'note')
    expect(outcome).toEqual({ type: 'noted', destination: 'tasks' })
    expect(notes.saved).toEqual(['Polished.'])
    // Proves the swallow actually sits where `addHistory` calls `history.add` -- if `keepHistory`
    // ever defaulted to false, this test would pass without exercising it at all (review round 3,
    // Minor 3).
    expect(addCalls).toBe(1)
  })

  // MARK: Language

  // @Test transcribesInTheSpokenLanguage
  it('transcribes in the spoken language', async () => {
    await run(pipeline({ spoken: 'es', paste: 'same' }))
    expect(engine.callsFor('stopRecording').map((c) => (c as { language: string }).language)).toEqual(['es'])
    expect(polisher.outputs).toEqual([{ kind: 'same' }])
  })

  // @Test translatesWhenPasteLanguageDiffers
  it('translates when the paste language differs', async () => {
    const [outcome, notices] = await run(pipeline({ spoken: 'es', paste: 'en' }))
    expect(polisher.outputs).toEqual([{ kind: 'language', name: 'English' }])
    expect(outcome).toEqual({ type: 'inserted', text: 'Polished.' })
    expect(notices).toEqual([])
  })

  // @Test failedTranslationPastesAsSpoken
  it('a failed translation pastes as spoken', async () => {
    engine.setReply('stopRecording', textStopReply('hola equipo'))
    polisher.reply = null
    const [outcome, notices] = await run(pipeline({ spoken: 'es', paste: 'en' }))
    expect(outcome).toEqual({ type: 'inserted', text: 'Hola equipo' })
    expect(notices).toEqual([Pipeline.Notice.notTranslated])
  })

  // @Test translationWithoutKeyPastesAsSpoken
  it('translation without a key pastes as spoken', async () => {
    engine.setReply('stopRecording', textStopReply('hola equipo'))
    const [outcome, notices] = await run(pipeline({ hasKey: false, spoken: 'es', paste: 'en' }))
    expect(outcome).toEqual({ type: 'inserted', text: 'Hola equipo' })
    expect(polisher.outputs).toEqual([])
    expect(notices).toEqual([Pipeline.Notice.translateNeedsKey])
  })

  // @Test offAppsNeverTranslate
  it('off apps never translate', async () => {
    engine.setReply('stopRecording', textStopReply('hola equipo'))
    const [outcome, notices] = await run(pipeline({ overrides: { [slackContext.appId]: 'off' }, spoken: 'es', paste: 'en' }))
    expect(outcome).toEqual({ type: 'inserted', text: 'Hola equipo' })
    expect(polisher.outputs).toEqual([])
    expect(notices).toEqual([Pipeline.Notice.notTranslated])
  })
})
