import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CLEANUP } from '../../main/core/modelCatalog'
import type { TestResult } from '../../shared/dictate'
import { allSet, onboardingSteps, testAndSaveKey, type OnboardingState } from './steps'

const base: OnboardingState = { microphone: false, accessibility: false, hadKey: false, keySaved: false }

describe('onboardingSteps', () => {
  it('shows the key step third, after the two permissions, when there is no key', () => {
    expect(onboardingSteps(base).map((s) => s.id)).toEqual(['microphone', 'accessibility', 'key'])
  })

  it('skips the key step when a key already exists (say, one imported from v1)', () => {
    expect(onboardingSteps({ ...base, hadKey: true }).map((s) => s.id)).toEqual(['microphone', 'accessibility'])
  })

  it('leaves the key step out until hasKey has answered', () => {
    expect(onboardingSteps({ ...base, hadKey: null }).map((s) => s.id)).toEqual(['microphone', 'accessibility'])
  })

  it('keeps showing the key step, ticked, once a key is saved in this window', () => {
    const steps = onboardingSteps({ ...base, keySaved: true })
    expect(steps.find((s) => s.id === 'key')).toEqual({ id: 'key', done: true })
  })

  it('marks each permission done as it is granted', () => {
    expect(onboardingSteps({ ...base, microphone: true }).map((s) => s.done)).toEqual([true, false, false])
    expect(onboardingSteps({ ...base, accessibility: true }).map((s) => s.done)).toEqual([false, true, false])
  })
})

describe('allSet', () => {
  it('needs both permissions and a key', () => {
    expect(allSet({ microphone: true, accessibility: true, hadKey: true, keySaved: false })).toBe(true)
    expect(allSet({ microphone: true, accessibility: true, hadKey: false, keySaved: true })).toBe(true)
    expect(allSet({ microphone: true, accessibility: true, hadKey: false, keySaved: false })).toBe(false)
    expect(allSet({ microphone: true, accessibility: false, hadKey: true, keySaved: false })).toBe(false)
    expect(allSet({ microphone: false, accessibility: true, hadKey: true, keySaved: false })).toBe(false)
  })
})

describe('testAndSaveKey', () => {
  function api(result: TestResult) {
    const calls: string[] = []
    return {
      calls,
      testModel: vi.fn(async () => {
        calls.push('test')
        return result
      }),
      saveKey: vi.fn(async () => {
        calls.push('save')
        return true
      })
    }
  }

  it('tests the trimmed key on the default cleanup model, then saves it once the test passes', async () => {
    const fake = api({ worked: 0.84 })
    expect(await testAndSaveKey('  sk-or-v1-abc  ', fake)).toEqual({ saved: true, status: '✓ Worked in 0.8 s. Key saved.' })
    expect(fake.testModel).toHaveBeenCalledWith(DEFAULT_CLEANUP, 'sk-or-v1-abc')
    expect(fake.saveKey).toHaveBeenCalledWith('sk-or-v1-abc')
    expect(fake.calls).toEqual(['test', 'save'])
  })

  it('does not save a key whose test fails', async () => {
    const fake = api({ failed: 'No auth credentials found' })
    expect(await testAndSaveKey('sk-or-v1-bad', fake)).toEqual({
      saved: false,
      status: '✗ No auth credentials found — not saved'
    })
    expect(fake.saveKey).not.toHaveBeenCalled()
  })

  it('does nothing with a blank key', async () => {
    const fake = api({ worked: 1 })
    expect(await testAndSaveKey('   ', fake)).toEqual({ saved: false, status: null })
    expect(fake.testModel).not.toHaveBeenCalled()
    expect(fake.saveKey).not.toHaveBeenCalled()
  })

  it('says so when the test itself cannot run, and saves nothing', async () => {
    const fake = api({ worked: 1 })
    fake.testModel.mockRejectedValueOnce(new Error('engine gone'))
    expect(await testAndSaveKey('sk-or-v1-abc', fake)).toEqual({ saved: false, status: '✗ The test could not run. — not saved' })
    expect(fake.saveKey).not.toHaveBeenCalled()
  })

  it('reports a key that worked but could not be saved', async () => {
    const fake = api({ worked: 1 })
    fake.saveKey.mockRejectedValueOnce(new Error('keychain'))
    expect(await testAndSaveKey('sk-or-v1-abc', fake)).toEqual({
      saved: false,
      status: '✗ The key works, but the Keychain would not save it — not saved'
    })
  })
})
