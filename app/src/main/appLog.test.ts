// Task 14: dictate.log lines (appLog.ts), and the rule that dictate.log never receives dictated text.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventLog } from './core/eventLog'
import { History } from './core/history'
import { FakeEngine, FakeNotes, FakePolisher, textStopReply } from './core/pipelineFakes'
import { Pipeline, type PipelineDeps } from './core/pipeline'
import { defaultSettings } from './core/settingsStore'
import { dictationReporter, launchLine, logRecorder, previousRunLines } from './appLog'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictate-applog-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('launchLine', () => {
  // v1's startJournal: "launch pid=… agent=… accessibility=…", plus v2's version.
  it("is v1's launch line with the version", () => {
    expect(launchLine({ pid: 4242, version: '2.0.0-beta.1', agent: true, accessibility: false })).toBe(
      'launch pid=4242 version=2.0.0-beta.1 agent=true accessibility=false'
    )
  })
})

describe('previousRunLines', () => {
  it("reports the unclean run and Dictate's crash reports written since it launched, newest first", () => {
    const launchedAt = new Date(Date.now() - 60_000)
    const reports = path.join(dir, 'DiagnosticReports')
    fs.mkdirSync(reports)
    const old = path.join(reports, 'Dictate-old.ips')
    const v1Crash = path.join(reports, 'Dictate-2026-10-22-101010.ips')
    const previewCrash = path.join(reports, 'Dictate Preview-2026-10-22-101011.ips')
    const other = path.join(reports, 'Other-2026-10-22.ips')
    const notIps = path.join(reports, 'Dictate-2026-10-22.diag')
    for (const f of [old, v1Crash, previewCrash, other, notIps]) fs.writeFileSync(f, 'x')
    const oldTime = new Date(Date.now() - 3_600_000)
    fs.utimesSync(old, oldTime, oldTime)
    const earlier = new Date(Date.now() - 1000)
    fs.utimesSync(v1Crash, earlier, earlier)

    const lines = previousRunLines(
      { pid: 77, launchedAt: launchedAt.toISOString(), cleanExit: false, exitReason: null },
      reports
    )
    expect(lines).toEqual([
      `previous run ended unexpectedly (pid=77 launched ${launchedAt.toISOString().replace(/\.\d{3}Z$/, 'Z')})`,
      `crash report: ${previewCrash}`,
      `crash report: ${v1Crash}`
    ])
  })

  it("prints the previous launch in v1's whole-second format", () => {
    const lines = previousRunLines(
      { pid: 77, launchedAt: '2026-10-22T16:28:54.123Z', cleanExit: false, exitReason: null },
      path.join(dir, 'missing')
    )
    expect(lines).toEqual(['previous run ended unexpectedly (pid=77 launched 2026-10-22T16:28:54Z)'])
  })

  it('reports only the unclean run when the reports folder is missing', () => {
    const lines = previousRunLines(
      { pid: 77, launchedAt: '2026-10-22T16:00:00Z', cleanExit: false, exitReason: null },
      path.join(dir, 'missing')
    )
    expect(lines).toEqual(['previous run ended unexpectedly (pid=77 launched 2026-10-22T16:00:00Z)'])
  })
})

describe('logRecorder', () => {
  it('appends to the event log', () => {
    const file = path.join(dir, 'logs', 'dictate.log')
    logRecorder(new EventLog(file))('engine up')
    expect(fs.readFileSync(file, 'utf8')).toMatch(/ engine up\n$/)
  })

  it('never throws when the log can not be written', () => {
    // A regular file where the log folder should be: mkdir fails.
    const blocker = path.join(dir, 'blocker')
    fs.writeFileSync(blocker, '')
    const record = logRecorder(new EventLog(path.join(blocker, 'dictate.log')))
    expect(() => record('engine up')).not.toThrow()
  })
})

describe('dictate.log never receives dictated text', () => {
  const SECRET = 'SECRET-PHRASE'

  type Step = (action: Parameters<Pipeline['handle']>[0], mode?: Parameters<Pipeline['handle']>[1]) => ReturnType<Pipeline['handle']>

  function setUp(): { engine: FakeEngine; step: Step; logFile: string } {
    const logFile = path.join(dir, 'logs', 'dictate.log')
    const record = logRecorder(new EventLog(logFile))
    const engine = new FakeEngine()
    engine.setReply('stopRecording', textStopReply(SECRET))
    const deps: PipelineDeps = {
      engine,
      polisher: () => new FakePolisher(`${SECRET}.`),
      settings: () => ({ ...defaultSettings(), overrides: {} }),
      vocabulary: () => [],
      shortcuts: () => [],
      history: new History(path.join(dir, 'history.json')),
      notes: new FakeNotes(null),
      modelReady: () => true,
      hasKey: () => true,
      platform: 'mac'
    }
    const pipeline = new Pipeline(deps)
    // The same wiring as index.ts: every outcome goes through the reporter.
    const report = dictationReporter(record, () => pipeline.lastTimings)
    const step: Step = async (action, mode) => {
      const outcome = await pipeline.handle(action, mode)
      report(outcome)
      return outcome
    }
    return { engine, step, logFile }
  }

  it('logs the timing line for a pasted dictation, without its text', async () => {
    const { step, logFile } = setUp()
    await step('beginRecording')
    const outcome = await step('finishRecording')
    expect(outcome).toEqual({ type: 'inserted', text: `${SECRET}.` })

    const log = fs.readFileSync(logFile, 'utf8')
    expect(log).toMatch(/dictation inserted transcribe=\d+\.\d\ds polish=\d+\.\d\ds insert=\d+\.\d\ds total=\d+\.\d\ds/)
    expect(log).not.toContain(SECRET)
  })

  it('logs copied, note and failed dictations without their text', async () => {
    const { engine, step, logFile } = setUp()

    // Focus moved: copied instead of pasted.
    engine.queueReply('context', { appId: 'com.a', windowTitle: null, secureInput: false, elevated: false })
    engine.queueReply('context', { appId: 'com.b', windowTitle: null, secureInput: false, elevated: false })
    await step('beginRecording')
    await step('finishRecording')

    // A note with nowhere to save: copied.
    await step('beginRecording')
    await step('finishRecording', 'note')

    // Paste and the copy fallback both fail.
    engine.setError('paste', new Error('paste refused'))
    engine.setError('copy', new Error('copy refused'))
    await step('beginRecording')
    const failed = await step('finishRecording')
    expect(failed).toEqual({ type: 'failed', reason: 'copy refused' })

    const log = fs.readFileSync(logFile, 'utf8')
    expect(log).toContain('dictation copied')
    expect(log).toContain('dictation failed: copy refused')
    expect(log).not.toContain(SECRET)
  })
})
