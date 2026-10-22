// Dictate v2, Task 13: the login agent. A port of Sources/DictateCore/LaunchAgent.swift (the plist
// and `canInstall`) and of Sources/DictateApp/main.swift's `handOffToAgentIfNeeded`, with the
// variant's own label (variant.agentLabel), so the preview never touches v1's agent here.
//
// The app should always run under its LaunchAgent, which starts it at login and restarts it
// after any exit other than Quit. A copy opened from Finder or Spotlight hands over to the agent
// and exits, but only once the agent's copy is confirmed running; otherwise it keeps running
// itself. Electron's single-instance lock stands in for v1's NSRunningApplication check.
import { build } from 'plist'
import { LAUNCHCTL, agentPlistPath, type Exec } from './side-by-side'

/** v1's plist, keys and values, with the label and executable path given. Byte-stable per input. */
export function agentPlistData(label: string, executable: string): string {
  return build({
    Label: label,
    Program: executable,
    RunAtLoad: true,
    KeepAlive: { SuccessfulExit: false },
    ProcessType: 'Interactive',
    ThrottleInterval: 5,
    LimitLoadToSessionType: 'Aqua'
  })
}

/**
 * A copy macOS is running from a temporary quarantine location would go stale, so don't point
 * the agent at it. Only an installed app bundle qualifies: not a bare dev build, and not a
 * quarantine copy.
 */
export function canInstall(executable: string): boolean {
  return executable.includes('.app/Contents/MacOS/') && !executable.includes('/AppTranslocation/')
}

export interface HandOffDeps {
  /** variant.agentLabel. */
  label: string
  /** app.isPackaged: a dev run never installs an agent. */
  isPackaged: boolean
  /** process.execPath. */
  executable: string
  env: Record<string, string | undefined>
  home: string
  uid: number
  exec: Exec
  /** app.requestSingleInstanceLock / app.releaseSingleInstanceLock. */
  requestLock: () => boolean
  releaseLock: () => void
  /** The file's text, or null when it can't be read. */
  readFile: (file: string) => string | null
  /** Writes the file, creating its folder; throws on failure. */
  writeFile: (file: string, data: string) => void
  sleep: (ms: number) => Promise<void>
  now: () => number
  log: (message: string) => void
}

/** `run`: carry on starting the app. `quit`: another copy is (or will be) the one running. */
export type HandOffResult = 'run' | 'quit'

const WAIT_MS = 3000

/** v1's `Instance.isAgentLaunch`: launchd started this copy from the login agent `label`. */
export function isAgentLaunch(env: Record<string, string | undefined>, label: string): boolean {
  return env['XPC_SERVICE_NAME'] === label
}

export async function handOff(deps: HandOffDeps): Promise<HandOffResult> {
  if (isAgentLaunch(deps.env, deps.label)) {
    // The copy that handed off may still be exiting; give it a moment before deciding we're a duplicate.
    const deadline = deps.now() + WAIT_MS
    while (!deps.requestLock()) {
      if (deps.now() >= deadline) return 'quit'
      await deps.sleep(100)
    }
    return 'run'
  }

  // A second copy opened by hand: the running one gets 'second-instance' and shows its window.
  if (!deps.requestLock()) return 'quit'

  if (!deps.isPackaged || !canInstall(deps.executable)) {
    deps.log('handoff: not an installed app bundle; running without auto-restart')
    return 'run'
  }
  // Not in v1: scripts/e2e-mac.sh launches with DICTATE_TEST_AUDIO, which the agent's copy
  // wouldn't inherit, so a test launch stays the running copy.
  if (deps.env['DICTATE_TEST_AUDIO']) {
    deps.log('handoff: test launch; running without auto-restart')
    return 'run'
  }
  const data = agentPlistData(deps.label, deps.executable)
  const file = agentPlistPath(deps.home, deps.label)
  const domain = `gui/${deps.uid}`
  const service = `${domain}/${deps.label}`
  if (deps.readFile(file) !== data) {
    await deps.exec(LAUNCHCTL, ['bootout', service])
    try {
      deps.writeFile(file, data)
    } catch (error) {
      deps.log(`handoff: couldn't write LaunchAgent: ${error instanceof Error ? error.message : String(error)}`)
      return 'run'
    }
  }
  // Not in v1: "Switch back to old Dictate" disables this agent. Opening the app again by hand
  // means it should run under its agent again, and a disabled agent can't be bootstrapped.
  await deps.exec(LAUNCHCTL, ['enable', service])
  if ((await deps.exec(LAUNCHCTL, ['print', service])).code !== 0) {
    await deps.exec(LAUNCHCTL, ['bootstrap', domain, file])
  }
  // The agent's copy needs the lock, so let go of it before starting that copy.
  deps.releaseLock()
  await deps.exec(LAUNCHCTL, ['kickstart', service])
  if (await waitForAgent(deps, service)) return 'quit'
  // The agent's copy may have taken the lock anyway; then it's the one running.
  if (!deps.requestLock()) return 'quit'
  deps.log('handoff: agent did not start; running without auto-restart')
  return 'run'
}

/** Waits up to 3 s for the LaunchAgent's copy to be running. */
async function waitForAgent(deps: HandOffDeps, service: string): Promise<boolean> {
  const deadline = deps.now() + WAIT_MS
  while (deps.now() < deadline) {
    const out = await deps.exec(LAUNCHCTL, ['print', service])
    if (out.code === 0 && out.stdout.includes('\n\tstate = running')) return true
    await deps.sleep(200)
  }
  return false
}
