// Task 13: the login agent. A port of Tests/DictateCoreTests/LaunchAgentTests.swift (the plist and
// canInstall tests; the CachedSecret tests stay in Swift, where CachedSecret still lives and the
// engine uses it) plus handOff, a port of main.swift's handOffToAgentIfNeeded. Fake exec only.
import { parse } from 'plist'
import { describe, expect, it } from 'vitest'
import { LAUNCHCTL, type Exec } from './side-by-side'
import { agentPlistData, canInstall, handOff, type HandOffDeps } from './startup'

const V1_LABEL = 'com.leigh.dictate.keepalive'
const LABEL = 'com.leigh.dictate.preview.keepalive'
const EXE = '/Applications/Dictate Preview.app/Contents/MacOS/Dictate Preview'
const PLIST = '/Users/test/Library/LaunchAgents/com.leigh.dictate.preview.keepalive.plist'
const SERVICE = `gui/501/${LABEL}`

describe('LaunchAgent (port of LaunchAgentTests)', () => {
  // @Test plistRestartsOnlyAfterUnexpectedExits
  it('restarts only after unexpected exits', () => {
    const data = agentPlistData(V1_LABEL, '/Applications/Dictate.app/Contents/MacOS/Dictate')
    const plist = parse(data) as Record<string, unknown>
    expect(plist['Label']).toBe('com.leigh.dictate.keepalive')
    expect(plist['Program']).toBe('/Applications/Dictate.app/Contents/MacOS/Dictate')
    expect(plist['RunAtLoad']).toBe(true)
    expect((plist['KeepAlive'] as Record<string, boolean>)['SuccessfulExit']).toBe(false)
    expect(plist['ProcessType']).toBe('Interactive')
    expect(plist['ThrottleInterval']).toBe(5)
    expect(data).toContain('<integer>5</integer>') // an integer, as v1 writes it, not a real
    expect(plist['LimitLoadToSessionType']).toBe('Aqua')
  })

  it("has exactly v1's keys, with the preview's label and path swapped in", () => {
    const plist = parse(agentPlistData(LABEL, EXE)) as Record<string, unknown>
    expect(Object.keys(plist).sort()).toEqual(
      ['KeepAlive', 'Label', 'LimitLoadToSessionType', 'ProcessType', 'Program', 'RunAtLoad', 'ThrottleInterval'].sort()
    )
    expect(plist['Label']).toBe(LABEL)
    expect(plist['Program']).toBe(EXE)
  })

  // @Test plistIsStableForTheSamePath
  it('is stable for the same path', () => {
    expect(agentPlistData(LABEL, '/a')).toBe(agentPlistData(LABEL, '/a'))
    expect(agentPlistData(LABEL, '/a')).not.toBe(agentPlistData(LABEL, '/b'))
  })

  // @Test translocatedCopiesAreNotInstalled
  it("doesn't install translocated copies or bare dev builds", () => {
    expect(canInstall('/Applications/Dictate.app/Contents/MacOS/Dictate')).toBe(true)
    expect(canInstall('/private/var/folders/x/AppTranslocation/ABC/d/Dictate.app/Contents/MacOS/Dictate')).toBe(false)
    expect(canInstall('/Users/me/repos/dictate/.build/debug/Dictate')).toBe(false) // bare dev build
    expect(canInstall(EXE)).toBe(true) // the preview's own path, with a space in it
  })
})

interface Harness {
  deps: HandOffDeps
  calls: string[]
  /** Lock calls in order: 'request:true', 'request:false', 'release'. */
  lock: string[]
  logs: string[]
  files: Map<string, string>
  clock: { now: number }
}

function harness(opts: {
  env?: Record<string, string | undefined>
  isPackaged?: boolean
  executable?: string
  /** Successive results of requestLock(). The last one repeats. */
  locks?: boolean[]
  exec?: (args: string[]) => { code: number; stdout?: string }
  writeFails?: boolean
}): Harness {
  const calls: string[] = []
  const lock: string[] = []
  const logs: string[] = []
  const files = new Map<string, string>()
  const clock = { now: 0 }
  const locks = [...(opts.locks ?? [true])]
  const exec: Exec = async (file, args) => {
    calls.push([file, ...args].join(' '))
    const r = opts.exec?.(args) ?? { code: 0, stdout: '' }
    return { code: r.code, stdout: r.stdout ?? '' }
  }
  const deps: HandOffDeps = {
    label: LABEL,
    isPackaged: opts.isPackaged ?? true,
    executable: opts.executable ?? EXE,
    env: opts.env ?? {},
    home: '/Users/test',
    uid: 501,
    exec,
    requestLock: () => {
      const got = locks.length > 1 ? locks.shift()! : locks[0]
      lock.push(`request:${got}`)
      return got
    },
    releaseLock: () => {
      lock.push('release')
    },
    readFile: (p) => files.get(p) ?? null,
    writeFile: (p, data) => {
      if (opts.writeFails) throw new Error('EACCES')
      files.set(p, data)
    },
    sleep: async (ms) => {
      clock.now += ms
    },
    now: () => clock.now,
    log: (m) => {
      logs.push(m)
    }
  }
  return { deps, calls, lock, logs, files, clock }
}

const running = (args: string[]): { code: number; stdout?: string } =>
  args[0] === 'print' ? { code: 0, stdout: `${SERVICE} = {\n\tactive count = 1\n\tstate = running\n}` } : { code: 0 }

