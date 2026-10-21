// Dictate v2, Task 9: the Electron brain's Engine client. Spawns the native
// engine process (native/mac/DictateEngine/main.swift, or the scriptable
// fake-engine.mjs under test), speaks the JSON-lines protocol over stdio
// (../shared/protocol.ts), matches replies to requests by id, applies
// per-op timeouts, and restarts the engine after a crash (replaying the
// last `setHotkey`) up to a give-up limit.
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { decodeLine, encodeRequest, type EngineEvent, type EngineRequest, type ReplyMap } from '../shared/protocol'

/** Rejects a pending request when the engine process exits before replying. */
export class EngineGone extends Error {
  constructor(message = 'engine process exited before replying') {
    super(message)
    this.name = 'EngineGone'
    Object.setPrototypeOf(this, EngineGone.prototype)
  }
}

/** Rejects a pending request when no reply arrives within its timeout. */
export class EngineTimeout extends Error {
  constructor(message = 'engine request timed out') {
    super(message)
    this.name = 'EngineTimeout'
    Object.setPrototypeOf(this, EngineTimeout.prototype)
  }
}

export interface EngineOptions {
  command: string
  args: string[]
  /** Delay before respawning after a crash. Default 1000ms. */
  restartDelayMs?: number
  /** Per-op timeout overrides, in ms. See DEFAULT_TIMEOUTS_MS for the defaults this replaces. */
  timeouts?: Partial<Record<EngineRequest['op'], number>>
}

// Ops with no timeout at all: secret.get and legacyKey can legitimately wait
// on a Keychain prompt, and requestPermission waits on a user's OS dialog.
const NO_TIMEOUT_OPS: ReadonlySet<EngineRequest['op']> = new Set(['secret.get', 'legacyKey', 'requestPermission'])

const SPECIAL_TIMEOUTS_MS: Partial<Record<EngineRequest['op'], number>> = {
  stopRecording: 120_000,
  selection: 2_000
}

const DEFAULT_TIMEOUT_MS = 5_000

// After this many exits within CRASH_WINDOW_MS, stop auto-restarting.
const MAX_RESTARTS = 5
const CRASH_WINDOW_MS = 60_000

const KILL_GRACE_MS = 3_000

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  timer?: ReturnType<typeof setTimeout>
}

/**
 * Buffers a stream's chunks and calls `onLine` for each complete,
 * newline-delimited line; a partial trailing line is held in `state.buffer`
 * until the rest of it arrives in a later chunk. Shared by stdout and
 * stderr handling, which differ only in what `onLine` does with a line.
 */
function feedLines(state: { buffer: string }, chunk: Buffer, onLine: (line: string) => void): void {
  state.buffer += chunk.toString('utf8')
  let newlineAt: number
  while ((newlineAt = state.buffer.indexOf('\n')) >= 0) {
    const line = state.buffer.slice(0, newlineAt)
    state.buffer = state.buffer.slice(newlineAt + 1)
    onLine(line)
  }
}

export declare interface Engine {
  on(event: 'event', listener: (ev: EngineEvent) => void): this
  on(event: 'down', listener: () => void): this
  on(event: 'up', listener: () => void): this
  on(event: 'failed', listener: () => void): this
  once(event: 'event', listener: (ev: EngineEvent) => void): this
  once(event: 'down', listener: () => void): this
  once(event: 'up', listener: () => void): this
  once(event: 'failed', listener: () => void): this
}

export class Engine extends EventEmitter {
  private readonly command: string
  private readonly args: string[]
  private readonly restartDelayMs: number
  private readonly timeoutOverrides: Partial<Record<EngineRequest['op'], number>>

  private child: ChildProcessWithoutNullStreams | null = null
  private stopping = false
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly stdoutState = { buffer: '' }
  private readonly stderrState = { buffer: '' }
  private crashTimestamps: number[] = []
  private lastHotkey: string | null = null

  constructor(opts: EngineOptions) {
    super()
    this.command = opts.command
    this.args = opts.args
    this.restartDelayMs = opts.restartDelayMs ?? 1000
    this.timeoutOverrides = opts.timeouts ?? {}
  }

