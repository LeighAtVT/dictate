// @vitest-environment jsdom
// Dictate v2, Task 12: ModelPicker keeps PR #2's rules (v1 SettingsView.swift `ModelPicker`): a
// typed model is saved only once a test call works, a failure says "— not saved", a saved custom
// model opens with its field showing, and a blank ID can't be tested.
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLEANUP_PRESETS, type ModelChoice } from '../../main/core/modelCatalog'
import type { TestResult } from '../../shared/dictate'
import { ModelPicker } from './ModelPicker'

afterEach(cleanup)

function setup(choice: ModelChoice, result: TestResult = { failed: 'unused' }) {
  const setSettings = vi.fn()
  const test = vi.fn(async (_choice: ModelChoice): Promise<TestResult> => result)
  render(
    <ModelPicker
      presets={CLEANUP_PRESETS}
      choice={choice}
      onSave={(picked) => setSettings({ cleanupModel: picked })}
      test={test}
    />
  )
  return { setSettings, test, user: userEvent.setup() }
}

const presetChoice = CLEANUP_PRESETS[0].choice

describe('ModelPicker', () => {
  it('marks the first preset "(recommended)" and offers Custom…', () => {
    setup(presetChoice)
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options[0]).toBe(`${CLEANUP_PRESETS[0].name} (recommended)`)
    expect(options.slice(1, CLEANUP_PRESETS.length)).toEqual(CLEANUP_PRESETS.slice(1).map((p) => p.name))
    expect(options.at(-1)).toBe('Custom…')
    expect(screen.queryByRole('textbox', { name: 'OpenRouter model ID' })).toBeNull()
  })

  it('a failing test of a typed custom ID does not call setSettings and shows "— not saved"', async () => {
    const { setSettings, test, user } = setup(presetChoice, { failed: 'No such model.' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'Custom…')
    await user.type(screen.getByRole('textbox', { name: 'OpenRouter model ID' }), 'acme/not-a-model')
    await user.click(screen.getByRole('button', { name: 'Test' }))

    expect(await screen.findByText('✗ No such model. — not saved')).toBeTruthy()
    expect(test).toHaveBeenCalledWith({ id: 'acme/not-a-model', thinking: 'modelDefault' })
    expect(setSettings).not.toHaveBeenCalled()
  })

  it('a passing test saves {id, thinking: "modelDefault"}', async () => {
    const { setSettings, user } = setup(presetChoice, { worked: 1.234 })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'Custom…')
    await user.type(screen.getByRole('textbox', { name: 'OpenRouter model ID' }), '  acme/new-model  ')
    await user.click(screen.getByRole('button', { name: 'Test' }))

    expect(await screen.findByText('✓ Worked in 1.2 s')).toBeTruthy()
    expect(setSettings).toHaveBeenCalledExactlyOnceWith({ cleanupModel: { id: 'acme/new-model', thinking: 'modelDefault' } })
  })

  it('Return in the field runs the test too', async () => {
    const { setSettings, test, user } = setup(presetChoice, { worked: 0.5 })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'Custom…')
    await user.type(screen.getByRole('textbox', { name: 'OpenRouter model ID' }), 'acme/new-model{Enter}')

    expect(await screen.findByText('✓ Worked in 0.5 s')).toBeTruthy()
    expect(test).toHaveBeenCalledOnce()
    expect(setSettings).toHaveBeenCalledOnce()
  })

  it('a saved custom choice opens with the custom field visible', () => {
    setup({ id: 'acme/custom', thinking: 'modelDefault' })
    expect((screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement).value).toBe('custom')
    expect((screen.getByRole('textbox', { name: 'OpenRouter model ID' }) as HTMLInputElement).value).toBe('acme/custom')
  })

  it('a failed test of the saved choice itself says only why', async () => {
    const { setSettings, user } = setup({ id: 'acme/custom', thinking: 'modelDefault' }, { failed: 'Out of credits.' })
    await user.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText('✗ Out of credits.')).toBeTruthy()
    expect(setSettings).not.toHaveBeenCalled()
  })

  it('a blank ID disables Test', async () => {
    const { test, user } = setup(presetChoice)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'Custom…')
    const button = screen.getByRole('button', { name: 'Test' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)

    await user.type(screen.getByRole('textbox', { name: 'OpenRouter model ID' }), '   {Enter}')
    expect(button.disabled).toBe(true)
    expect(test).not.toHaveBeenCalled()
  })

  it('picking a preset saves it straight away, without a test', async () => {
    const { setSettings, test, user } = setup(presetChoice)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Model' }), CLEANUP_PRESETS[1].name)
    expect(setSettings).toHaveBeenCalledExactlyOnceWith({ cleanupModel: CLEANUP_PRESETS[1].choice })
    expect(test).not.toHaveBeenCalled()
  })
})
