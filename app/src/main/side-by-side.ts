// Dictate v2, Task 13: the preview and v1 side by side (spec 2.4). Only one dictation app should
// listen at a time: "Pause old Dictate while testing" stops v1 and keeps it from starting at login;
// "Switch back to old Dictate" restores v1 and quits the preview. That is the rollback.
//
// The only change this makes to v1 is `launchctl disable`/`enable` of its login agent, plus
// stopping or starting it (global constraints). Every command goes through an injected `exec`, so
// tests never run launchctl, pgrep, or osascript for real.
import { execFile } from 'node:child_process'
import path from 'node:path'

/** Runs a program with arguments (no shell) and never rejects: a failure is a non-zero code. */
export type Exec = (file: string, args: string[]) => Promise<{ code: number; stdout: string }>

export const LAUNCHCTL = '/bin/launchctl'
export const PGREP = '/usr/bin/pgrep'
export const OSASCRIPT = '/usr/bin/osascript'

/** v1's login agent (Sources/DictateCore/LaunchAgent.swift) and bundle ID. */
export const V1_AGENT_LABEL = 'com.leigh.dictate.keepalive'
export const V1_BUNDLE_ID = 'com.leigh.dictate'

/**
 * v1's main executable, for `pgrep -f`. The preview's ("Dictate Preview.app/…/Dictate Preview")
 * and its engine ("…/MacOS/dictate-engine") don't match.
 */
export const V1_PROCESS_PATTERN = 'Dictate\\.app/Contents/MacOS/Dictate$'

/** Quits v1 only if it's running: `tell application` on its own would launch it. */
const QUIT_V1 = `if application id "${V1_BUNDLE_ID}" is running then tell application id "${V1_BUNDLE_ID}" to quit`

/** Production `Exec`: `child_process.execFile`, 10 s limit, stderr ignored. */
export const execFileExec: Exec = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 10_000 }, (error, stdout) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
      resolve({ code, stdout: String(stdout) })
    })
  })

export function agentPlistPath(home: string, label: string): string {
  return path.join(home, 'Library', 'LaunchAgents', `${label}.plist`)
}

/**
 * Whether `launchctl print-disabled` lists `label` as disabled. Recent macOS prints
 * `"label" => disabled`; older releases printed `=> true`.
 */
export function isDisabled(printDisabled: string, label: string): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`"${escaped}" => (disabled|true)\\b`).test(printDisabled)
}

export async function isV1Running(exec: Exec): Promise<boolean> {
  return (await exec(PGREP, ['-f', V1_PROCESS_PATTERN])).code === 0
}

export interface V1Status {
  /** v1's agent plist is in ~/Library/LaunchAgents. */
  installed: boolean
  running: boolean
  /** Installed and not disabled, so it starts at login. */
  agentEnabled: boolean
}

/** Two cheap commands, run together: `pgrep` and `launchctl print-disabled`. */
export async function v1Status(deps: {
  exec: Exec
  uid: number
  home: string
  exists: (file: string) => boolean
}): Promise<V1Status> {
  const [running, disabled] = await Promise.all([
    isV1Running(deps.exec),
    deps.exec(LAUNCHCTL, ['print-disabled', `gui/${deps.uid}`])
  ])
  const installed = deps.exists(agentPlistPath(deps.home, V1_AGENT_LABEL))
  return { installed, running, agentEnabled: installed && !isDisabled(disabled.stdout, V1_AGENT_LABEL) }
}

export type SwitchResult = { ok: true } | { ok: false; failed: string }

/**
 * Disable first, so v1's agent stays off at the next login, then boot it out, which stops v1
 * now (Review Focus 2). A v1 started some other way (not by its agent) is asked to quit. If
 * disable fails nothing else runs: booting out alone would bring v1 back at login, next to the
 * preview.
 */
export async function pauseV1(deps: { exec: Exec; uid: number }): Promise<SwitchResult> {
  const service = `gui/${deps.uid}/${V1_AGENT_LABEL}`
  if ((await deps.exec(LAUNCHCTL, ['disable', service])).code !== 0) return { ok: false, failed: 'disable' }
  // Fails harmlessly when the agent isn't loaded (already booted out, or v1 opened by hand).
  await deps.exec(LAUNCHCTL, ['bootout', service])
  if (await isV1Running(deps.exec)) await deps.exec(OSASCRIPT, ['-e', QUIT_V1])
  return { ok: true }
}

/**
 * Re-enable v1's agent and load it, which starts v1 (RunAtLoad); `kickstart` starts it when the
 * agent was still loaded and so bootstrap had nothing to do. Only once v1 is starting does the
 * preview disable and boot out its own agent and quit, so there's always one dictation app.
 * Booting out the preview's own agent stops this process when the agent started it (launchd
 * sends SIGTERM), so it comes last; `quit` covers a preview that was opened some other way.
 * Either way the agent is gone, so nothing restarts the preview.
 */
export async function switchBackToV1(deps: {
  exec: Exec
  uid: number
  home: string
  previewLabel: string
  quit: () => void
}): Promise<SwitchResult> {
  const domain = `gui/${deps.uid}`
  const v1 = `${domain}/${V1_AGENT_LABEL}`
  if ((await deps.exec(LAUNCHCTL, ['enable', v1])).code !== 0) return { ok: false, failed: 'enable' }
  // Fails when the agent is already loaded; kickstart covers that.
  await deps.exec(LAUNCHCTL, ['bootstrap', domain, agentPlistPath(deps.home, V1_AGENT_LABEL)])
  if ((await deps.exec(LAUNCHCTL, ['kickstart', v1])).code !== 0) return { ok: false, failed: 'kickstart' }
  const preview = `${domain}/${deps.previewLabel}`
  await deps.exec(LAUNCHCTL, ['disable', preview])
  await deps.exec(LAUNCHCTL, ['bootout', preview])
  deps.quit()
  return { ok: true }
}
