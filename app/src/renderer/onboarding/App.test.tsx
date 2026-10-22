// @vitest-environment jsdom
// The Onboarding window as rendered: v1's two permission rows, then the key step, which is skipped
// when a key exists and saves a key only after its test passes.
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CLEANUP } from '../../main/core/modelCatalog'
import { defaultSettings } from '../../main/core/settings'
import type { DictateApi, Permissions, TestResult } from '../../shared/dictate'
import { App } from './App'

afterEach(cleanup)

function fakeApi(opts: { hasKey: boolean; permissions: Permissions; test?: TestResult }) {
  return {
    getSettings: vi.fn(async () => ({ ...defaultSettings(), hotkey: 'rightOption' })),
    onSettings: vi.fn(() => () => {}),
    hasKey: vi.fn(async () => opts.hasKey),
    permissions: vi.fn(async () => opts.permissions),
    requestPermission: vi.fn(async () => {}),
    testModel: vi.fn(async () => opts.test ?? { failed: 'unused' }),
    saveKey: vi.fn(async () => true)
  }
}

const missing: Permissions = { accessibility: false, microphone: 'undetermined' }
const granted: Permissions = { accessibility: true, microphone: 'granted' }

describe('Onboarding', () => {
  it('shows both permissions and the key step when there is no key', async () => {
    render(<App api={fakeApi({ hasKey: false, permissions: missing }) as unknown as DictateApi} />)
    expect(await screen.findByRole('group', { name: 'Paste your OpenRouter key' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Microphone' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Accessibility' })).toBeTruthy()
    expect(await screen.findByText('Lets Dictate notice the Right Option key and paste where your cursor is.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Allow Microphone' })).toBeTruthy()
    expect(screen.queryByText('All set. You can close this window.')).toBeNull()
  })

  it('skips the key step when a key already exists, and says All set once permissions are in', async () => {
    render(<App api={fakeApi({ hasKey: true, permissions: granted }) as unknown as DictateApi} />)
    expect(await screen.findByText('All set. You can close this window.')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Paste your OpenRouter key' })).toBeNull()
  })

  it('saves the key only after its test on the default cleanup model passes', async () => {
    const api = fakeApi({ hasKey: false, permissions: granted, test: { worked: 0.9 } })
    render(<App api={api as unknown as DictateApi} />)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('OpenRouter key'), 'sk-or-v1-abc{Enter}')

    expect(await screen.findByText('✓ Worked in 0.9 s. Key saved.')).toBeTruthy()
    expect(api.testModel).toHaveBeenCalledWith(DEFAULT_CLEANUP, 'sk-or-v1-abc')
    expect(api.saveKey).toHaveBeenCalledExactlyOnceWith('sk-or-v1-abc')
    expect(api.testModel.mock.invocationCallOrder[0]).toBeLessThan(api.saveKey.mock.invocationCallOrder[0])
    expect(screen.getByText('All set. You can close this window.')).toBeTruthy()
  })

  it('"Skip for now" leaves the key unsaved and goes to All set (dictation pastes without cleanup)', async () => {
    const api = fakeApi({ hasKey: false, permissions: granted })
    render(<App api={api as unknown as DictateApi} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }))

    expect(screen.getByText('All set. You can close this window.')).toBeTruthy()
    expect(screen.getByText('Skipped. Add a key any time in Settings → Polish.')).toBeTruthy()
    expect(screen.queryByLabelText('OpenRouter key')).toBeNull()
    expect(api.testModel).not.toHaveBeenCalled()
    expect(api.saveKey).not.toHaveBeenCalled()
  })

  it('does not save a key whose test fails', async () => {
    const api = fakeApi({ hasKey: false, permissions: granted, test: { failed: 'No auth credentials found' } })
    render(<App api={api as unknown as DictateApi} />)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('OpenRouter key'), 'sk-or-v1-bad')
    await user.click(screen.getByRole('button', { name: 'Test' }))

    expect(await screen.findByText('✗ No auth credentials found — not saved')).toBeTruthy()
    expect(api.saveKey).not.toHaveBeenCalled()
    expect(screen.queryByText('All set. You can close this window.')).toBeNull()
  })
})
