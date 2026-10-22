// Dictate v2, Task 12: `window.dictate`, the one API the Settings and Onboarding windows get.
// preload/index.ts exposes it over these IPC channels; main/ipc.ts validates every input and
// answers. The OpenRouter key only ever travels renderer -> main: `saveKey` is write-only and
// `hasKey` returns a boolean, so no reply carries the key. Types and constants only.
import type { ModelChoice } from '../main/core/modelCatalog'
import type { CheckResult } from '../main/core/polisher'
import type { Settings } from '../main/core/settings'
import type { Shortcut } from '../main/core/shortcuts'
import type { Style } from '../main/core/styleRouter'
import type { ReplyMap } from './protocol'

export type { ModelChoice, Settings, Shortcut, Style }
export type Permissions = ReplyMap['permissions']
export type PermissionName = 'microphone' | 'accessibility'
/** Polisher.check's result: seconds it took, or why it failed. */
export type TestResult = CheckResult

export interface DictateApi {
  getSettings(): Promise<Settings>
  /** Only the keys given change. Rejects an invalid patch and changes nothing. */
  setSettings(patch: Partial<Settings>): Promise<void>
  /** Called with the new settings after every change, from any window. Returns an unsubscribe. */
  onSettings(callback: (settings: Settings) => void): () => void
  /** Saves the key to the Keychain; a blank key removes it (v1's `saveKey("")`). Resolves to hasKey. */
  saveKey(key: string): Promise<boolean>
  /** Whether this app's own Keychain item holds a key. */
  hasKey(): Promise<boolean>
  /**
   * One sample cleanup with `choice`. `key` tests a key that isn't saved yet (Onboarding);
   * without it the saved key is used.
   */
  testModel(choice: ModelChoice, key?: string): Promise<TestResult>
  vocabulary: { get(): Promise<string[]>; set(terms: string[]): Promise<void> }
  shortcuts: { get(): Promise<Shortcut[]>; set(list: Shortcut[]): Promise<void> }
  /** The distinct app bundle IDs in the dictation history. */
  knownApps(): Promise<string[]>
  permissions(): Promise<Permissions>
  requestPermission(name: PermissionName): Promise<void>
  clearHistory(): Promise<void>
  openKeyboardSettings(): Promise<void>
}

/** Request channels, renderer -> main (`ipcRenderer.invoke`). */
export const CHANNELS = {
  getSettings: 'dictate:getSettings',
  setSettings: 'dictate:setSettings',
  saveKey: 'dictate:saveKey',
  hasKey: 'dictate:hasKey',
  testModel: 'dictate:testModel',
  getVocabulary: 'dictate:vocabulary.get',
  setVocabulary: 'dictate:vocabulary.set',
  getShortcuts: 'dictate:shortcuts.get',
  setShortcuts: 'dictate:shortcuts.set',
  knownApps: 'dictate:knownApps',
  permissions: 'dictate:permissions',
  requestPermission: 'dictate:requestPermission',
  clearHistory: 'dictate:clearHistory',
  openKeyboardSettings: 'dictate:openKeyboardSettings'
} as const

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS]

/** Push channel, main -> renderer: the full settings after a change. */
export const SETTINGS_CHANGED = 'dictate:settings'

/** The Settings window's tabs, in order. Main opens one by putting its name in the URL hash. */
export const SETTINGS_TABS = ['key', 'polish', 'vocabulary', 'shortcuts', 'language', 'apps'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

export function isSettingsTab(v: unknown): v is SettingsTab {
  return typeof v === 'string' && (SETTINGS_TABS as readonly string[]).includes(v)
}

/** v1's `Style.allCases`, in order, for the Apps tab. */
export const STYLES: readonly Style[] = ['slack', 'email', 'docs', 'raw', 'off']
