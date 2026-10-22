import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from './core/history'
import {
  COPY_DIAGNOSTICS,
  ENGINE_FAILED,
  MODEL_FAILED,
  MODEL_PREPARING,
  PAUSE_V1,
  SWITCH_BACK_TO_V1,
  historyTitle,
  sideBySide,
  modelStatusLine,
  phaseAfter,
  trayIcon,
  trayMenu,
  type TrayItem,
  type TrayState
} from './trayModel'

const entry = (final: string, raw = final, date = '2026-10-21T10:00:00Z'): HistoryEntry => ({
  date,
  bundleID: 'com.apple.TextEdit',
  raw,
  final
})

const base: TrayState = {
  appName: 'Dictate Preview',
  recent: [],
  permissionsOK: true,
  hasKey: true,
  modelStatus: null,
  engineFailed: false,
  sideBySide: null,
  update: null
}

/** One line per item: labels, `---` for separators, `[x]` for disabled, `>` for submenus. */
function outline(items: TrayItem[], indent = ''): string[] {
  return items.flatMap((item) => {
    switch (item.kind) {
      case 'separator':
        return [`${indent}---`]
      case 'status':
        return [`${indent}[x] ${item.label}`]
      case 'submenu':
        return [`${indent}> ${item.label}`, ...outline(item.items, `${indent}  `)]
      case 'action':
        return [`${indent}${item.enabled ? '' : '[x] '}${item.label}${item.accelerator ? ` (${item.accelerator})` : ''}`]
    }
  })
}

describe('trayMenu', () => {
  it("keeps v1's items, titles, and order with nothing to report", () => {
    expect(outline(trayMenu(base))).toEqual([
      '[x] Copy last',
      '[x] Paste raw instead',
      '> History',
      '  [x] Nothing yet',
      '---',
      'Settings… (Command+,)',
      'Copy diagnostics',
      '---',
      'Quit Dictate Preview (Command+Q)'
    ])
  })

  it('puts setup, engine, and model lines first, and the key prompt above Settings', () => {
    const menu = trayMenu({
      ...base,
      permissionsOK: false,
      hasKey: false,
      modelStatus: 'Downloading speech model… 42%',
      engineFailed: true,
      recent: [entry('Polished.', 'polished')]
    })
    expect(outline(menu)).toEqual([
      'Finish setup (permissions needed)…',
      '---',
      `[x] ${ENGINE_FAILED}`,
      '[x] Downloading speech model… 42%',
      '---',
      'Copy last',
      'Paste raw instead',
      '> History',
      '  Polished.',
      '---',
      'Polish off — add OpenRouter key',
      'Settings… (Command+,)',
      'Copy diagnostics',
      '---',
      'Quit Dictate Preview (Command+Q)'
    ])
  })

  it('names the variant in the quit item', () => {
    const last = trayMenu({ ...base, appName: 'Dictate' }).at(-1)
    expect(last).toMatchObject({ kind: 'action', label: 'Quit Dictate', action: 'quit' })
  })

  it('wires each item to its action', () => {
    const actions = trayMenu({ ...base, permissionsOK: false, hasKey: false, recent: [entry('a')] })
      .filter((i): i is Extract<TrayItem, { kind: 'action' }> => i.kind === 'action')
      .map((i) => [i.label, i.action])
    expect(actions).toEqual([
      ['Finish setup (permissions needed)…', 'openOnboarding'],
      ['Copy last', 'copyLast'],
      ['Paste raw instead', 'pasteRaw'],
      ['Polish off — add OpenRouter key', 'openSettings'],
      ['Settings…', 'openSettings'],
      ['Copy diagnostics', 'copyDiagnostics'],
      ['Quit Dictate Preview', 'quit']
    ])
  })

  it('opens Settings on the Polish tab from the no-key item, and on the default tab from Settings…', () => {
    const items = trayMenu({ ...base, hasKey: false }).filter(
      (i): i is Extract<TrayItem, { kind: 'action' }> => i.kind === 'action' && i.action === 'openSettings'
    )
    expect(items.map((i) => [i.label, i.payload])).toEqual([
      ['Polish off — add OpenRouter key', 'polish'],
      ['Settings…', undefined]
    ])
  })

  it('enables "Paste raw instead" only when the newest entry was changed by cleanup', () => {
    const pasteRaw = (recent: HistoryEntry[]): boolean | undefined => {
      const item = trayMenu({ ...base, recent }).find((i) => i.kind === 'action' && i.action === 'pasteRaw')
      return item?.kind === 'action' ? item.enabled : undefined
    }
    expect(pasteRaw([entry('Same', 'Same')])).toBe(false)
    expect(pasteRaw([entry('Cleaned.', 'cleaned')])).toBe(true)
    // Only the newest counts.
    expect(pasteRaw([entry('Same', 'Same'), entry('Cleaned.', 'cleaned')])).toBe(false)
  })

  it('shows the 10 newest history entries, each copying its full text', () => {
    const recent = Array.from({ length: 12 }, (_, i) => entry(`entry ${i}`))
    const history = trayMenu({ ...base, recent }).find((i) => i.kind === 'submenu')
    expect(history?.kind).toBe('submenu')
    const rows = history?.kind === 'submenu' ? history.items : []
    expect(rows).toHaveLength(10)
    expect(rows.map((r) => (r.kind === 'action' ? [r.label, r.action, r.payload] : null))).toEqual(
      Array.from({ length: 10 }, (_, i) => [`entry ${i}`, 'copyEntry', `entry ${i}`])
    )
  })

  it('truncates long history titles but copies the whole text', () => {
    const long = 'x'.repeat(61)
    const history = trayMenu({ ...base, recent: [entry(long)] }).find((i) => i.kind === 'submenu')
    const row = history?.kind === 'submenu' ? history.items[0] : null
    expect(row).toMatchObject({ kind: 'action', label: `${'x'.repeat(57)}…`, payload: long })
  })
})