describe('handOff (port of handOffToAgentIfNeeded)', () => {
  it('writes the agent, bootstraps it, releases the lock before kickstart, and quits once the agent runs', async () => {
    let printed = 0
    const h = harness({
      exec: (args) => {
        if (args[0] !== 'print') return { code: 0 }
        printed++
        return printed === 1 ? { code: 113 } : running(args) // not loaded yet, then running
      }
    })
    expect(await handOff(h.deps)).toBe('quit')
    expect(h.files.get(PLIST)).toBe(agentPlistData(LABEL, EXE))
    expect(h.calls).toEqual([
      `${LAUNCHCTL} bootout ${SERVICE}`,
      `${LAUNCHCTL} enable ${SERVICE}`,
      `${LAUNCHCTL} print ${SERVICE}`,
      `${LAUNCHCTL} bootstrap gui/501 ${PLIST}`,
      `${LAUNCHCTL} kickstart ${SERVICE}`,
      `${LAUNCHCTL} print ${SERVICE}`
    ])
    expect(h.lock).toEqual(['request:true', 'release'])
  })

  it("doesn't rewrite or reboot an agent that's already current and loaded", async () => {
    const h = harness({ exec: running })
    h.files.set(PLIST, agentPlistData(LABEL, EXE))
    expect(await handOff(h.deps)).toBe('quit')
    expect(h.calls).toEqual([
      `${LAUNCHCTL} enable ${SERVICE}`,
      `${LAUNCHCTL} print ${SERVICE}`,
      `${LAUNCHCTL} kickstart ${SERVICE}`,
      `${LAUNCHCTL} print ${SERVICE}`
    ])
  })

  it('keeps running, with the lock back, when the agent never starts (waits 3 s)', async () => {
    const h = harness({ exec: (args) => (args[0] === 'print' ? { code: 0, stdout: 'state = waiting' } : { code: 0 }) })
    expect(await handOff(h.deps)).toBe('run')
    expect(h.lock).toEqual(['request:true', 'release', 'request:true'])
    expect(h.clock.now).toBeGreaterThanOrEqual(3000)
    expect(h.logs).toContain('handoff: agent did not start; running without auto-restart')
  })

  it("quits when the agent's copy took the lock even though print never showed it running", async () => {
    const h = harness({ locks: [true, false], exec: () => ({ code: 0, stdout: '' }) })
    expect(await handOff(h.deps)).toBe('quit')
  })

  it('a second copy opened by hand quits at once (the first gets second-instance)', async () => {
    const h = harness({ locks: [false] })
    expect(await handOff(h.deps)).toBe('quit')
    expect(h.calls).toEqual([])
  })

  it('runs without the agent when not packaged or not an installed .app', async () => {
    for (const h of [
      harness({ isPackaged: false }),
      harness({ executable: '/private/var/folders/x/AppTranslocation/ABC/d/Dictate Preview.app/Contents/MacOS/Dictate Preview' })
    ]) {
      expect(await handOff(h.deps)).toBe('run')
      expect(h.calls).toEqual([])
      expect(h.lock).toEqual(['request:true'])
      expect(h.logs).toEqual(['handoff: not an installed app bundle; running without auto-restart'])
    }
  })

  it('runs without the agent for an end-to-end test launch (DICTATE_TEST_AUDIO)', async () => {
    const h = harness({ env: { DICTATE_TEST_AUDIO: '/tmp/hello.wav' } })
    expect(await handOff(h.deps)).toBe('run')
    expect(h.calls).toEqual([])
    expect(h.logs).toEqual(['handoff: test launch; running without auto-restart'])
  })

  it("runs without the agent when its plist can't be written", async () => {
    const h = harness({ writeFails: true })
    expect(await handOff(h.deps)).toBe('run')
    expect(h.calls).toEqual([`${LAUNCHCTL} bootout ${SERVICE}`])
    expect(h.logs[0]).toMatch(/^handoff: couldn't write LaunchAgent: /)
  })

  describe('a launch by the agent (XPC_SERVICE_NAME is the label)', () => {
    const env = { XPC_SERVICE_NAME: LABEL }

    it('runs straight away when it gets the lock, touching nothing', async () => {
      const h = harness({ env })
      expect(await handOff(h.deps)).toBe('run')
      expect(h.calls).toEqual([])
      expect(h.files.size).toBe(0)
    })

    it('retries the lock every 100 ms while the copy that handed off is still exiting', async () => {
      const h = harness({ env, locks: [false, false, false, true] })
      expect(await handOff(h.deps)).toBe('run')
      expect(h.lock).toEqual(['request:false', 'request:false', 'request:false', 'request:true'])
      expect(h.clock.now).toBe(300)
    })

    it('quits as a duplicate after 3 s without the lock', async () => {
      const h = harness({ env, locks: [false] })
      expect(await handOff(h.deps)).toBe('quit')
      expect(h.clock.now).toBe(3000)
      expect(h.lock.length).toBe(31) // at 0, 100, …, 3000 ms
    })

    it("treats v1's label as not ours", async () => {
      const h = harness({ env: { XPC_SERVICE_NAME: V1_LABEL }, isPackaged: false })
      expect(await handOff(h.deps)).toBe('run')
      expect(h.logs).toEqual(['handoff: not an installed app bundle; running without auto-restart'])
    })
  })
})
