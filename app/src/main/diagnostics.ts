// Dictate v2, Task 15: the tray's "Copy diagnostics" (spec 2.2 `Diagnostics`). One block of plain
// text to paste into a bug report: app and macOS versions, the variant, the engine's state and its
// last `model` event, permissions, whether a key is set, the update check, the settings, and the
// last 200 lines of dictate.log. Never the key, history, dictated text, vocabulary, or shortcuts
// (global-constraints.md, Ruling R22): it is given none of them, it never asks the engine for a
// secret, and the settings are copied field by field from a list rather than dumped whole.
import fs from 'node:fs'
import type { ReplyMap } from '../shared/protocol'
import { logTimestamp } from './core/eventLog'
import type { Settings } from './core/settings'
import type { AppStatus } from './appStatus'
import type { Update } from './updateCheck'
import type { Variant } from './variant'

export const LOG_LINES = 200

type Permissions = ReplyMap['permissions']

export interface DiagnosticsDeps {
  appVersion: string
  osVersion: string
  variant: Pick<Variant, 'name' | 'bundleId' | 'isFinal'>
  status: Pick<AppStatus, 'engine' | 'lastModelEvent' | 'permissions'>
  /** A fresh permissions read from the engine; the last poll's report is used when it fails. */
  permissions: () => Promise<Permissions>
  /** Whether a key is saved. Only ever a boolean; the key itself never reaches this module. */
  hasKey: boolean
  settings: Settings
  update: Update | null
  logFile: string
  now?: () => Date
}

/**
 * Which settings fields go in. Typed over every key of `Settings`, so a new setting fails the
 * typecheck until someone decides here whether it's safe to share. SettingsStore spreads the
 * whole settings.json, so a stray field (say, a key pasted in by hand) is never copied.
 */
const SHARED_SETTINGS: Record<keyof Settings, boolean> = {
  hotkey: true,
  overrides: true,
  cleanupModel: true,
  editModel: true,
  spokenLanguage: true,
  pasteLanguage: true,
  keepHistory: true
}

function sharedSettings(settings: Settings): Partial<Settings> {
  const out: Record<string, unknown> = {}
  for (const [key, shared] of Object.entries(SHARED_SETTINGS)) {
    if (shared && key in settings) out[key] = settings[key as keyof Settings]
  }
  return out as Partial<Settings>
}

const ENGINE_STATE: Record<AppStatus['engine'], string> = {
  starting: 'starting',
  up: 'up',
  down: 'down (restarting)',
  failed: 'failed (stopped restarting)'
}

const permissionsLine = (p: Permissions): string => `accessibility=${p.accessibility} microphone=${p.microphone}`

function readLines(file: string): string[] {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0)
  } catch {
    return []
  }
}

/** The last `LOG_LINES` lines, reaching into the rotated `.1` copy when the current file is short. */
function logTail(file: string): string[] {
  const current = readLines(file)
  if (current.length >= LOG_LINES) return current.slice(-LOG_LINES)
  return [...readLines(`${file}.1`), ...current].slice(-LOG_LINES)
}

export async function diagnostics(deps: DiagnosticsDeps): Promise<string> {
  const now = (deps.now ?? (() => new Date()))()
  const { variant, status } = deps

  let permissions: string
  try {
    permissions = `Permissions: ${permissionsLine(await deps.permissions())}`
  } catch {
    permissions = status.permissions
      ? `Permissions (last known): ${permissionsLine(status.permissions)}`
      : 'Permissions: unknown'
  }

  const tail = logTail(deps.logFile)
  const lines = [
    `${variant.name} diagnostics, ${logTimestamp(now)}`,
    `App: ${variant.name} ${deps.appVersion} (${variant.bundleId}, ${variant.isFinal ? 'final' : 'preview'} build)`,
    `macOS: ${deps.osVersion}`,
    `Engine: ${ENGINE_STATE[status.engine]}`,
    `Last model event: ${status.lastModelEvent ? JSON.stringify(status.lastModelEvent) : 'none'}`,
    permissions,
    `OpenRouter key: ${deps.hasKey ? 'set' : 'not set'}`,
    `Update: ${deps.update ? `${deps.update.version} available, ${deps.update.url}` : 'none found'}`,
    'Settings:',
    JSON.stringify(sharedSettings(deps.settings), null, 2),
    '',
    tail.length > 0 ? `Last ${tail.length} lines of dictate.log:` : 'dictate.log: none yet',
    ...tail
  ]
  return `${lines.join('\n')}\n`
}

/**
 * Copies the diagnostics through the engine's `copy` op. When the engine can't (it's down, or
 * gave up: the very case whose tray line says "use Copy diagnostics"), the app's own clipboard
 * is used instead. Returns which one was used.
 */
export async function copyDiagnostics(deps: {
  text: () => Promise<string>
  copy: (text: string) => Promise<unknown>
  fallback: (text: string) => void
}): Promise<'engine' | 'fallback'> {
  const text = await deps.text()
  try {
    await deps.copy(text)
    return 'engine'
  } catch {
    deps.fallback(text)
    return 'fallback'
  }
}
