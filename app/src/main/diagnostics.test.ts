// Task 15: "Copy diagnostics". Never the key, history, dictated text, vocabulary, or shortcut texts
// (global-constraints.md, Ruling R22).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { History } from './core/history'
import { saveShortcuts, saveVocabulary } from './core/fileStores'
import { FakeEngine } from './core/pipelineFakes'
import { SettingsStore } from './core/settingsStore'
import { AppStatus } from './appStatus'
import { copyDiagnostics, diagnostics, LOG_LINES, PERMISSIONS_TIMEOUT_MS, type DiagnosticsDeps } from './diagnostics'
import { variantFor } from './variant'

const KEY = 'sk-or-v1-SECRET-KEY-0123456789'
const HISTORY_RAW = 'HISTORY-RAW-PHRASE'
const HISTORY_FINAL = 'HISTORY-FINAL-PHRASE'
const VOCAB_TERM = 'VOCAB-TERM-ZEPHYR'
const SHORTCUT_PHRASE = 'SHORTCUT-PHRASE'
const SHORTCUT_TEXT = 'SHORTCUT-TEXT-BODY'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictate-diagnostics-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/** A data folder and engine the way index.ts has them: a key in secrets, history, vocabulary, shortcuts. */
function setUp(): { deps: DiagnosticsDeps & { status: AppStatus }; engine: FakeEngine; logFile: string } {
  const variant = variantFor('Dictate Preview', dir)
  fs.mkdirSync(variant.dataDir, { recursive: true })
  const engine = new FakeEngine()
  engine.setReply('secret.get', { value: KEY })
  engine.setReply('legacyKey', { key: KEY })
  engine.setReply('permissions', { accessibility: true, microphone: 'granted' })

  const history = new History(path.join(variant.dataDir, 'history.json'))
  history.add({ date: new Date().toISOString(), bundleID: 'com.apple.TextEdit', raw: HISTORY_RAW, final: HISTORY_FINAL })
  expect(history.recent()).toHaveLength(1)
  saveVocabulary(path.join(variant.dataDir, 'vocabulary.txt'), [VOCAB_TERM])
  saveShortcuts(path.join(variant.dataDir, 'shortcuts.json'), [{ id: '1', phrase: SHORTCUT_PHRASE, text: SHORTCUT_TEXT }])
  // A stray secret-looking field in settings.json reaches SettingsStore.get() (it spreads the file).
  fs.writeFileSync(path.join(variant.dataDir, 'settings.json'), JSON.stringify({ apiKey: KEY, token: KEY }))
  const settings = new SettingsStore(path.join(variant.dataDir, 'settings.json'))
  expect((settings.get() as unknown as Record<string, unknown>)['apiKey']).toBe(KEY)
  settings.set({ hotkey: 'rightOption' })

  const status = new AppStatus()
  status.engineUp()
  status.model({ event: 'model', state: 'ready' })

  fs.mkdirSync(path.dirname(variant.logFile), { recursive: true })
  fs.writeFileSync(variant.logFile, '2026-10-22T16:29:07Z launch pid=1\n2026-10-22T16:29:08Z engine up\n')

  const deps: DiagnosticsDeps & { status: AppStatus } = {
    appVersion: '2.0.0-beta.1',
    osVersion: '26.0.1',
    variant,
    status,
    permissions: () => engine.request({ op: 'permissions' }),
    hasKey: true,
    settings: settings.get(),
    update: null,
    updateStatus: 'none',
    home: dir,
    logFile: variant.logFile,
    now: () => new Date('2026-10-22T17:00:00.500Z')
  }
  return { deps, engine, logFile: variant.logFile }
}

