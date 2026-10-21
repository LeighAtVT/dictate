import { describe, expect, it } from 'vitest'
import { AppStatus, outcomeLogLine } from './appStatus'
import { MODEL_FAILED, MODEL_PREPARING } from './trayModel'

const granted = { accessibility: true, microphone: 'granted' as const }
const noAX = { accessibility: false, microphone: 'granted' as const }
const noMic = { accessibility: true, microphone: 'denied' as const }

describe('AppStatus: speech model', () => {
  it('starts not ready, preparing, with no failure', () => {
    const s = new AppStatus()
    expect(s.modelReady).toBe(false)
    expect(s.modelStatus).toBe(MODEL_PREPARING)
    expect(s.engineFailed).toBe(false)
  })

  it('tracks readiness and the menu line from model events', () => {
    const s = new AppStatus()
    s.model({ event: 'model', state: 'downloading', fraction: 0.42 })
    expect(s.modelReady).toBe(false)
    expect(s.modelStatus).toBe('Downloading speech model… 42%')
    s.model({ event: 'model', state: 'ready' })
    expect(s.modelReady).toBe(true)
    expect(s.modelStatus).toBeNull()
    s.model({ event: 'model', state: 'failed' })
    expect(s.modelReady).toBe(false)
    expect(s.modelStatus).toBe(MODEL_FAILED)
  })

  it('returns a log line only when the model state changes, not on every progress tick', () => {
    const s = new AppStatus()
    expect(s.model({ event: 'model', state: 'downloading', fraction: 0.1 })).toBe('speech model downloading')
    expect(s.model({ event: 'model', state: 'downloading', fraction: 0.2 })).toBeNull()
    expect(s.model({ event: 'model', state: 'loading' })).toBe('speech model loading')
    expect(s.model({ event: 'model', state: 'ready' })).toBe('speech model ready')
    expect(s.model({ event: 'model', state: 'ready' })).toBeNull()
  })
})

describe('AppStatus: engine lifecycle', () => {
  it('engine down: not ready, preparing again, and the next model state is logged again', () => {
    const s = new AppStatus()
    s.model({ event: 'model', state: 'ready' })
    s.engineDown()
    expect(s.modelReady).toBe(false)
    expect(s.modelStatus).toBe(MODEL_PREPARING)
    expect(s.model({ event: 'model', state: 'ready' })).toBe('speech model ready')
  })

  it('engine failed for good: flags the failure and drops the "Preparing" line', () => {
    const s = new AppStatus()
    s.engineDown()
    s.engineFailedForGood()
    expect(s.engineFailed).toBe(true)
    expect(s.modelReady).toBe(false)
    expect(s.modelStatus).toBeNull()
  })
})

describe('AppStatus: permissions', () => {
  it('counts as OK until the first report arrives', () => {
    expect(new AppStatus().permissionsOK).toBe(true)
  })

  it('logs the first report and every change, but not repeats', () => {
    const s = new AppStatus()
    expect(s.permissionsReport(granted).log).toBe('permissions accessibility=true microphone=granted')
    expect(s.permissionsReport(granted).log).toBeNull()
    expect(s.permissionsReport(noMic).log).toBe('permissions accessibility=true microphone=denied')
    expect(s.permissionsReport(noAX).log).toBe('permissions accessibility=false microphone=granted')
  })

  it('needs both Accessibility and a granted microphone', () => {
    const s = new AppStatus()
    s.permissionsReport(granted)
    expect(s.permissionsOK).toBe(true)
    s.permissionsReport(noMic)
    expect(s.permissionsOK).toBe(false)
    s.permissionsReport({ accessibility: true, microphone: 'undetermined' })
    expect(s.permissionsOK).toBe(false)
    s.permissionsReport(noAX)
    expect(s.permissionsOK).toBe(false)
  })

  it('asks for Onboarding when a permission is missing at the first report', () => {
    expect(new AppStatus().permissionsReport(noAX).openOnboarding).toBe(true)
  })

  it('asks for Onboarding once per transition to missing, not on every poll', () => {
    const s = new AppStatus()
    expect(s.permissionsReport(granted).openOnboarding).toBe(false)
    expect(s.permissionsReport(noMic).openOnboarding).toBe(true)
    expect(s.permissionsReport(noMic).openOnboarding).toBe(false)
    // Still missing, a different one: no second window.
    expect(s.permissionsReport(noAX).openOnboarding).toBe(false)
    expect(s.permissionsReport(granted).openOnboarding).toBe(false)
    expect(s.permissionsReport(noAX).openOnboarding).toBe(true)
  })
})

describe('outcomeLogLine', () => {
  const timings = { transcribe: 0.344, polish: 0, insert: 0.2849, total: 0.6291 }

  it('formats an insert with stage timings to two decimals', () => {
    expect(outcomeLogLine({ type: 'inserted', text: 'secret words' }, timings)).toBe(
      'dictation inserted transcribe=0.34s polish=0.00s insert=0.28s total=0.63s'
    )
  })

  it('never includes dictated text', () => {
    for (const outcome of [
      { type: 'inserted' as const, text: 'secret words' },
      { type: 'copied' as const, text: 'secret words' }
    ]) {
      expect(outcomeLogLine(outcome, timings)).not.toContain('secret')
      expect(outcomeLogLine(outcome, null)).not.toContain('secret')
    }
  })

  it('falls back to the bare type for an insert without timings', () => {
    expect(outcomeLogLine({ type: 'inserted', text: 'x' }, null)).toBe('dictation inserted')
  })

  it('includes the reason for a failure', () => {
    expect(outcomeLogLine({ type: 'failed', reason: 'paste timed out' }, null)).toBe('dictation failed: paste timed out')
  })

  it('logs other outcomes by type', () => {
    expect(outcomeLogLine({ type: 'cancelled' }, timings)).toBe('dictation cancelled')
    expect(outcomeLogLine({ type: 'skippedSecure' }, null)).toBe('dictation skippedSecure')
    expect(outcomeLogLine({ type: 'skipped', notice: 'shown text' }, null)).toBe('dictation skipped')
  })

  it('logs nothing for no outcome', () => {
    expect(outcomeLogLine(null, timings)).toBeNull()
  })
})
