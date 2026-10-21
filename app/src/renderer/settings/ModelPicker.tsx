// Dictate v2, Task 12: v1's `ModelPicker` (Sources/DictateApp/SettingsView.swift, PR #2): a
// recommended OpenRouter model, or any model ID typed in by hand. A typed model is saved only once
// a test call works, so a typo never reaches dictation.
import { useState } from 'react'
import { presetFor, type ModelChoice, type ModelPreset } from '../../main/core/modelCatalog'
import type { TestResult } from '../../shared/dictate'

const CUSTOM = 'custom'

export interface ModelPickerProps {
  presets: ModelPreset[]
  /** The saved choice. */
  choice: ModelChoice
  /** Saves a choice: a picked preset straight away, a typed one after its test works. */
  onSave(choice: ModelChoice): void
  test(choice: ModelChoice): Promise<TestResult>
}

function sameChoice(a: ModelChoice, b: ModelChoice): boolean {
  return a.id === b.id && a.thinking === b.thinking
}

export function ModelPicker({ presets, choice, onSave, test }: ModelPickerProps): React.JSX.Element {
  const preset = presetFor(choice, presets)
  // v1's `.onAppear { if preset == nil { customID = choice.id } }`.
  const [customID, setCustomID] = useState(preset === undefined ? choice.id : '')
  const [custom, setCustom] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  const showingCustom = custom || preset === undefined
  const trimmedID = customID.trim()
  /** What Test would check: the typed ID while editing a custom model, otherwise the saved choice. */
  const target: ModelChoice | null = !showingCustom
    ? choice
    : trimmedID.length === 0
      ? null
      : { id: trimmedID, thinking: 'modelDefault' }
  const note = showingCustom
    ? "Any model on openrouter.ai/models. Press Return or Test: it's used once it works."
    : (preset?.note ?? '')

  const select = (tag: string): void => {
    setStatus(null)
    const picked = presets.find((p) => p.choice.id === tag)
    if (picked) {
      setCustom(false)
      onSave(picked.choice)
    } else {
      setCustom(true)
      setCustomID(preset === undefined ? choice.id : '')
    }
  }

  const runTest = async (): Promise<void> => {
    if (target === null || testing) return
    setTesting(true)
    setStatus(null)
    let result: TestResult
    try {
      result = await test(target)
    } catch {
      result = { failed: 'The test could not run.' }
    }
    setTesting(false)
    const isSaved = sameChoice(target, choice)
    if ('worked' in result) {
      if (!isSaved) onSave(target)
      setStatus(`✓ Worked in ${result.worked.toFixed(1)} s`)
    } else {
      setStatus(isSaved ? `✗ ${result.failed}` : `✗ ${result.failed} — not saved`)
    }
  }

  return (
    <div className="model-picker">
      <label className="row">
        <span>Model</span>
        <select aria-label="Model" value={showingCustom ? CUSTOM : choice.id} onChange={(e) => select(e.target.value)}>
          {presets.map((p, i) => (
            <option key={p.choice.id} value={p.choice.id}>
              {i === 0 ? `${p.name} (recommended)` : p.name}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
      </label>
      {showingCustom && (
        <input
          type="text"
          aria-label="OpenRouter model ID"
          placeholder="OpenRouter model ID, e.g. openai/gpt-6-sol"
          spellCheck={false}
          value={customID}
          onChange={(e) => setCustomID(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runTest()
          }}
        />
      )}
      <div className="row baseline">
        <span className="caption secondary">{note}</span>
        <button type="button" disabled={testing || target === null} onClick={() => void runTest()}>
          {testing ? 'Testing…' : 'Test'}
        </button>
      </div>
      {status !== null && <div className="caption">{status}</div>}
    </div>
  )
}
