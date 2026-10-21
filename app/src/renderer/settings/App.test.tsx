// @vitest-environment jsdom
// The Settings window's failure lines: a load that fails says so (not "save"), and a failed
// Keychain check never claims there's no key.
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../../main/core/settings'
import type { DictateApi } from '../../shared/dictate'
import { App } from './App'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

function fakeApi(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getSettings: vi.fn(async () => defaultSettings()),
    setSettings: vi.fn(async () => {}),
    onSettings: vi.fn(() => () => {}),
    hasKey: vi.fn(async () => false),
    testModel: vi.fn(),
    saveKey: vi.fn(),
    vocabulary: { get: vi.fn(async () => ['Acme']), set: vi.fn(async () => {}) },
    shortcuts: { get: vi.fn(async () => []), set: vi.fn(async () => {}) },
    knownApps: vi.fn(async () => []),
    permissions: vi.fn(),
    requestPermission: vi.fn(),
    clearHistory: vi.fn(async () => {}),
    openKeyboardSettings: vi.fn(async () => {}),
    ...overrides
  } as unknown as DictateApi
}

describe('Settings window', () => {
  it('opens on the tab named in the URL hash', async () => {
    window.location.hash = '#polish'
    render(<App api={fakeApi()} />)
    expect((await screen.findByRole('tab', { name: 'Polish' })).getAttribute('aria-selected')).toBe('true')
  })

  it('says a failed load is a load, not a save', async () => {
    render(<App api={fakeApi({ knownApps: vi.fn(async () => Promise.reject(new Error('engine gone'))) })} />)
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Apps' }))
    expect(await screen.findByText("Couldn't load this tab.")).toBeTruthy()
    expect(screen.queryByText("Couldn't save that change.")).toBeNull()
  })

  it('says a failed save is a save', async () => {
    const api = fakeApi({ setSettings: vi.fn(async () => Promise.reject(new Error('invalid'))) })
    render(<App api={api} />)
    await userEvent.setup().selectOptions(await screen.findByRole('combobox', { name: 'Key' }), 'Right Option (⌥)')
    expect(await screen.findByText("Couldn't save that change.")).toBeTruthy()
  })

  it('does not show "No key" when the Keychain check fails', async () => {
    window.location.hash = '#polish'
    render(<App api={fakeApi({ hasKey: vi.fn(async () => Promise.reject(new Error('engine gone'))) })} />)
    expect(await screen.findByText("Couldn't check for a saved key.")).toBeTruthy()
    expect(screen.queryByText('No key: text is cleaned locally only.')).toBeNull()
  })

  it('reports a failed "Clear history"', async () => {
    window.location.hash = '#polish'
    render(<App api={fakeApi({ clearHistory: vi.fn(async () => Promise.reject(new Error('disk'))) })} />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Clear history' }))
    expect(await screen.findByText("Couldn't save that change.")).toBeTruthy()
  })
})
