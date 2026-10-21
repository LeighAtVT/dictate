// v1's "Polish" tab (SettingsView.swift `polish`): the OpenRouter key, the two model pickers, and
// (new in v2) the history switch. The key goes in through `saveKey` and never comes back out: the
// window only learns whether one is saved.
import { useEffect, useState } from 'react'
import { CLEANUP_PRESETS, EDIT_PRESETS } from '../../main/core/modelCatalog'
import type { TabProps } from './App'
import { ModelPicker } from './ModelPicker'
import { Section } from './Section'

export function PolishTab({ settings, api, save, report }: TabProps): React.JSX.Element {
  const [keyInput, setKeyInput] = useState('')
  /** Null until the Keychain answers; 'unknown' when the check itself failed. */
  const [hasKey, setHasKey] = useState<boolean | 'unknown' | null>(null)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [historyCleared, setHistoryCleared] = useState(false)

  useEffect(() => {
    api.hasKey().then(setHasKey, () => setHasKey('unknown'))
  }, [api])

  const saveKey = (key: string): void => {
    setKeyError(null)
    api.saveKey(key).then(
      (saved) => {
        setHasKey(saved)
        setKeyInput('')
      },
      () => setKeyError("Couldn't save that to the Keychain.")
    )
  }

  return (
    <div className="pane">
      <Section title="OpenRouter key">
        <input
          type="password"
          aria-label="OpenRouter key"
          placeholder="Paste your OpenRouter key"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
        />
        <div className="row">
          <button type="button" disabled={keyInput.trim().length === 0} onClick={() => saveKey(keyInput)}>
            Save key
          </button>
          {hasKey === true && (
            <>
              <span className="green">Key saved ✓</span>
              <span className="spacer" />
              <button type="button" className="destructive" onClick={() => saveKey('')}>
                Remove key
              </button>
            </>
          )}
          {hasKey === false && <span className="secondary spacer">No key: text is cleaned locally only.</span>}
          {hasKey === 'unknown' && <span className="secondary spacer">Couldn&apos;t check for a saved key.</span>}
        </div>
        {keyError !== null && <div className="caption">{keyError}</div>}
      </Section>
      <Section title="Cleanup and translation">
        <ModelPicker
          presets={CLEANUP_PRESETS}
          choice={settings.cleanupModel}
          onSave={(choice) => save({ cleanupModel: choice })}
          test={(choice) => api.testModel(choice)}
        />
      </Section>
      <Section title="Edit by voice">
        <ModelPicker
          presets={EDIT_PRESETS}
          choice={settings.editModel}
          onSave={(choice) => save({ editModel: choice })}
          test={(choice) => api.testModel(choice)}
        />
      </Section>
      <Section title="History">
        <div className="row">
          <label className="row start">
            <input
              type="checkbox"
              checked={settings.keepHistory}
              onChange={(e) => {
                setHistoryCleared(false)
                save({ keepHistory: e.target.checked })
              }}
            />
            <span>Keep history (last 50, 7 days)</span>
          </label>
          <span className="spacer" />
          {historyCleared && <span className="secondary">Cleared</span>}
          <button
            type="button"
            onClick={() => {
              api.clearHistory().then(
                () => setHistoryCleared(true),
                () => report('save')
              )
            }}
          >
            Clear history
          </button>
        </div>
      </Section>
      <div className="caption secondary">
        Only the transcribed text is sent, never audio, and only to servers that keep nothing.
      </div>
    </div>
  )
}
