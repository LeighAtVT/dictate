// Task 13: pause v1 while testing the preview, and switch back (spec 2.4). Only fake exec here:
// no real launchctl, pgrep, or osascript ever runs against v1 in a test.
import { describe, expect, it } from 'vitest'
import {
  LAUNCHCTL,
  OSASCRIPT,
  PGREP,
  V1_AGENT_LABEL,
  isDisabled,
  pauseV1,
  switchBackToV1,
  v1Status,
  type Exec
} from './side-by-side'

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

describe('pauseV1', () => {
  it('disables the login agent before booting it out (Review Focus 2), then quits v1 if still running', async () => {
    const { exec, calls } = fakeExec()
    const result = await pauseV1({ exec, uid: UID })
    expect(result).toEqual({ ok: true })
    expect(calls[0]).toBe(`${LAUNCHCTL} disable gui/501/com.leigh.dictate.keepalive`)
    expect(calls[1]).toBe(`${LAUNCHCTL} bootout gui/501/com.leigh.dictate.keepalive`)
    expect(calls[2]).toBe(`${PGREP} -f Dictate\\.app/Contents/MacOS/Dictate$`)
    expect(calls[3]).toMatch(new RegExp(`^${OSASCRIPT} -e `))
    expect(calls[3]).toContain('application id "com.leigh.dictate" is running')
    expect(calls[3]).toContain('tell application id "com.leigh.dictate" to quit')
    expect(calls).toHaveLength(4)
  })

  it("doesn't run osascript when the bootout already stopped v1", async () => {
    const { exec, calls } = fakeExec((file) => ({ code: file === PGREP ? 1 : 0 }))
    await pauseV1({ exec, uid: UID })
    expect(calls.some((c) => c.startsWith(OSASCRIPT))).toBe(false)
  })

  it('stops without booting out when disable fails, so v1 can never come back alone at login', async () => {
    const { exec, calls } = fakeExec((_f, args) => ({ code: args[0] === 'disable' ? 1 : 0 }))
    const result = await pauseV1({ exec, uid: UID })
    expect(result).toEqual({ ok: false, failed: 'disable' })
    expect(calls).toEqual([`${LAUNCHCTL} disable gui/501/com.leigh.dictate.keepalive`])
  })

  it("carries on when bootout reports the agent wasn't loaded", async () => {
    const { exec } = fakeExec((file, args) => ({ code: args[0] === 'bootout' ? 3 : file === PGREP ? 1 : 0 }))
    expect(await pauseV1({ exec, uid: UID })).toEqual({ ok: true })
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
      `${LAUNCHCTL} kickstart gui/501/com.leigh.dictate.keepalive`,
      `${LAUNCHCTL} disable gui/501/${PREVIEW_LABEL}`,
      `${LAUNCHCTL} bootout gui/501/${PREVIEW_LABEL}`
    ])
    expect(quit).toBe(1)
  })

  it('still starts v1 when its agent was already loaded (bootstrap fails, kickstart works)', async () => {
    const { exec } = fakeExec((_f, args) => ({ code: args[0] === 'bootstrap' ? 5 : 0 }))
    let quit = 0
    expect(await switchBackToV1({ exec, uid: UID, home: HOME, previewLabel: PREVIEW_LABEL, quit: () => quit++ })).toEqual({
      ok: true
    })
    expect(quit).toBe(1)
  })

  it("keeps the preview running when v1 can't be started, so there's always one dictation app", async () => {
    for (const step of ['enable', 'kickstart']) {
      const { exec, calls } = fakeExec((_f, args) => ({ code: args[0] === step ? 1 : 0 }))
      let quit = 0
      const result = await switchBackToV1({ exec, uid: UID, home: HOME, previewLabel: PREVIEW_LABEL, quit: () => quit++ })
      expect(result).toEqual({ ok: false, failed: step })
      expect(quit).toBe(0)
      expect(calls.some((c) => c.includes(PREVIEW_LABEL))).toBe(false)
    }
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
