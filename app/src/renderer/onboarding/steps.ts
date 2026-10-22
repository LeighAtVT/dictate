// Dictate v2, Task 12: the Onboarding window's logic, kept out of App.tsx so it can be tested.
// v1's two permission rows (Sources/DictateApp/OnboardingView.swift), then the new third step,
// "Paste your OpenRouter key". That step is skipped when this app already has a key (one imported
// from v1, say), and a typed key is saved only once a test call with it works. "Skip for now"
// keeps v1's two-step setup: without a key, dictation still works and pastes without cleanup. Pure.
import { DEFAULT_CLEANUP } from '../../main/core/modelCatalog'
import type { DictateApi } from '../../shared/dictate'

export type StepId = 'microphone' | 'accessibility' | 'key'
export type StepState = 'todo' | 'done' | 'skipped'

export interface OnboardingState {
  microphone: boolean
  accessibility: boolean
  /** Whether a key existed when the window opened; null until hasKey() answers. */
  hadKey: boolean | null
  /** A key was tested and saved in this window. */
  keySaved: boolean
  /** "Skip for now" was pressed. */
  keySkipped: boolean
}

export function onboardingSteps(s: OnboardingState): { id: StepId; state: StepState }[] {
  const steps: { id: StepId; state: StepState }[] = [
    { id: 'microphone', state: s.microphone ? 'done' : 'todo' },
    { id: 'accessibility', state: s.accessibility ? 'done' : 'todo' }
  ]
  if (s.hadKey === false) {
    steps.push({ id: 'key', state: s.keySaved ? 'done' : s.keySkipped ? 'skipped' : 'todo' })
  }
  return steps
}

/** v1's "All set" line: both permissions, and the key step done or skipped. */
export function allSet(s: OnboardingState): boolean {
  return s.microphone && s.accessibility && (s.hadKey === true || s.keySaved || s.keySkipped)
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
