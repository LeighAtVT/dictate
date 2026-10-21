// Task 13: pause v1 while testing the preview, and switch back (spec 2.4). Only fake exec here:
// no real launchctl, pgrep, or osascript ever runs against v1 in a test.
import { describe, expect, it } from 'vitest'
import {
  LAUNCHCTL,
  OSASCRIPT,
  PGREP,
  PAUSE_FAILED,
  SWITCH_BACK_FAILED,
  V1_AGENT_LABEL,
  isDisabled,
  pauseV1,
  serialProbe,
  switchBackToV1,
  v1Status,
  type Exec
} from './side-by-side'
import { waitUntil } from './core/pipelineFakes'

const UID = 501
const HOME = '/Users/test'
const V1_PLIST = '/Users/test/Library/LaunchAgents/com.leigh.dictate.keepalive.plist'
const PREVIEW_LABEL = 'com.leigh.dictate.preview.keepalive'

/** Records every call; `reply` decides each exit code and output. */
function fakeExec(reply: (file: string, args: string[]) => { code: number; stdout?: string } = () => ({ code: 0 })) {
  const calls: string[] = []
  const exec: Exec = async (file, args) => {
    calls.push([file, ...args].join(' '))
    const r = reply(file, args)
    return { code: r.code, stdout: r.stdout ?? '' }
  }
  return { exec, calls }
}

/** A clock the fake sleep moves forward. */
function clock() {
  const c = { now: 0 }
  return {
    c,
    sleep: async (ms: number) => {
      c.now += ms
    },
    now: () => c.now
  }
}

const DISABLE = `${LAUNCHCTL} disable gui/501/com.leigh.dictate.keepalive`
const BOOTOUT = `${LAUNCHCTL} bootout gui/501/com.leigh.dictate.keepalive`
const PGREP_V1 = `${PGREP} -f Dictate\\.app/Contents/MacOS/Dictate$`

describe('pauseV1 (Ruling R31: quit v1 cleanly, then boot out)', () => {
  it('disables first (Review Focus 2), quits v1, waits for it to exit, then boots out', async () => {
    let pgreps = 0
    const { exec, calls } = fakeExec((file) => (file === PGREP ? { code: ++pgreps <= 2 ? 0 : 1 } : { code: 0 }))
    const t = clock()
    const result = await pauseV1({ exec, uid: UID, sleep: t.sleep, now: t.now })
    expect(result).toEqual({ ok: true })
    expect(calls[0]).toBe(DISABLE)
    expect(calls[1]).toBe(PGREP_V1)
    expect(calls[2]).toMatch(new RegExp(`^${OSASCRIPT} -e `))
    expect(calls[2]).toContain('application id "com.leigh.dictate" is running')
    expect(calls[2]).toContain('tell application id "com.leigh.dictate" to quit')
    // Still running once, then gone.
    expect(calls.slice(3)).toEqual([PGREP_V1, PGREP_V1, BOOTOUT])
    expect(t.c.now).toBe(250)
  })

  it('boots out anyway after 5 s if v1 never exits', async () => {
    const { exec, calls } = fakeExec(() => ({ code: 0 })) // pgrep always finds v1
    const t = clock()
    expect(await pauseV1({ exec, uid: UID, sleep: t.sleep, now: t.now })).toEqual({ ok: true })
    expect(t.c.now).toBe(5000)
    expect(calls.at(-1)).toBe(BOOTOUT)
  })

  it('boots out anyway when osascript fails or is refused', async () => {
    const { exec, calls } = fakeExec((file) => ({ code: file === OSASCRIPT ? 1 : 0 }))
    const t = clock()
    expect(await pauseV1({ exec, uid: UID, sleep: t.sleep, now: t.now })).toEqual({ ok: true })
    expect(calls.at(-1)).toBe(BOOTOUT)
  })

  it("doesn't run osascript or wait when v1 isn't running", async () => {
    const { exec, calls } = fakeExec((file) => ({ code: file === PGREP ? 1 : 0 }))
    const t = clock()
    expect(await pauseV1({ exec, uid: UID, sleep: t.sleep, now: t.now })).toEqual({ ok: true })
    expect(calls).toEqual([DISABLE, PGREP_V1, BOOTOUT])
    expect(t.c.now).toBe(0)
  })

  it('stops when disable fails, so v1 can never come back alone at login', async () => {
    const { exec, calls } = fakeExec((_f, args) => ({ code: args[0] === 'disable' ? 1 : 0 }))
    const t = clock()
    expect(await pauseV1({ exec, uid: UID, sleep: t.sleep, now: t.now })).toEqual({ ok: false, failed: 'disable' })
    expect(calls).toEqual([DISABLE])
  })

  it("carries on when bootout reports the agent wasn't loaded", async () => {
    const { exec } = fakeExec((file, args) => ({ code: args[0] === 'bootout' ? 3 : file === PGREP ? 1 : 0 }))
    const t = clock()
    expect(await pauseV1({ exec, uid: UID, sleep: t.sleep, now: t.now })).toEqual({ ok: true })
  })
})

