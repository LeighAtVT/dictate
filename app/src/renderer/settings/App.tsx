// Dictate v2, Task 12: the Settings window, v1's `SettingsView` (Sources/DictateApp/SettingsView.swift)
// tab for tab. The "Shortcut" tab is titled "Key" here. Every change goes through `window.dictate`
// (preload/index.ts), and main pushes the saved settings back, so this window always shows what
// is on disk. Main picks the starting tab with the URL hash (tabs.ts).
import { useCallback, useEffect, useState } from 'react'
import { SETTINGS_TABS, type DictateApi, type Settings } from '../../shared/dictate'
import { AppsTab } from './AppsTab'
import { KeyTab } from './KeyTab'
import { LanguageTab } from './LanguageTab'
import { PolishTab } from './PolishTab'
import { ShortcutsTab } from './ShortcutsTab'
import { tabIndex } from './tabs'
import { VocabularyTab } from './VocabularyTab'

export interface TabProps {
  settings: Settings
  api: DictateApi
  /** Saves a settings change; a refusal shows a line under the tabs. */
  save(patch: Partial<Settings>): void
  /** Shows a line under the tabs saying something didn't load, or didn't save. */
  report(what: 'load' | 'save'): void
}

const MESSAGES = { load: "Couldn't load this tab.", save: "Couldn't save that change." } as const

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
  const [selected, setSelected] = useState(() => tabIndex(window.location.hash))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getSettings().then(setSettings, () => setError("Couldn't load settings."))
    // Main switches tabs on an open window by changing the hash (tray "add OpenRouter key").
    const onHash = (): void => setSelected(tabIndex(window.location.hash))
    window.addEventListener('hashchange', onHash)
    const unsubscribe = api.onSettings(setSettings)
    return () => {
      window.removeEventListener('hashchange', onHash)
      unsubscribe()
    }
  }, [api])

  const report = useCallback((what: 'load' | 'save') => setError(MESSAGES[what]), [])
  const save = useCallback(
    (patch: Partial<Settings>) => {
      setError(null)
      api.setSettings(patch).catch(() => report('save'))
    },
    [api, report]
  )
  const select = (i: number): void => {
    setSelected(i)
    setError(null)
    // Keep the hash in step without a hashchange, so main setting it later always switches.
    history.replaceState(null, '', `#${SETTINGS_TABS[i]}`)
  }

  const { Tab } = TABS[selected]
  return (
    <div className="settings">
      <div className="tabs" role="tablist">
        {TABS.map(({ title }, i) => (
          <button key={title} type="button" role="tab" aria-selected={i === selected} onClick={() => select(i)}>
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