describe('update and diagnostics items (Task 15)', () => {
  const update = { version: '2.0.0-beta.2', url: 'https://github.com/LeighAtVT/dictate/releases/tag/v2.0.0-beta.2' }

  it('shows "Update available (v…)" above Settings when a newer release is known, opening its page', () => {
    const menu = trayMenu({ ...base, hasKey: false, update })
    expect(outline(menu).slice(-7)).toEqual([
      '---',
      'Update available (v2.0.0-beta.2)',
      'Polish off — add OpenRouter key',
      'Settings… (Command+,)',
      'Copy diagnostics',
      '---',
      'Quit Dictate Preview (Command+Q)'
    ])
    expect(menu.find((i) => i.kind === 'action' && i.action === 'openUpdate')).toMatchObject({
      enabled: true,
      payload: update.url
    })
  })

  it('shows no update item without a known update', () => {
    expect(outline(trayMenu(base)).filter((l) => l.startsWith('Update'))).toEqual([])
  })

  it('always offers Copy diagnostics, even when the engine keeps stopping', () => {
    const item = trayMenu({ ...base, engineFailed: true }).find((i) => i.kind === 'action' && i.action === 'copyDiagnostics')
    expect(item).toMatchObject({ label: COPY_DIAGNOSTICS, enabled: true })
    expect(ENGINE_FAILED).toContain(COPY_DIAGNOSTICS)
  })
})

describe('side by side with v1 (Task 13)', () => {
  it('shows "Pause old Dictate while testing" just above Quit while v1 is active', () => {
    expect(outline(trayMenu({ ...base, sideBySide: 'pause' })).slice(-3)).toEqual([
      '---',
      'Pause old Dictate while testing',
      'Quit Dictate Preview (Command+Q)'
    ])
    expect(PAUSE_V1).toBe('Pause old Dictate while testing')
  })

  it('shows "Switch back to old Dictate" once v1 is paused', () => {
    const menu = trayMenu({ ...base, sideBySide: 'switchBack' })
    expect(outline(menu).slice(-2)).toEqual(['Switch back to old Dictate', 'Quit Dictate Preview (Command+Q)'])
    expect(SWITCH_BACK_TO_V1).toBe('Switch back to old Dictate')
    expect(menu.at(-2)).toMatchObject({ kind: 'action', action: 'switchBackToV1', enabled: true })
    expect(trayMenu({ ...base, sideBySide: 'pause' }).at(-2)).toMatchObject({ kind: 'action', action: 'pauseV1' })
  })

  it('shows neither when there is no v1 to switch with', () => {
    expect(outline(trayMenu(base)).filter((l) => l.includes('old Dictate'))).toEqual([])
  })

  it('offers Pause while v1 is running or its agent is enabled, and Switch back otherwise', () => {
    const installed = { installed: true, running: false, agentEnabled: false }
    expect(sideBySide({ ...installed, running: true })).toBe('pause')
    expect(sideBySide({ ...installed, agentEnabled: true })).toBe('pause')
    expect(sideBySide({ ...installed, running: true, agentEnabled: true })).toBe('pause')
    expect(sideBySide(installed)).toBe('switchBack')
    // Running from somewhere without its agent plist still counts as running.
    expect(sideBySide({ installed: false, running: true, agentEnabled: false })).toBe('pause')
    // Nothing to switch back to.
    expect(sideBySide({ installed: false, running: false, agentEnabled: false })).toBeNull()
    // Not probed yet, or the final build (which is v1's replacement).
    expect(sideBySide(null)).toBeNull()
  })
})

