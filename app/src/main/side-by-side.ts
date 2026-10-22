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

/** A launchd plist path. launchd is macOS-only and its paths are POSIX, so join with path.posix. */
export function agentPlistPath(home: string, label: string): string {
  return path.posix.join(home, 'Library', 'LaunchAgents', `${label}.plist`)
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

/**
 * Two cheap commands, run together: `pgrep` and `launchctl print-disabled`. Null when
 * print-disabled fails: the agent's state is unknown, so the caller keeps its last status.
 */
export async function v1Status(deps: {
  exec: Exec
  uid: number
  home: string
  exists: (file: string) => boolean
}): Promise<V1Status | null> {
  const [running, disabled] = await Promise.all([
    isV1Running(deps.exec),
    deps.exec(LAUNCHCTL, ['print-disabled', `gui/${deps.uid}`])
  ])
  if (disabled.code !== 0) return null
  const installed = deps.exists(agentPlistPath(deps.home, V1_AGENT_LABEL))
  return { installed, running, agentEnabled: installed && !isDisabled(disabled.stdout, V1_AGENT_LABEL) }
}

/**
 * Wraps an async probe so only one runs at a time. A call made while one is running queues one
 * more run (however many calls), so a status change right after an action is never missed.
 */
export function serialProbe(run: () => Promise<void>): () => void {
  let running = false
  let again = false
  const probe = (): void => {
    if (running) {
      again = true
      return
    }
    running = true
    run()
      .catch(() => {})
      .finally(() => {
        running = false
        if (again) {
          again = false
          probe()
        }
      })
  }
  return probe
}

export type SwitchResult = { ok: true } | { ok: false; failed: string }

/** Pill notices for a Pause or Switch back that didn't happen (the log has the failed step). */
export const PAUSE_FAILED = "Couldn't pause old Dictate"
export const SWITCH_BACK_FAILED = "Couldn't switch back to old Dictate"

const QUIT_WAIT_MS = 5000
const QUIT_POLL_MS = 250

/**
 * Ruling R31. Disable first, so v1's agent stays off at the next login (Review Focus 2); if that
 * fails nothing else runs, since stopping v1 alone would bring it back at login next to the
 * preview. Then ask v1 to quit, which it does cleanly (no "unexpected stop" in its run journal,
 * and KeepAlive {SuccessfulExit: false} doesn't restart a clean exit), and wait up to 5 s for it
 * to go. Then boot the agent out, whatever happened: that also stops a v1 that didn't quit, or
 * that macOS didn't let Dictate Preview ask (Automation).
 */
export async function pauseV1(deps: {
  exec: Exec
  uid: number
  sleep: (ms: number) => Promise<void>
  now: () => number
}): Promise<SwitchResult> {
  const service = `gui/${deps.uid}/${V1_AGENT_LABEL}`
  if ((await deps.exec(LAUNCHCTL, ['disable', service])).code !== 0) return { ok: false, failed: 'disable' }
  if (await isV1Running(deps.exec)) {
    // Refused (Automation) or failed: nothing will quit v1, so don't wait for it.
    if ((await deps.exec(OSASCRIPT, ['-e', QUIT_V1])).code === 0) {
      const deadline = deps.now() + QUIT_WAIT_MS
      while (deps.now() < deadline && (await isV1Running(deps.exec))) await deps.sleep(QUIT_POLL_MS)
    }
  }
  // Fails harmlessly when the agent isn't loaded (already booted out, or v1 opened by hand).
  await deps.exec(LAUNCHCTL, ['bootout', service])
  return { ok: true }
}

/**
 * Re-enable v1's agent and load it, which starts v1 (RunAtLoad). When the agent was still loaded,
 * bootstrap fails and `kickstart` starts v1 instead. Only once v1 is starting does the preview
 * disable its own agent (if that fails, it stops and says so, rather than quit and come back next
 * to v1 at login), boot it out, and quit, so there's always one dictation app.
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
  const bootstrapped = await deps.exec(LAUNCHCTL, ['bootstrap', domain, agentPlistPath(deps.home, V1_AGENT_LABEL)])
  if (bootstrapped.code !== 0 && (await deps.exec(LAUNCHCTL, ['kickstart', v1])).code !== 0) {
    return { ok: false, failed: 'kickstart' }
  }
  const preview = `${domain}/${deps.previewLabel}`
  if ((await deps.exec(LAUNCHCTL, ['disable', preview])).code !== 0) return { ok: false, failed: 'previewDisable' }
  await deps.exec(LAUNCHCTL, ['bootout', preview])
  deps.quit()
  return { ok: true }
}
