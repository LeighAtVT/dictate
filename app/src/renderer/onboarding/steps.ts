// Dictate v2, Task 12: the Onboarding window's logic, kept out of App.tsx so it can be tested.
// v1's two permission rows (Sources/DictateApp/OnboardingView.swift), then the new third step,
// "Paste your OpenRouter key". That step is skipped when this app already has a key (one imported
// from v1, say), and a typed key is saved only once a test call with it works. Pure.
import { DEFAULT_CLEANUP } from '../../main/core/modelCatalog'
import type { DictateApi } from '../../shared/dictate'

export type StepId = 'microphone' | 'accessibility' | 'key'

export interface OnboardingState {
  microphone: boolean
  accessibility: boolean
  /** Whether a key existed when the window opened; null until hasKey() answers. */
  hadKey: boolean | null
  /** A key was tested and saved in this window. */
  keySaved: boolean
}

export function onboardingSteps(s: OnboardingState): { id: StepId; done: boolean }[] {
  const steps: { id: StepId; done: boolean }[] = [
    { id: 'microphone', done: s.microphone },
    { id: 'accessibility', done: s.accessibility }
  ]
  if (s.hadKey === false) steps.push({ id: 'key', done: s.keySaved })
  return steps
}

/** v1's "All set" line, which now also waits for the key. */
export function allSet(s: OnboardingState): boolean {
  return s.microphone && s.accessibility && (s.hadKey === true || s.keySaved)
}

/** Tests `input` on the default cleanup model and saves it only if that works. */
export async function testAndSaveKey(
  input: string,
  api: Pick<DictateApi, 'testModel' | 'saveKey'>
): Promise<{ saved: boolean; status: string | null }> {
  const key = input.trim()
  if (key.length === 0) return { saved: false, status: null }
  let result
  try {
    result = await api.testModel(DEFAULT_CLEANUP, key)
  } catch {
    return { saved: false, status: '✗ The test could not run. — not saved' }
  }
  if ('failed' in result) return { saved: false, status: `✗ ${result.failed} — not saved` }
  try {
    await api.saveKey(key)
  } catch {
    return { saved: false, status: '✗ The key works, but the Keychain would not save it — not saved' }
  }
  return { saved: true, status: `✓ Worked in ${result.worked.toFixed(1)} s. Key saved.` }
}
