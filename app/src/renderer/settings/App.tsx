// Dictate v2, Task 12: the Settings window, v1's `SettingsView` (Sources/DictateApp/SettingsView.swift)
// tab for tab. The "Shortcut" tab is titled "Key" here. Every change goes through `window.dictate`
// (preload/index.ts), and main pushes the saved settings back, so this window always shows what
// is on disk.
import { useCallback, useEffect, useState } from 'react'
import type { DictateApi, Settings } from '../../shared/dictate'
import { AppsTab } from './AppsTab'
import { KeyTab } from './KeyTab'
import { LanguageTab } from './LanguageTab'
import { PolishTab } from './PolishTab'
import { ShortcutsTab } from './ShortcutsTab'
import { VocabularyTab } from './VocabularyTab'

export interface TabProps {
  settings: Settings
  api: DictateApi
  /** Saves a settings change; a refusal shows a line under the tabs. */
  save(patch: Partial<Settings>): void
  /** Shows that something didn't load or save. */
  report(error: unknown): void
}

const TABS = [
  { title: 'Key', Tab: KeyTab },
  { title: 'Polish', Tab: PolishTab },
  { title: 'Vocabulary', Tab: VocabularyTab },
  { title: 'Shortcuts', Tab: ShortcutsTab },
  { title: 'Language', Tab: LanguageTab },
  { title: 'Apps', Tab: AppsTab }
] as const

export function App({ api }: { api: DictateApi }): React.JSX.Element | null {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getSettings().then(setSettings, () => setError("Couldn't load settings."))
    return api.onSettings(setSettings)
  }, [api])

  const report = useCallback(() => setError("Couldn't save that change."), [])
  const save = useCallback(
    (patch: Partial<Settings>) => {
      setError(null)
      api.setSettings(patch).catch(report)
    },
    [api, report]
  )

  const { Tab } = TABS[selected]
  return (
    <div className="settings">
      <div className="tabs" role="tablist">
        {TABS.map(({ title }, i) => (
          <button key={title} type="button" role="tab" aria-selected={i === selected} onClick={() => setSelected(i)}>
            {title}
          </button>
        ))}
      </div>
      {error !== null && <div className="caption">{error}</div>}
      {settings !== null && (
        <div role="tabpanel" aria-label={TABS[selected].title} className="pane">
          <Tab settings={settings} api={api} save={save} report={report} />
        </div>
      )}
    </div>
  )
}
