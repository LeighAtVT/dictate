// v1's "Shortcut" tab (SettingsView.swift `shortcut`), titled "Key" in v2: which key dictates.
import { HOTKEYS, hotkeyShortName } from '../../shared/hotkeys'
import type { TabProps } from './App'
import { Section } from './Section'

export function KeyTab({ settings, api, save }: TabProps): React.JSX.Element {
  const key = hotkeyShortName(settings.hotkey)
  return (
    <div className="pane">
      <Section title="Dictation key">
        <label className="row">
          <span>Key</span>
          <select aria-label="Key" value={settings.hotkey} onChange={(e) => save({ hotkey: e.target.value })}>
            {HOTKEYS.map((h) => (
              <option key={h.raw} value={h.raw}>
                {h.displayName}
              </option>
            ))}
          </select>
        </label>
        <div className="callout">
          <div>Hold {key} to talk, let go to paste.</div>
          <div>
            Double-tap {key} to keep listening hands-free; tap once more to paste, or press Esc to cancel.
          </div>
        </div>
      </Section>
      <Section title="More with the same key">
        <div className="callout">
          <div>
            Highlight text, then hold {key} + Shift and say how to change it (&quot;make this friendlier&quot;, &quot;shorten
            it&quot;).
          </div>
          <div>
            Hold {key} + Control for a note to self: it goes to Yardmaster Tasks, or to Dictate Notes.md in Documents.
          </div>
        </div>
      </Section>
      {settings.hotkey === 'fn' && (
        <Section title="Fn needs one macOS setting">
          <div className="callout">
            Set System Settings → Keyboard → &quot;Press 🌐 key to&quot; → Do Nothing, or macOS will open the emoji picker or
            its own dictation too. If Wispr Flow is still installed, quit it, since it also uses Fn.
          </div>
          <div className="row start">
            <button type="button" onClick={() => void api.openKeyboardSettings()}>
              Open Keyboard Settings
            </button>
          </div>
        </Section>
      )}
    </div>
  )
}