describe('historyTitle', () => {
  it('keeps text of 60 characters or fewer whole', () => {
    expect(historyTitle('a'.repeat(60))).toBe('a'.repeat(60))
    expect(historyTitle('')).toBe('')
  })

  it('cuts text over 60 characters to 57 plus "…"', () => {
    expect(historyTitle('b'.repeat(61))).toBe(`${'b'.repeat(57)}…`)
    const sentence = 'The quick brown fox jumps over the lazy dog and keeps on running far away'
    expect(historyTitle(sentence)).toBe(`${sentence.slice(0, 57)}…`)
  })

  it('counts an emoji or accented letter as one character, as Swift does', () => {
    const emoji = '🎙️'.repeat(60)
    expect(historyTitle(emoji)).toBe(emoji)
    const combining = 'e\u0301'.repeat(61) // e + combining acute accent: one Character each
    expect(historyTitle(combining)).toBe(`${'e\u0301'.repeat(57)}…`)
    const precomposed = '\u00e9'.repeat(61)
    expect(historyTitle(precomposed)).toBe(`${'\u00e9'.repeat(57)}…`)
  })
})

describe('modelStatusLine', () => {
  it("uses v1's lines", () => {
    expect(modelStatusLine({ event: 'model', state: 'loading' })).toBe(MODEL_PREPARING)
    expect(MODEL_PREPARING).toBe('Preparing speech model…')
    expect(modelStatusLine({ event: 'model', state: 'downloading', fraction: 0.425 })).toBe('Downloading speech model… 42%')
    expect(modelStatusLine({ event: 'model', state: 'downloading', fraction: 0.999 })).toBe('Downloading speech model… 99%')
    expect(modelStatusLine({ event: 'model', state: 'downloading' })).toBe('Downloading speech model… 0%')
    expect(modelStatusLine({ event: 'model', state: 'ready' })).toBeNull()
    expect(modelStatusLine({ event: 'model', state: 'failed' })).toBe(MODEL_FAILED)
    expect(MODEL_FAILED).toBe('Speech model failed to download — relaunch to retry')
  })

  it('has the engine-failure line', () => {
    expect(ENGINE_FAILED).toBe("Dictate's engine keeps stopping — use Copy diagnostics")
  })
})

describe('tray icon', () => {
  const healthy = { permissionsOK: true, modelReady: true, engineFailed: false }

  it('follows the dictation', () => {
    expect(phaseAfter({ type: 'listening' }, 'idle')).toBe('listening')
    expect(phaseAfter({ type: 'locked' }, 'listening')).toBe('listening')
    expect(phaseAfter({ type: 'working' }, 'listening')).toBe('working')
    expect(phaseAfter({ type: 'notice', message: 'x' }, 'working')).toBe('working')
    expect(phaseAfter({ type: 'idle' }, 'working')).toBe('idle')
  })

  it('shows warning at rest when Dictate cannot dictate', () => {
    expect(trayIcon('idle', healthy)).toBe('idle')
    expect(trayIcon('idle', { ...healthy, permissionsOK: false })).toBe('warning')
    expect(trayIcon('idle', { ...healthy, modelReady: false })).toBe('warning')
    expect(trayIcon('idle', { ...healthy, engineFailed: true })).toBe('warning')
  })

  it("never covers a dictation in progress (v1's refreshIcon guard)", () => {
    expect(trayIcon('listening', { ...healthy, modelReady: false })).toBe('listening')
    expect(trayIcon('working', { ...healthy, permissionsOK: false })).toBe('working')
  })
})