  /** Spawns the engine process. Safe to call again after `stop()`. */
  start(): void {
    if (this.child) return
    this.stopping = false

    const child = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    this.stdoutState.buffer = ''
    this.stderrState.buffer = ''

    child.stdout.on('data', (chunk: Buffer) => this.onStdoutData(chunk))
    child.stderr.on('data', (chunk: Buffer) => this.onStderrData(chunk))
    child.on('exit', () => this.onExit())
    // A spawn failure (e.g. bad command) also surfaces as 'error'; treat it
    // like an exit so pending requests don't hang forever.
    child.on('error', () => this.onExit())

    this.emit('up')

    if (this.lastHotkey !== null) {
      this.request({ op: 'setHotkey', key: this.lastHotkey }).catch(() => {
        // Best-effort replay; a failure here surfaces via the next explicit
        // setHotkey call or another crash/restart cycle.
      })
    }
  }

  /**
   * Sends `quit` and waits for the process to exit, SIGTERM-ing it after
   * 3s if it hasn't. After this resolves (or if the engine was never
   * started), the process exiting will not trigger a restart.
   */
  async stop(): Promise<void> {
    this.stopping = true
    const child = this.child
    if (!child) return

    try {
      const id = this.nextId++
      child.stdin.write(`${encodeRequest(id, { op: 'quit' })}\n`)
    } catch {
      // stdin may already be gone; the exit below still resolves this.
    }

    await new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(killTimer)
        resolve()
      }
      child.once('exit', finish)
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGTERM')
        } catch {
          // already gone
        }
      }, KILL_GRACE_MS)
    })
  }

  /** Sends one request and resolves/rejects with its reply, by id. */
  request<O extends EngineRequest['op']>(req: Extract<EngineRequest, { op: O }>): Promise<ReplyMap[O]> {
    if (req.op === 'setHotkey') {
      this.lastHotkey = (req as Extract<EngineRequest, { op: 'setHotkey' }>).key
    }

    const child = this.child
    if (!child) {
      return Promise.reject(new EngineGone('engine is not running'))
    }

    const id = this.nextId++
    return new Promise<ReplyMap[O]>((resolve, reject) => {
      const entry: Pending = {
        resolve: resolve as (value: unknown) => void,
        reject
      }
      this.pending.set(id, entry)

      const timeoutMs = this.timeoutFor(req.op)
      if (timeoutMs !== undefined) {
        entry.timer = setTimeout(() => {
          if (this.pending.delete(id)) {
            reject(new EngineTimeout(`timed out waiting for reply to ${req.op}`))
          }
        }, timeoutMs)
      }

      try {
        child.stdin.write(`${encodeRequest(id, req)}\n`)
      } catch (err) {
        this.pending.delete(id)
        if (entry.timer) clearTimeout(entry.timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  private timeoutFor(op: EngineRequest['op']): number | undefined {
    if (op in this.timeoutOverrides) return this.timeoutOverrides[op]
    if (NO_TIMEOUT_OPS.has(op)) return undefined
    return SPECIAL_TIMEOUTS_MS[op] ?? DEFAULT_TIMEOUT_MS
  }

  private onStdoutData(chunk: Buffer): void {
    feedLines(this.stdoutState, chunk, (line) => this.handleLine(line))
  }

  private onStderrData(chunk: Buffer): void {
    feedLines(this.stderrState, chunk, (line) => this.handleStderrLine(line))
  }

  private handleStderrLine(line: string): void {
    if (line.length > 0) this.emit('event', { event: 'log', message: line } satisfies EngineEvent)
  }

  private handleLine(line: string): void {
    if (line.length === 0) return
    const decoded = decodeLine(line)
    if (decoded === null) return // malformed JSON: ignored, never throws

    if (typeof decoded === 'object' && decoded !== null && 'reply' in decoded) {
      const id = decoded.reply
      const entry = this.pending.get(id)
      if (!entry) return // unknown or already-timed-out id: ignored
      this.pending.delete(id)
      if (entry.timer) clearTimeout(entry.timer)

      if (decoded.ok) {
        const { reply: _reply, ok: _ok, ...rest } = decoded
        entry.resolve(rest)
      } else {
        const message = typeof decoded.error === 'string' ? decoded.error : 'engine returned an error'
        entry.reject(new Error(message))
      }
      return
    }

    this.emit('event', decoded as EngineEvent)
  }

  private onExit(): void {
    if (!this.child) return
    this.child = null

    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer)
      entry.reject(new EngineGone())
    }
    this.pending.clear()

    this.emit('down')

    if (this.stopping) return

    const now = Date.now()
    this.crashTimestamps.push(now)
    this.crashTimestamps = this.crashTimestamps.filter((t) => now - t <= CRASH_WINDOW_MS)

    if (this.crashTimestamps.length >= MAX_RESTARTS) {
      this.emit('failed')
      return
    }

    setTimeout(() => {
      if (!this.stopping) this.start()
    }, this.restartDelayMs)
  }
}
