// v1's "Vocabulary" tab (SettingsView.swift `vocabulary`): terms to spell exactly, one per line.
import { useEffect, useState } from 'react'
import type { TabProps } from './App'

export function VocabularyTab({ api, report }: TabProps): React.JSX.Element {
  const [text, setText] = useState('')

  useEffect(() => {
    api.vocabulary.get().then((terms) => setText(terms.join('\n')), report)
  }, [api, report])

  const saveVocabulary = (): void => {
    const terms = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    api.vocabulary.set(terms).catch(report)
  }

  return (
    <div className="pane">
      <div className="secondary">Names and terms to spell exactly, one per line.</div>
      <textarea
        aria-label="Vocabulary"
        className="mono"
        spellCheck={false}
        style={{ flex: 1 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row start">
        <button type="button" onClick={saveVocabulary}>
          Save vocabulary
        </button>
      </div>
    </div>
  )
}
