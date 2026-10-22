// v1's "Language" tab (SettingsView.swift `language`): what you speak and what gets pasted.
import { LANGUAGES } from '../../main/core/language'
import type { TabProps } from './App'
import { Section } from './Section'

export function LanguageTab({ settings, save }: TabProps): React.JSX.Element {
  return (
    <div className="pane">
      <Section>
        <label className="row">
          <span>I speak</span>
          <select
            aria-label="I speak"
            value={settings.spokenLanguage}
            onChange={(e) => save({ spokenLanguage: e.target.value })}
          >
            <option value="en">English</option>
            <option value="auto">Auto-detect</option>
            {LANGUAGES.filter((l) => l.code !== 'en').map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="row">
          <span>Paste in</span>
          <select
            aria-label="Paste in"
            value={settings.pasteLanguage}
            onChange={(e) => save({ pasteLanguage: e.target.value })}
          >
            <option value="same">Same as spoken</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </Section>
      <div className="caption secondary">
        Translating needs an OpenRouter key. Without one, Dictate pastes what you said.
      </div>
    </div>
  )
}
