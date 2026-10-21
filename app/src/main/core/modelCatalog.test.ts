// Ported from Tests/DictateCoreTests/ModelChoiceTests.swift.
import { describe, expect, it } from 'vitest'
import {
  CLEANUP_PRESETS,
  DEFAULT_CLEANUP,
  DEFAULT_EDIT,
  EDIT_PRESETS,
  migrateLegacy,
  presetFor,
  reasoningParam
} from './modelCatalog'

describe('ModelCatalog defaults', () => {
  // @Test defaultsAreTheFirstPreset
  it('defaults to the first preset in each list', () => {
    expect(DEFAULT_CLEANUP).toEqual(CLEANUP_PRESETS[0].choice)
    expect(DEFAULT_EDIT).toEqual(EDIT_PRESETS[0].choice)
    expect(DEFAULT_CLEANUP.id).toBe('z-ai/glm-5.3-flash')
    expect(DEFAULT_EDIT.id).toBe('deepseek/deepseek-v4.1-flash')
  })

  // @Test presetIDsAreUnique
  it('has unique preset ids within each list', () => {
    for (const list of [CLEANUP_PRESETS, EDIT_PRESETS]) {
      expect(new Set(list.map((p) => p.choice.id)).size).toBe(list.length)
    }
  })
})

describe('migrateLegacy', () => {
  // @Test oldDefaultMigratesToNewDefault
  it('migrates the old default (or nothing, or blank) to the new default', () => {
    expect(migrateLegacy(undefined)).toEqual(DEFAULT_CLEANUP)
    expect(migrateLegacy('anthropic/claude-haiku-5.5')).toEqual(DEFAULT_CLEANUP)
    expect(migrateLegacy('  ')).toEqual(DEFAULT_CLEANUP)
  })

  // @Test customLegacyModelIsKept
  it('keeps a custom legacy model, trimmed, with default thinking', () => {
    expect(migrateLegacy(' openai/gpt-6-sol ')).toEqual({ id: 'openai/gpt-6-sol', thinking: 'modelDefault' })
  })
})

describe('presetFor', () => {
  // @Test presetLookup
  it('looks up a preset by exact choice (id and thinking)', () => {
    expect(presetFor(DEFAULT_CLEANUP, CLEANUP_PRESETS)?.name).toBe('GLM 5.3 Flash')
    expect(presetFor({ id: 'z-ai/glm-5.3-flash', thinking: 'off' }, CLEANUP_PRESETS)).toBeUndefined()
    expect(presetFor({ id: 'someone/custom', thinking: 'modelDefault' }, CLEANUP_PRESETS)).toBeUndefined()
  })
})

describe('ModelChoice JSON round trip', () => {
  // @Test roundTripsThroughJSON
  it('round-trips through JSON', () => {
    const choice = { id: 'z-ai/glm-5.3-flash', thinking: 'minimal' as const }
    expect(JSON.parse(JSON.stringify(choice))).toEqual(choice)
  })
})

describe('reasoningParam', () => {
  // @Test reasoningParameter
  it('maps each Thinking case to its OpenRouter reasoning parameter', () => {
    expect(reasoningParam('modelDefault')).toBeUndefined()
    expect((reasoningParam('off') as { enabled: boolean }).enabled).toBe(false)
    expect((reasoningParam('minimal') as { effort: string }).effort).toBe('minimal')
    expect((reasoningParam('low') as { effort: string }).effort).toBe('low')
  })
})