describe('switchBackToV1', () => {
  it("enables and bootstraps v1's agent, then disables and boots out the preview's, then quits", async () => {
    const { exec, calls } = fakeExec()
    let quit = 0
    const result = await switchBackToV1({ exec, uid: UID, home: HOME, previewLabel: PREVIEW_LABEL, quit: () => quit++ })
    expect(result).toEqual({ ok: true })
    expect(calls).toEqual([
      `${LAUNCHCTL} enable gui/501/com.leigh.dictate.keepalive`,
      `${LAUNCHCTL} bootstrap gui/501 ${V1_PLIST}`,
      `${LAUNCHCTL} disable gui/501/${PREVIEW_LABEL}`,
      `${LAUNCHCTL} bootout gui/501/${PREVIEW_LABEL}`
    ])
    expect(quit).toBe(1)
  })

  it('kickstarts v1 only when bootstrap failed (its agent was still loaded)', async () => {
    const { exec, calls } = fakeExec((_f, args) => ({ code: args[0] === 'bootstrap' ? 5 : 0 }))
    let quit = 0
    expect(await switchBackToV1({ exec, uid: UID, home: HOME, previewLabel: PREVIEW_LABEL, quit: () => quit++ })).toEqual({
      ok: true
    })
    expect(calls[2]).toBe(`${LAUNCHCTL} kickstart gui/501/com.leigh.dictate.keepalive`)
    expect(quit).toBe(1)
  })

  it("keeps the preview running when v1 can't be started, so there's always one dictation app", async () => {
    const cases: [(args: string[]) => boolean, string][] = [
      [(args) => args[0] === 'enable', 'enable'],
      [(args) => args[0] === 'bootstrap' || args[0] === 'kickstart', 'kickstart']
    ]
    for (const [fails, step] of cases) {
      const { exec, calls } = fakeExec((_f, args) => ({ code: fails(args) ? 1 : 0 }))
      let quit = 0
      const result = await switchBackToV1({ exec, uid: UID, home: HOME, previewLabel: PREVIEW_LABEL, quit: () => quit++ })
      expect(result).toEqual({ ok: false, failed: step })
      expect(quit).toBe(0)
      expect(calls.some((c) => c.includes(PREVIEW_LABEL))).toBe(false)
    }
  })

  it("reports a failed disable of the preview's agent and doesn't quit, so the user is told", async () => {
    const { exec, calls } = fakeExec((_f, args) => ({ code: args[0] === 'disable' ? 1 : 0 }))
    let quit = 0
    const result = await switchBackToV1({ exec, uid: UID, home: HOME, previewLabel: PREVIEW_LABEL, quit: () => quit++ })
    expect(result).toEqual({ ok: false, failed: 'previewDisable' })
    expect(quit).toBe(0)
    expect(calls.at(-1)).toBe(`${LAUNCHCTL} disable gui/501/${PREVIEW_LABEL}`)
  })
})

