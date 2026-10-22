// v1's "Shortcuts" tab (SettingsView.swift `shortcuts`): say a phrase, paste exact text. Edits are
// drafts until "Save shortcuts"; rows with a blank phrase are dropped on save.
import { useEffect, useState } from 'react'
import type { Shortcut } from '../../shared/dictate'
import type { TabProps } from './App'

export function ShortcutsTab({ api, report }: TabProps): React.JSX.Element {
  const [drafts, setDrafts] = useState<Shortcut[]>([])

  useEffect(() => {
    api.shortcuts.get().then(setDrafts, () => report('load'))
  }, [api, report])

  const update = (id: string, change: Partial<Shortcut>): void =>
    setDrafts((list) => list.map((s) => (s.id === id ? { ...s, ...change } : s)))

  const saveShortcuts = async (): Promise<void> => {
    try {
      await api.shortcuts.set(drafts.filter((s) => s.phrase.trim().length > 0))
      setDrafts(await api.shortcuts.get())
    } catch {
      report('save')
    }
  }

  return (
    <div className="pane">
      <div className="secondary">Say the phrase on its own and Dictate pastes the text exactly.</div>
      <div className="list" role="list" aria-label="Shortcuts">
        {drafts.map((s) => (
          <div className="list-row" role="listitem" key={s.id}>
            <input
              type="text"
              aria-label="Phrase"
              placeholder="Phrase, e.g. my zoom link"
              style={{ width: 170 }}
              value={s.phrase}
              onChange={(e) => update(s.id, { phrase: e.target.value })}
            />
            <textarea
              aria-label="Text"
              style={{ flex: 1, height: 54 }}
              value={s.text}
              onChange={(e) => update(s.id, { text: e.target.value })}
            />
            <button
              type="button"
              className="borderless destructive"
              aria-label="Remove shortcut"
              onClick={() => setDrafts((list) => list.filter((d) => d.id !== s.id))}
            >
              ⊖
            </button>
          </div>
        ))}
      </div>
      <div className="row">
        <button
          type="button"
          onClick={() => setDrafts((list) => [...list, { id: crypto.randomUUID(), phrase: '', text: '' }])}
        >
          Add shortcut
        </button>
        <button type="button" onClick={() => void saveShortcuts()}>
          Save shortcuts
        </button>
      </div>
    </div>
  )
}
