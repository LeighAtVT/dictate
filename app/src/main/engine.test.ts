// Tests for Task 9 (dictate v2 plan 1): the Electron brain's Engine client.
// Spawns the scriptable fake engine (app/test/fake-engine.mjs) under Node
// (process.execPath) instead of the real Swift binary, and drives it with
// the FAKE_SCRIPT env var -- see that file's header comment for the
// ';'-separated behavior grammar (echo, crash-on:<op>, hang-on:<op>,
// emit:<raw>).
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Engine, EngineGone, EngineTimeout } from './engine'
import type { EngineEvent } from '../shared/protocol'

const fakeEnginePath = fileURLToPath(new URL('../../test/fake-engine.mjs', import.meta.url))

let engines: Engine[] = []
const originalFakeScript = process.env.FAKE_SCRIPT

function makeEngine(script: string, restartDelayMs = 50): Engine {
  process.env.FAKE_SCRIPT = script
  const engine = new Engine({
    command: process.execPath,
    args: [fakeEnginePath],
    restartDelayMs
  })
  engines.push(engine)
  return engine
}

function waitForEvent<T>(target: { once(event: string, fn: (arg: T) => void): unknown }, event: string): Promise<T> {
  return new Promise((resolve) => target.once(event, resolve))
}

/**
 * Queues every occurrence of `event` from the moment this is called (not
 * from the moment the returned getter is first awaited), so an event fired
 * synchronously inside a call like `start()` isn't missed by a listener
 * that would otherwise be registered too late.
 */
function eventQueue<T>(target: { on(event: string, fn: (arg: T) => void): unknown }, event: string): () => Promise<T> {
  const queued: T[] = []
  const waiters: Array<(value: T) => void> = []
  target.on(event, (arg: T) => {
    const waiter = waiters.shift()
    if (waiter) waiter(arg)
    else queued.push(arg)
  })
  return () =>
    new Promise<T>((resolve) => {
      if (queued.length > 0) resolve(queued.shift() as T)
      else waiters.push(resolve)
    })
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(engines.map((e) => e.stop()))
  engines = []
  if (originalFakeScript === undefined) delete process.env.FAKE_SCRIPT
  else process.env.FAKE_SCRIPT = originalFakeScript
})

describe('Engine', () => {
  it('round-trips a request', async () => {
    const engine = makeEngine('echo')
    engine.start()
    const reply = await engine.request({ op: 'startRecording' })
    expect(reply).toEqual({})
  })

  it('resolves two concurrent requests out of order by id', async () => {
    const engine = makeEngine('echo')
    engine.start()

    const order: string[] = []
    const selectionPromise = engine.request({ op: 'selection' }).then((r) => {
      order.push('selection')
      return r
    })
    const contextPromise = engine.request({ op: 'context' }).then((r) => {
      order.push('context')
      return r
    })

    const [selectionReply, contextReply] = await Promise.all([selectionPromise, contextPromise])

    expect(order).toEqual(['context', 'selection'])
    expect(selectionReply).toEqual({ text: null })
    expect(contextReply).toEqual({
      appId: 'test.app',
      windowTitle: null,
      secureInput: false,
      elevated: false
    })
  })

  it('crash-on:stopRecording rejects the pending request with EngineGone, then restarts and replays setHotkey', async () => {
    const engine = makeEngine('echo;crash-on:stopRecording', 50)
    const events: EngineEvent[] = []
    engine.on('event', (e) => events.push(e))
    engine.start()

    await engine.request({ op: 'setHotkey', key: 'fn' })

    const pending = engine.request({ op: 'stopRecording', language: 'en', vocabulary: [] })
    await expect(pending).rejects.toBeInstanceOf(EngineGone)

    const upAt = Date.now()
    await waitForEvent(engine, 'up')
    expect(Date.now() - upAt).toBeLessThan(1500)

    // Give the replayed setHotkey request a moment to be received and logged.
    await new Promise((r) => setTimeout(r, 200))

    const replayedHotkey = events.some((e) => e.event === 'log' && e.message === 'recv:setHotkey')
    expect(replayedHotkey).toBe(true)
  })

  it('gives up after 5 exits within 60s: emits failed and stops restarting', async () => {
    const engine = makeEngine('echo;crash-on:stopRecording', 10)
    let ups = 0
    let downs = 0
    engine.on('up', () => ups++)
    engine.on('down', () => downs++)

    // Register the 'up' queue before start() -- start() emits 'up'
    // synchronously, so a `.once()` registered afterwards would miss it.
    const nextUp = eventQueue<void>(engine, 'up')
    const failed = waitForEvent(engine, 'failed')
    engine.start()

    for (let i = 0; i < 5; i++) {
      await nextUp()
      const rejection = engine.request({ op: 'stopRecording', language: 'en', vocabulary: [] })
      await expect(rejection).rejects.toBeInstanceOf(EngineGone)
    }

    await failed
    expect(downs).toBe(5)

    const upsAtFailure = ups
    await new Promise((r) => setTimeout(r, 150))
    expect(ups).toBe(upsAtFailure)
  })

  it('hang-on:paste times out with EngineTimeout after 5s (fake timers)', async () => {
    const engine = makeEngine('echo;hang-on:paste', 50)
    engine.start()
    // Let the real process actually spawn before switching to fake timers,
    // so the stdin write for the request still goes out over a real pipe.
    await new Promise((r) => setTimeout(r, 100))

    vi.useFakeTimers()
    const pending = engine.request({ op: 'paste', text: 'hello' })
    const assertion = expect(pending).rejects.toBeInstanceOf(EngineTimeout)
    await vi.advanceTimersByTimeAsync(5000)
    await assertion
    vi.useRealTimers()
  })

  it('ignores a malformed stdout line and still delivers the next event', async () => {
    const engine = makeEngine('emit:not valid json at all;emit:{"event":"escape"}')
    const events: EngineEvent[] = []
    engine.on('event', (e) => events.push(e))
    engine.start()

    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (events.some((e) => e.event === 'escape')) resolve()
        else setTimeout(check, 10)
      }
      check()
    })

    expect(events).toEqual([{ event: 'escape' }])
  })

  it('forwards a stderr line (split across two writes) as an event log', async () => {
    const engine = makeEngine('stderr:boom, something went wrong')
    const events: EngineEvent[] = []
    engine.on('event', (e) => events.push(e))
    engine.start()

    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (events.some((e) => e.event === 'log')) resolve()
        else setTimeout(check, 10)
      }
      check()
    })

    expect(events).toEqual([{ event: 'log', message: 'boom, something went wrong' }])
  })

  it("logs why the engine couldn't start, then reports it down", async () => {
    const engine = new Engine({ command: '/nonexistent/dictate-engine', args: [], restartDelayMs: 60_000 })
    engines.push(engine)
    const events: EngineEvent[] = []
    engine.on('event', (e) => events.push(e))
    let downs = 0
    engine.on('down', () => downs++)
    const down = waitForEvent(engine, 'down')
    engine.start()
    await down
    // Let any late 'error'/'exit' from the failed spawn arrive before counting.
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(downs).toBe(1)
    expect(events).toEqual([{ event: 'log', message: 'process error: spawn /nonexistent/dictate-engine ENOENT' }])
  })
})
