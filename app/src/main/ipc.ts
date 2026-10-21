// Dictate v2, Task 12: main's side of `window.dictate` (shared/dictate.ts), for the Settings and
// Onboarding windows. Every input from a renderer is validated here before it reaches a store, the
// Keychain or the engine; anything malformed is rejected whole and changes nothing. Calls are
// accepted only from Dictate's own Settings and Onboarding windows (`trusted`). Errors never
// include the rejected value, so a mistyped key can't end up in an error message or a log.
// Electron is only touched through the `IpcMainLike` shape, so this is tested without it.
import { CHANNELS, STYLES, type Channel, type PermissionName, type Permissions, type TestResult } from '../shared/dictate'
import { HOTKEYS } from '../shared/hotkeys'
import type { HistoryEntry } from './core/history'
import { LANGUAGES } from './core/language'
import type { ModelChoice, Thinking } from './core/modelCatalog'
import type { Settings } from './core/settings'
import type { Shortcut } from './core/shortcuts'
import type { Style } from './core/styleRouter'

/** What the handlers act on; index.ts wires these to the stores, the engine and the polisher. */
export interface IpcDeps {
  settings: { get(): Settings; set(patch: Partial<Settings>): void }
  /** Writes the key to this app's Keychain item (engine `secret.set`). */
  saveKey(key: string): Promise<void>
  /** Deletes it (engine `secret.delete`). */
  removeKey(): Promise<void>
  hasKey(): Promise<boolean>
  /** `key` is an unsaved key to test with; null means the saved one. */
  testModel(choice: ModelChoice, key: string | null): Promise<TestResult>
  vocabulary: { get(): string[]; set(terms: string[]): void }
  shortcuts: { get(): Shortcut[]; set(list: Shortcut[]): void }
  knownApps(): string[]
  permissions(): Promise<Permissions>
  requestPermission(name: PermissionName): Promise<void>
  clearHistory(): void
  openKeyboardSettings(): void
}

export type Handlers = Record<Channel, (...args: unknown[]) => Promise<unknown>>

/** The part of Electron's `ipcMain` used here. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: { sender: unknown }, ...args: unknown[]) => unknown): void
}

const MAX_MODEL_ID = 200
const MAX_KEY = 1000
const MAX_BUNDLE_ID = 255
const MAX_OVERRIDES = 1000
const MAX_TERMS = 10_000
const MAX_TERM = 500
const MAX_SHORTCUTS = 1000
const MAX_SHORTCUT_ID = 100
const MAX_PHRASE = 500
const MAX_SHORTCUT_TEXT = 20_000

const THINKING: readonly Thinking[] = ['modelDefault', 'off', 'minimal', 'low']
const HOTKEY_VALUES = HOTKEYS.map((h) => h.raw)
const LANGUAGE_CODES = LANGUAGES.map((l) => l.code)
const SPOKEN = ['auto', ...LANGUAGE_CODES]
const PASTE = ['same', ...LANGUAGE_CODES]
const PERMISSIONS: readonly PermissionName[] = ['microphone', 'accessibility']
const SETTINGS_KEYS: readonly (keyof Settings)[] = [
  'hotkey',
  'overrides',
  'cleanupModel',
  'editModel',
  'spokenLanguage',
  'pasteLanguage',
  'keepHistory'
]
// Control characters (C0, DEL, C1) and the line/paragraph separators.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/

/** Thrown for any rejected input; the message names the field, never the value. */
export class InvalidInput extends Error {
  constructor(what: string) {
    super(`Invalid ${what}`)
    this.name = 'InvalidInput'
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], what: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw new InvalidInput(what)
  return v as T
}

function boundedString(v: unknown, max: number, what: string): string {
  if (typeof v !== 'string' || v.length > max) throw new InvalidInput(what)
  return v
}

export function validModelChoice(v: unknown): ModelChoice {
  if (!isRecord(v) || Object.keys(v).some((k) => k !== 'id' && k !== 'thinking')) throw new InvalidInput('model')
  const id = boundedString(v.id, MAX_MODEL_ID, 'model ID').trim()
  if (id.length === 0 || CONTROL.test(id)) throw new InvalidInput('model ID')
  return { id, thinking: oneOf(v.thinking, THINKING, 'thinking level') }
}

function validOverrides(v: unknown): Record<string, Style> {
  if (!isRecord(v)) throw new InvalidInput('overrides')
  const entries = Object.entries(v)
  if (entries.length > MAX_OVERRIDES) throw new InvalidInput('overrides')
  const out: Record<string, Style> = {}
  for (const [id, style] of entries) {
    if (id.trim().length === 0 || id.length > MAX_BUNDLE_ID || CONTROL.test(id)) throw new InvalidInput('app ID')
    out[id] = oneOf(style, STYLES, 'style')
  }
  return out
}

