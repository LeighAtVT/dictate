// Dictate v2, Task 11: what the menu-bar item shows, kept free of Electron so it can be tested.
// The menu is a port of v1's `StatusItemController.menuNeedsUpdate`
// (Sources/DictateApp/StatusItemController.swift): same items, titles, and order, rebuilt each
// time the menu opens. The icon rule is v1's `AppDelegate.render`/`refreshIcon`, and the model
// status lines are v1's `AppDelegate.loadModel` strings, now driven by the engine's `model` events.
import type { EngineEvent } from '../shared/protocol'
import type { HistoryEntry } from './core/history'
import type { PipelineState } from './core/pipeline'

export type TrayIcon = 'idle' | 'listening' | 'working' | 'warning'

export type TrayAction = 'openOnboarding' | 'copyLast' | 'pasteRaw' | 'copyEntry' | 'openSettings' | 'quit'

export type TrayItem =
  | { kind: 'action'; label: string; action: TrayAction; enabled: boolean; accelerator?: string; payload?: string }
  /** A disabled line that only reports something (model status, engine failure). */
  | { kind: 'status'; label: string }
  | { kind: 'separator' }
  | { kind: 'submenu'; label: string; items: TrayItem[] }

export interface TrayState {
  /** The variant's product name, for "Quit <name>". */
  appName: string
  /** Newest first (History.recent()). */
  recent: HistoryEntry[]
  permissionsOK: boolean
  hasKey: boolean
  /** One of the MODEL_* lines, or null once the model is ready. */
  modelStatus: string | null
  /** The engine crashed too often and Engine stopped restarting it. */
  engineFailed: boolean
}

export const MODEL_PREPARING = 'Preparing speech model…'
export const MODEL_FAILED = 'Speech model failed to download — relaunch to retry'
export const ENGINE_FAILED = "Dictate's engine keeps stopping — use Copy diagnostics"
export const HISTORY_LIMIT = 10

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * v1's history row title: the text, cut to 57 characters plus "…" when it's over 60. Counts
 * user-perceived characters (Swift `Character`s), so an emoji or accented letter counts once.
 */
export function historyTitle(text: string): string {
  const chars = Array.from(graphemes.segment(text), (s) => s.segment)
  return chars.length > 60 ? `${chars.slice(0, 57).join('')}…` : text
}

/** The tray status line for an engine `model` event, or null when the model is ready. */
export function modelStatusLine(event: Extract<EngineEvent, { event: 'model' }>): string | null {
  switch (event.state) {
    case 'downloading':
      return `Downloading speech model… ${Math.trunc((event.fraction ?? 0) * 100)}%`
    case 'loading':
      return MODEL_PREPARING
    case 'ready':
      return null
    case 'failed':
      return MODEL_FAILED
  }
}

export function trayMenu(state: TrayState): TrayItem[] {
  const items: TrayItem[] = []
  const recent = state.recent

  if (!state.permissionsOK) {
    items.push({ kind: 'action', label: 'Finish setup (permissions needed)…', action: 'openOnboarding', enabled: true })
    items.push({ kind: 'separator' })
  }
  if (state.engineFailed || state.modelStatus !== null) {
    if (state.engineFailed) items.push({ kind: 'status', label: ENGINE_FAILED })
    if (state.modelStatus !== null) items.push({ kind: 'status', label: state.modelStatus })
    items.push({ kind: 'separator' })
  }

  items.push({ kind: 'action', label: 'Copy last', action: 'copyLast', enabled: recent.length > 0 })
  items.push({
    kind: 'action',
    label: 'Paste raw instead',
    action: 'pasteRaw',
    enabled: recent.length > 0 && recent[0].raw !== recent[0].final
  })

  const history: TrayItem[] = recent.slice(0, HISTORY_LIMIT).map((entry) => ({
    kind: 'action',
    label: historyTitle(entry.final),
    action: 'copyEntry',
    enabled: true,
    payload: entry.final
  }))
  if (recent.length === 0) history.push({ kind: 'status', label: 'Nothing yet' })
  items.push({ kind: 'submenu', label: 'History', items: history })
  items.push({ kind: 'separator' })

  if (!state.hasKey) {
    items.push({ kind: 'action', label: 'Polish off — add OpenRouter key', action: 'openSettings', enabled: true })
  }
  items.push({ kind: 'action', label: 'Settings…', action: 'openSettings', enabled: true, accelerator: 'Command+,' })
  items.push({ kind: 'separator' })
  items.push({ kind: 'action', label: `Quit ${state.appName}`, action: 'quit', enabled: true, accelerator: 'Command+Q' })
  return items
}

/** Where a dictation is, as far as the menu-bar icon cares. */
export type DictationPhase = 'idle' | 'listening' | 'working'

/**
 * v1's `render`: listening and locked show the listening icon, working shows working, idle goes
 * back to the resting icon, and a notice leaves the icon as it was.
 */
export function phaseAfter(state: PipelineState, previous: DictationPhase): DictationPhase {
  switch (state.type) {
    case 'listening':
    case 'locked':
      return 'listening'
    case 'working':
      return 'working'
    case 'idle':
      return 'idle'
    case 'notice':
      return previous
  }
}

/**
 * v1's `refreshIcon`: a dictation in progress always shows; otherwise the warning icon whenever
 * Dictate can't dictate (a permission missing, the model not loaded, or the engine given up on).
 */
export function trayIcon(
  phase: DictationPhase,
  health: { permissionsOK: boolean; modelReady: boolean; engineFailed: boolean }
): TrayIcon {
  if (phase !== 'idle') return phase
  return health.permissionsOK && health.modelReady && !health.engineFailed ? 'idle' : 'warning'
}
