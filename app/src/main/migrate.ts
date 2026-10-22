// Dictate v2, Task 13: the preview's first launch copies v1's data (spec 2.4). It runs once; the
// marker is `<dataDir>/migrated.json`.
//
// - Files: vocabulary.txt, shortcuts.json, history.json are copied over whatever the preview's
//   folder holds (v1's data wins over test leftovers, Ruling R29). A file v1 doesn't have is
//   skipped, not an error.
// - The speech model is hard-linked (574 MB, no second copy), or copied across volumes (EXDEV).
// - Settings: v1's UserDefaults keys, read with `defaults export`, mapped the way v1's
//   AppSettings.init reads them (Sources/DictateApp/AppSettings.swift).
// - The key: read once from v1's Keychain item (`legacyKey`, one prompt) and saved in the
//   preview's own item (`secret.set`). The marker's `key` is 'pending' from the moment the files
//   are in place until v1 answers (Ruling R33): 'imported', or 'none' (no key, or the prompt was
//   denied), after which it's never asked again. An engine that goes away mid-prompt, or a failed
//   save, leaves it 'pending', and the next launch retries only the key step; after 3 failed
//   saves it gives up ('none', Ruling R39). The preview's own key is read by the caller and passed
//   in (Ruling R37): a second secret.get overlapping index.ts's would get null from the engine's
//   CachedSecret and cause a needless prompt that overwrites the key.
//
// v1's folder and preferences are only ever read: nothing here writes inside `v1Dir`.
// Never log or report the key.
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'plist'
import { HOTKEYS } from '../shared/hotkeys'
import { atomicWrite } from './core/atomicWrite'
import { DEFAULT_EDIT, migrateLegacy, type ModelChoice, type Thinking } from './core/modelCatalog'
import type { EngineApi } from './core/pipeline'
import { defaultSettings, type Settings } from './core/settings'
import type { Style } from './core/styleRouter'
import type { Exec } from './side-by-side'

export const MARKER_FILE = 'migrated.json'
export const MODEL_FILE = path.join('models', 'ggml-large-v3-turbo-q5_0.bin')
const COPIED_FILES = ['vocabulary.txt', 'shortcuts.json', 'history.json'] as const
const V1_DEFAULTS_DOMAIN = 'com.leigh.dictate'

/** The settings keys taken from v1. `keepHistory` is v2's own. */
export type MappedSettings = Omit<Settings, 'keepHistory'>

/** `linked`/`copied`: put in place; `alreadyLinked`: already the same file; `missing`: v1 has none. */
export type ModelResult = 'linked' | 'copied' | 'alreadyLinked' | 'missing'

export interface DataReport {
  /** Names of the files copied from v1. */
  copied: string[]
  model: ModelResult
  /** Settings keys written; empty when v1 has no preferences. */
  settings: (keyof MappedSettings)[]
}

/** Where the key move stands; recorded as `key` in the marker. */
export type KeyState = 'imported' | 'none' | 'pending'

export type DataStep =
  | { status: 'alreadyMigrated' }
  | { status: 'failed'; error: string }
  /** The files were copied earlier; only the key step is left. */
  | { status: 'keyPending' }
  | { status: 'copied'; data: DataReport }

export type MigrationReport =
  | { status: 'alreadyMigrated' }
  /** A file or settings step failed. No marker was written, so the next launch tries again. */
  | { status: 'failed'; error: string }
  | ({ status: 'migrated'; key: KeyState } & DataReport)
  /** Only the key step ran, retrying an earlier 'pending'. */
  | { status: 'keyRetried'; key: KeyState }

export interface DataOptions {
  v1Dir: string
  dataDir: string
  /** v1's preferences (`readV1Defaults`), or null when it has none. */
  readDefaults: () => Promise<Record<string, unknown> | null>
  /** fs.linkSync, injectable to test the EXDEV fallback. */
  link?: (existing: string, newPath: string) => void
}

export interface MigrationOptions extends DataOptions {
  engine: EngineApi
  /** The preview's own key, as the caller's one secret.get read it; null or omitted when none. */
  ownKey?: string | null
}

/** Failed `secret.set`s after which the key step stops retrying. */
export const MAX_KEY_SAVE_FAILURES = 3

/**
 * The whole migration: `copyV1Data`, then `finishMigration`. index.ts runs the two steps
 * separately so the key step, which can wait on a Keychain prompt, never holds up dictation.
 */