describe('notices for a failed switch', () => {
  it('names what failed', () => {
    expect(PAUSE_FAILED).toBe("Couldn't pause old Dictate")
    expect(SWITCH_BACK_FAILED).toBe("Couldn't switch back to old Dictate")
  })
})

describe('serialProbe', () => {
  it('runs one probe at a time and queues one more for calls made meanwhile', async () => {
    let runs = 0
    let release!: () => void
    const probe = serialProbe(async () => {
      runs++
      if (runs === 1) await new Promise<void>((r) => (release = r))
    })
    probe()
    probe()
    probe() // still only one queued
    expect(runs).toBe(1)
    release()
    await waitUntil(() => runs === 2)
    await Promise.resolve()
    expect(runs).toBe(2)
    probe()
    await waitUntil(() => runs === 3)
  })

  it('keeps going after a probe throws', async () => {
    let runs = 0
    const probe = serialProbe(async () => {
      runs++
      throw new Error('pgrep missing')
    })
    probe()
    await waitUntil(() => runs === 1)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    probe()
    await waitUntil(() => runs === 2)
  })
})

describe('v1Status', () => {
  const printDisabled = (state: string): string =>
    `disabled services = {\n\t"com.leigh.dictate.agent" => enabled\n\t"${V1_AGENT_LABEL}" => ${state}\n}\n`

  it('reports v1 running and its agent enabled', async () => {
    const { exec, calls } = fakeExec((file) => ({ code: 0, stdout: file === LAUNCHCTL ? printDisabled('enabled') : '123\n' }))
    expect(await v1Status({ exec, uid: UID, home: HOME, exists: () => true })).toEqual({
      installed: true,
      running: true,
      agentEnabled: true
    })
    expect(calls.sort()).toEqual([`${LAUNCHCTL} print-disabled gui/501`, `${PGREP} -f Dictate\\.app/Contents/MacOS/Dictate$`].sort())
  })

  it('reports a paused v1: not running, agent disabled', async () => {
    const { exec } = fakeExec((file) =>
      file === LAUNCHCTL ? { code: 0, stdout: printDisabled('disabled') } : { code: 1 }
    )
    expect(await v1Status({ exec, uid: UID, home: HOME, exists: () => true })).toEqual({
      installed: true,
      running: false,
      agentEnabled: false
    })
  })

  it("reports nothing (keep the last status) when print-disabled fails, since the agent's state is unknown", async () => {
    const { exec } = fakeExec((file) => ({ code: file === LAUNCHCTL ? 1 : 0 }))
    expect(await v1Status({ exec, uid: UID, home: HOME, exists: () => true })).toBeNull()
  })

  it('counts an agent with no plist as not enabled (v1 not installed)', async () => {
    const { exec } = fakeExec((file) => (file === LAUNCHCTL ? { code: 0, stdout: '' } : { code: 1 }))
    const seen: string[] = []
    const status = await v1Status({
      exec,
      uid: UID,
      home: HOME,
      exists: (p) => {
        seen.push(p)
        return false
      }
    })
    expect(status).toEqual({ installed: false, running: false, agentEnabled: false })
    expect(seen).toEqual([V1_PLIST])
  })

  it('reads both print-disabled formats (=> disabled, and the older => true)', () => {
    expect(isDisabled(`\t"${V1_AGENT_LABEL}" => disabled\n`, V1_AGENT_LABEL)).toBe(true)
    expect(isDisabled(`\t"${V1_AGENT_LABEL}" => true\n`, V1_AGENT_LABEL)).toBe(true)
    expect(isDisabled(`\t"${V1_AGENT_LABEL}" => enabled\n`, V1_AGENT_LABEL)).toBe(false)
    expect(isDisabled(`\t"${V1_AGENT_LABEL}" => false\n`, V1_AGENT_LABEL)).toBe(false)
    expect(isDisabled('', V1_AGENT_LABEL)).toBe(false)
    // A longer label that starts the same doesn't count.
    expect(isDisabled(`\t"${V1_AGENT_LABEL}.other" => disabled\n`, V1_AGENT_LABEL)).toBe(false)
  })
})
