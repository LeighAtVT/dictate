// v1's "Apps" tab (SettingsView.swift `apps`): a style per app, or Automatic.
import { useEffect, useState } from 'react'
import { STYLES, type Style } from '../../shared/dictate'
import type { TabProps } from './App'
import { appRows, withOverride } from './appRows'

const capitalized = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

export function AppsTab({ settings, api, save, report }: TabProps): React.JSX.Element {
  const [known, setKnown] = useState<string[]>([])

  useEffect(() => {
    api.knownApps().then(setKnown, report)
  }, [api, report])

  return (
    <div className="pane">
      <div className="secondary">
        Choose how text is handled in each app. &quot;Off&quot; never sends text off your Mac.
      </div>
      <div className="list" role="list" aria-label="Apps">
        {appRows(known, settings.overrides).map((id) => (
          <div className="list-row" role="listitem" key={id} style={{ alignItems: 'center' }}>
            <span className="grow">{id}</span>
            <select
              aria-label={`Style for ${id}`}
              style={{ width: 140 }}
              value={settings.overrides[id] ?? ''}
              onChange={(e) =>
                save({ overrides: withOverride(settings.overrides, id, (e.target.value || null) as Style | null) })
              }
            >
              <option value="">Automatic</option>
              {STYLES.map((s) => (
                <option key={s} value={s}>
                  {capitalized(s)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}