describe('diagnostics', () => {
  it('with a key in secrets and a history entry, contains neither', async () => {
    const { deps, engine } = setUp()
    const text = await diagnostics(deps)
    expect(text).not.toContain(KEY)
    expect(text).not.toContain(HISTORY_RAW)
    expect(text).not.toContain(HISTORY_FINAL)
    // It never asks the engine for a key.
    expect(engine.calledOps.has('secret.get')).toBe(false)
    expect(engine.calledOps.has('legacyKey')).toBe(false)
  })

  it('contains no vocabulary term and no shortcut text', async () => {
    const { deps } = setUp()
    const text = await diagnostics(deps)
    expect(text).not.toContain(VOCAB_TERM)
    expect(text).not.toContain(SHORTCUT_TEXT)
    expect(text).not.toContain(SHORTCUT_PHRASE)
  })

  it('reports the app, macOS, variant, engine, model, permissions, key presence, update, settings, and the log', async () => {
    const { deps } = setUp()
    const text = await diagnostics(deps)
    expect(text).toContain('Dictate Preview diagnostics, 2026-10-22T17:00:00Z')
    expect(text).toContain('App: Dictate Preview 2.0.0-beta.1 (com.leigh.dictate.preview, preview build)')
    expect(text).toContain('macOS: 26.0.1')
    expect(text).toContain('Engine: up')
    expect(text).toContain('Last model event: {"event":"model","state":"ready"}')
    expect(text).toContain('Permissions: accessibility=true microphone=granted')
    expect(text).toContain('OpenRouter key: set')
    expect(text).toContain('Update: none found')
    expect(text).toContain('"hotkey": "rightOption"')
    expect(text).toContain('"keepHistory": true')
    expect(text).toContain('Last 2 lines of dictate.log:\n2026-10-22T16:29:07Z launch pid=1\n2026-10-22T16:29:08Z engine up')
  })

  it('names a known update, and tells a failed check from none found', async () => {
    const { deps } = setUp()
    const url = 'https://github.com/LeighAtVT/dictate/releases/tag/v2.0.0-beta.2'
    const known = { version: '2.0.0-beta.2', url }
    const line = async (patch: Partial<DiagnosticsDeps>): Promise<string | undefined> =>
      (await diagnostics({ ...deps, ...patch })).split('\n').find((l) => l.startsWith('Update:'))
    expect(await line({ update: known, updateStatus: 'found' })).toBe(`Update: 2.0.0-beta.2 available, ${url}`)
    expect(await line({ update: known, updateStatus: 'error' })).toBe(
      `Update: 2.0.0-beta.2 available, ${url} (last check failed)`
    )
    expect(await line({ update: null, updateStatus: 'error' })).toBe('Update: check failed')
    expect(await line({ update: null, updateStatus: 'none' })).toBe('Update: none found')
    expect(await line({ update: null, updateStatus: 'pending' })).toBe('Update: not checked yet')
  })

  it('gives a hung engine 2 s for permissions, then uses the last report', async () => {
    const { deps } = setUp()
    deps.status.permissionsReport({ accessibility: true, microphone: 'denied' })
    vi.useFakeTimers()
    try {
      let settled = false
      const pending = diagnostics({ ...deps, permissions: () => new Promise(() => {}) }).then((t) => {
        settled = true
        return t
      })
      await vi.advanceTimersByTimeAsync(PERMISSIONS_TIMEOUT_MS - 1)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await pending).toContain('Permissions (last known): accessibility=true microphone=denied')
      expect(PERMISSIONS_TIMEOUT_MS).toBe(2000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves no timer behind when the engine answers quickly', async () => {
    const { deps } = setUp()
    vi.useFakeTimers()
    try {
      await diagnostics(deps)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the home folder as ~ in the log tail', async () => {
    const { deps, logFile } = setUp()
    fs.writeFileSync(
      logFile,
      [
        `2026-10-22T16:29:07Z crash report: ${dir}/Library/Logs/DiagnosticReports/Dictate Preview-1.ips`,
        `2026-10-22T16:29:08Z engine: model at ${dir}/Library/Application Support/Dictate Preview/models`,
        `2026-10-22T16:29:09Z other folder ${dir}2/x and bare ${dir}`
      ].join('\n') + '\n'
    )
    const text = await diagnostics(deps)
    expect(text).toContain('crash report: ~/Library/Logs/DiagnosticReports/Dictate Preview-1.ips')
    expect(text).toContain('engine: model at ~/Library/Application Support/Dictate Preview/models')
    expect(text).toContain(`other folder ${dir}2/x and bare ~`)
    expect(text.split(dir).length - 1).toBe(1)
  })

  it('falls back to the last permissions report when the engine does not answer', async () => {
    const { deps, engine } = setUp()
    engine.setError('permissions', new Error('engine is not running'))
    deps.status.permissionsReport({ accessibility: false, microphone: 'undetermined' })
    deps.status.engineDown()
    deps.status.engineFailedForGood()
    const text = await diagnostics(deps)
    expect(text).toContain('Engine: failed (stopped restarting)')
    expect(text).toContain('Permissions (last known): accessibility=false microphone=undetermined')
    expect(text).toContain('OpenRouter key: set')
  })

  it('says so when there is no permissions report and no model event yet', async () => {
    const { deps, engine } = setUp()
    engine.setError('permissions', new Error('engine is not running'))
    const text = await diagnostics({ ...deps, status: new AppStatus(), hasKey: false })
    expect(text).toContain('Engine: starting')
    expect(text).toContain('Last model event: none')
    expect(text).toContain('Permissions: unknown')
    expect(text).toContain('OpenRouter key: not set')
  })

  it(`keeps the last ${LOG_LINES} log lines, reaching into the rotated log when the current one is short`, async () => {
    const { deps, logFile } = setUp()
    const lines = (from: number, to: number): string =>
      Array.from({ length: to - from }, (_, i) => `2026-10-22T16:00:00Z line ${from + i}`).join('\n') + '\n'
    fs.writeFileSync(`${logFile}.1`, lines(0, 150))
    fs.writeFileSync(logFile, lines(150, 250))
    const text = await diagnostics(deps)
    const tail = text.slice(text.indexOf(`Last ${LOG_LINES} lines of dictate.log:\n`))
    const logged = tail.split('\n').slice(1).filter((l) => l.includes(' line '))
    expect(logged).toHaveLength(LOG_LINES)
    expect(logged[0]).toMatch(/ line 50$/)
    expect(logged.at(-1)).toMatch(/ line 249$/)
  })

  it('says so when there is no log yet', async () => {
    const { deps, logFile } = setUp()
    fs.rmSync(logFile)
    expect(await diagnostics(deps)).toContain('dictate.log: none yet')
  })
})

describe('copyDiagnostics', () => {
  it("copies through the engine's copy op", async () => {
    const engine = new FakeEngine()
    const fallback: string[] = []
    const result = await copyDiagnostics({
      text: async () => 'DIAG',
      copy: (text) => engine.request({ op: 'copy', text }),
      fallback: (text) => fallback.push(text)
    })
    expect(result).toBe('engine')
    expect(engine.callsFor('copy')).toEqual([{ op: 'copy', text: 'DIAG' }])
    expect(fallback).toEqual([])
  })

  it("falls back to the app's own clipboard when the engine is gone (the engine-failed line points here)", async () => {
    const engine = new FakeEngine()
    engine.setError('copy', new Error('engine is not running'))
    const fallback: string[] = []
    const result = await copyDiagnostics({
      text: async () => 'DIAG',
      copy: (text) => engine.request({ op: 'copy', text }),
      fallback: (text) => fallback.push(text)
    })
    expect(result).toBe('fallback')
    expect(fallback).toEqual(['DIAG'])
  })
})