export async function migrateFromV1(opts: MigrationOptions): Promise<MigrationReport> {
  const step = await copyV1Data(opts)
  if (step.status === 'alreadyMigrated' || step.status === 'failed') return step
  const finished = await finishMigration(opts.dataDir, opts.engine, opts.ownKey ?? null)
  if (finished.status === 'failed') return finished
  return step.status === 'copied'
    ? { status: 'migrated', key: finished.key, ...step.data }
    : { status: 'keyRetried', key: finished.key }
}

/**
 * Step 1: v1's files, model, and settings, then the marker with `key: 'pending'`. Skipped when
 * the marker is already there: `keyPending` when only the key step is left.
 */
export async function copyV1Data(opts: DataOptions): Promise<DataStep> {
  const v1Dir = path.resolve(opts.v1Dir)
  const dataDir = path.resolve(opts.dataDir)
  if (dataDir === v1Dir || dataDir.startsWith(v1Dir + path.sep)) {
    return { status: 'failed', error: "the data folder is inside v1's folder" }
  }
  const existing = readMarker(dataDir)
  if (existing !== null) return existing['key'] === 'pending' ? { status: 'keyPending' } : { status: 'alreadyMigrated' }
  try {
    const defaults = await opts.readDefaults()
    const copied: string[] = []
    for (const name of COPIED_FILES) {
      const content = readIfPresent(path.join(v1Dir, name))
      if (content === null) continue
      atomicWrite(path.join(dataDir, name), content)
      copied.push(name)
    }
    const model = linkModel(path.join(v1Dir, MODEL_FILE), path.join(dataDir, MODEL_FILE), opts.link ?? fs.linkSync)
    let settings: (keyof MappedSettings)[] = []
    if (defaults !== null) {
      const mapped = settingsFromV1Defaults(defaults)
      writeSettings(path.join(dataDir, 'settings.json'), mapped)
      settings = Object.keys(mapped) as (keyof MappedSettings)[]
    }
    const data: DataReport = { copied, model, settings }
    writeMarker(dataDir, { migratedAt: new Date().toISOString(), ...data, key: 'pending' })
    return { status: 'copied', data }
  } catch (error) {
    return { status: 'failed', error: message(error) }
  }
}

/**
 * Step 2: move the key (`legacyKey` → `secret.set`) and record the result in the marker. Needs
 * the marker from step 1. `ownKey` is the preview's own key: when there is one, nothing is asked.
 * It never reads the secret itself (Ruling R37).
 */
export async function finishMigration(
  dataDir: string,
  engine: EngineApi,
  ownKey: string | null
): Promise<{ status: 'done'; key: KeyState } | { status: 'failed'; error: string }> {
  const marker = readMarker(dataDir) ?? {}
  let failures = typeof marker['keySaveFailures'] === 'number' ? marker['keySaveFailures'] : 0
  const outcome = (ownKey?.trim() ?? '').length > 0 ? 'imported' : await importV1Key(engine)
  let key: KeyState = outcome === 'saveFailed' ? 'pending' : outcome
  if (outcome === 'saveFailed') {
    failures += 1
    if (failures >= MAX_KEY_SAVE_FAILURES) key = 'none'
  }
  try {
    writeMarker(dataDir, { ...marker, key, ...(failures > 0 ? { keySaveFailures: failures } : {}) })
  } catch (error) {
    return { status: 'failed', error: `couldn't write ${MARKER_FILE}: ${message(error)}` }
  }
  return { status: 'done', key }
}

/**
 * v1's item, once. A null or blank reply is v1's answer, 'none'. An error there means the engine
 * went away, so 'pending' and retried; a failed save is counted separately.
 */
async function importV1Key(engine: EngineApi): Promise<KeyState | 'saveFailed'> {
  let key: string
  try {
    key = (await engine.request({ op: 'legacyKey' })).key?.trim() ?? ''
  } catch {
    return 'pending'
  }
  if (key.length === 0) return 'none'
  try {
    await engine.request({ op: 'secret.set', value: key })
    return 'imported'
  } catch {
    return 'saveFailed'
  }
}

function readMarker(dataDir: string): Record<string, unknown> | null {
  let text: string
  try {
    text = fs.readFileSync(path.join(dataDir, MARKER_FILE), 'utf8')
  } catch {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {} // There, but unreadable: treat as done rather than copy over the preview's data again.
  }
}

