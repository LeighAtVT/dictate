// The settings shape and its defaults, apart from SettingsStore (settingsStore.ts) so the Settings
// and Onboarding windows can share the type without pulling in node:fs. Pure.
import { CLEANUP_PRESETS, EDIT_PRESETS, type ModelChoice } from './modelCatalog'
import type { Style } from './styleRouter'

export interface Settings {
  hotkey: string
  overrides: Record<string, Style>
  cleanupModel: ModelChoice
  editModel: ModelChoice
  spokenLanguage: string
  pasteLanguage: string
  keepHistory: boolean
}

export function defaultSettings(): Settings {
  return {
    hotkey: 'fn',
    overrides: {},
    cleanupModel: CLEANUP_PRESETS[0].choice,
    editModel: EDIT_PRESETS[0].choice,
    spokenLanguage: 'en',
    pasteLanguage: 'same',
    keepHistory: true
  }
}