export function validSettingsPatch(v: unknown): Partial<Settings> {
  if (!isRecord(v)) throw new InvalidInput('settings')
  const patch: Partial<Settings> = {}
  for (const key of Object.keys(v)) {
    if (!(SETTINGS_KEYS as readonly string[]).includes(key)) throw new InvalidInput('setting')
    const value = v[key]
    switch (key as keyof Settings) {
      case 'hotkey':
        patch.hotkey = oneOf(value, HOTKEY_VALUES, 'hotkey')
        break
      case 'overrides':
        patch.overrides = validOverrides(value)
        break
      case 'cleanupModel':
        patch.cleanupModel = validModelChoice(value)
        break
      case 'editModel':
        patch.editModel = validModelChoice(value)
        break
      case 'spokenLanguage':
        patch.spokenLanguage = oneOf(value, SPOKEN, 'spoken language')
        break
      case 'pasteLanguage':
        patch.pasteLanguage = oneOf(value, PASTE, 'paste language')
        break
      case 'keepHistory':
        if (typeof value !== 'boolean') throw new InvalidInput('keepHistory')
        patch.keepHistory = value
        break
    }
  }
  return patch
}

/** The trimmed key; '' means remove it. No whitespace or control characters inside. */
export function validKey(v: unknown): string {
  const key = boundedString(v, MAX_KEY, 'key').trim()
  if (/\s/.test(key) || CONTROL.test(key)) throw new InvalidInput('key')
  return key
}

export function validTerms(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > MAX_TERMS) throw new InvalidInput('vocabulary')
  return v.map((term) => boundedString(term, MAX_TERM, 'vocabulary term'))
}

export function validShortcuts(v: unknown): Shortcut[] {
  if (!Array.isArray(v) || v.length > MAX_SHORTCUTS) throw new InvalidInput('shortcuts')
  return v.map((s) => {
    if (!isRecord(s)) throw new InvalidInput('shortcut')
    const id = boundedString(s.id, MAX_SHORTCUT_ID, 'shortcut ID')
    if (id.length === 0) throw new InvalidInput('shortcut ID')
    return {
      id,
      phrase: boundedString(s.phrase, MAX_PHRASE, 'shortcut phrase'),
      text: boundedString(s.text, MAX_SHORTCUT_TEXT, 'shortcut text')
    }
  })
}

/** v1's `history.recent().map(\.bundleID)`, each once, in order; blanks dropped. */
export function distinctBundleIDs(entries: readonly HistoryEntry[]): string[] {
  return [...new Set(entries.map((e) => e.bundleID).filter((id) => typeof id === 'string' && id.length > 0))]
}

export function createHandlers(deps: IpcDeps): Handlers {
  return {
    [CHANNELS.getSettings]: async () => deps.settings.get(),
    [CHANNELS.setSettings]: async (patch) => deps.settings.set(validSettingsPatch(patch)),
    [CHANNELS.saveKey]: async (raw) => {
      const key = validKey(raw)
      if (key.length === 0) await deps.removeKey()
      else await deps.saveKey(key)
      return deps.hasKey()
    },
    [CHANNELS.hasKey]: async () => (await deps.hasKey()) === true,
    [CHANNELS.testModel]: async (choice, key) => {
      const validChoice = validModelChoice(choice)
      let testKey: string | null = null
      if (key !== undefined) {
        testKey = validKey(key)
        if (testKey.length === 0) throw new InvalidInput('key')
      }
      return deps.testModel(validChoice, testKey)
    },
    [CHANNELS.getVocabulary]: async () => deps.vocabulary.get(),
    [CHANNELS.setVocabulary]: async (terms) => deps.vocabulary.set(validTerms(terms)),
    [CHANNELS.getShortcuts]: async () => deps.shortcuts.get(),
    [CHANNELS.setShortcuts]: async (list) => deps.shortcuts.set(validShortcuts(list)),
    [CHANNELS.knownApps]: async () => deps.knownApps(),
    [CHANNELS.permissions]: async () => deps.permissions(),
    [CHANNELS.requestPermission]: async (name) => deps.requestPermission(oneOf(name, PERMISSIONS, 'permission')),
    [CHANNELS.clearHistory]: async () => deps.clearHistory(),
    [CHANNELS.openKeyboardSettings]: async () => deps.openKeyboardSettings()
  }
}

/** Registers every handler; a call from any window `trusted` doesn't accept is refused. */
export function registerIpc(ipc: IpcMainLike, handlers: Handlers, trusted: (sender: unknown) => boolean): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipc.handle(channel, async (event, ...args) => {
      if (!trusted(event.sender)) throw new Error('Not allowed from this window')
      return handler(...args)
    })
  }
}