function writeMarker(dataDir: string, marker: Record<string, unknown>): void {
  atomicWrite(path.join(dataDir, MARKER_FILE), JSON.stringify(marker, null, 2))
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readIfPresent(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function linkModel(src: string, dest: string, link: (existing: string, newPath: string) => void): ModelResult {
  let source: fs.Stats
  try {
    source = fs.statSync(src)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
  try {
    const existing = fs.statSync(dest)
    if (existing.ino === source.ino && existing.dev === source.dev) return 'alreadyLinked'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  // Link or copy to a temporary name, then rename over the target, so a half-copied model never
  // sits under the real name (the engine would try to load it).
  // A fixed name, so a launch killed mid-copy leaves nothing behind that the next one won't reuse.
  const tmp = `${dest}.migrating`
  fs.rmSync(tmp, { force: true })
  let result: ModelResult = 'linked'
  try {
    link(src, tmp)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    fs.copyFileSync(src, tmp)
    result = 'copied'
  }
  fs.renameSync(tmp, dest)
  return result
}

/** Overwrites the mapped keys in settings.json and keeps any other key the preview saved. */
function writeSettings(file: string, mapped: MappedSettings): void {
  let current: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (isRecord(parsed)) current = parsed
  } catch {
    // Missing or unreadable: start from v1's values alone.
  }
  atomicWrite(file, JSON.stringify({ ...current, ...mapped }, null, 2))
}

const THINKING: readonly Thinking[] = ['modelDefault', 'off', 'minimal', 'low']
const STYLES: readonly Style[] = ['slack', 'email', 'docs', 'raw', 'off']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array)
}

/** A plist `<data>` holding JSON-encoded ModelChoice, or null where Swift's decode would fail. */
function decodeChoice(value: unknown): ModelChoice | null {
  if (!(value instanceof Uint8Array)) return null
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(value))
    if (!isRecord(parsed)) return null
    const { id, thinking } = parsed
    if (typeof id !== 'string' || !THINKING.includes(thinking as Thinking)) return null
    return { id, thinking: thinking as Thinking }
  } catch {
    return null
  }
}

/**
 * v1's AppSettings.init: what v1 actually uses for each key, with its defaults for keys it never
 * saved. cleanupModel falls back to `migrateLegacy(polishModel)`, editModel to the default edit
 * model, unknown hotkeys to Fn, and style overrides keep only known styles.
 */
export function settingsFromV1Defaults(d: Record<string, unknown>): MappedSettings {
  const defaults = defaultSettings()
  const string = (key: string): string | undefined => (typeof d[key] === 'string' ? (d[key] as string) : undefined)
  const hotkey = string('hotkey')
  const overrides: Record<string, Style> = {}
  const rawOverrides = d['styleOverrides']
  if (isRecord(rawOverrides)) {
    for (const [app, style] of Object.entries(rawOverrides)) {
      if (STYLES.includes(style as Style)) overrides[app] = style as Style
    }
  }
  return {
    hotkey: hotkey !== undefined && HOTKEYS.some((h) => h.raw === hotkey) ? hotkey : defaults.hotkey,
    overrides,
    cleanupModel: decodeChoice(d['cleanupModel']) ?? migrateLegacy(string('polishModel')),
    editModel: decodeChoice(d['editModel']) ?? DEFAULT_EDIT,
    spokenLanguage: string('spokenLanguage') ?? defaults.spokenLanguage,
    pasteLanguage: string('pasteLanguage') ?? defaults.pasteLanguage
  }
}

/** `defaults export` output parsed, or null for an empty domain (no v1 preferences). */
export function parseV1Defaults(xml: string): Record<string, unknown> | null {
  const parsed: unknown = parse(xml)
  if (!isRecord(parsed)) throw new Error('v1 preferences are not a dictionary')
  return Object.keys(parsed).length === 0 ? null : parsed
}

/** Reads v1's preferences with `defaults export com.leigh.dictate -`, which only reads. */
export async function readV1Defaults(exec: Exec): Promise<Record<string, unknown> | null> {
  const out = await exec('/usr/bin/defaults', ['export', V1_DEFAULTS_DOMAIN, '-'])
  if (out.code !== 0) throw new Error(`defaults export exited ${out.code}`)
  return parseV1Defaults(out.stdout)
}
