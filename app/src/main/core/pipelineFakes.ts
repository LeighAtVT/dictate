// Shared test doubles for pipeline.test.ts and pipelineModes.test.ts, standing in for
// Tests/DictateCoreTests/PipelineTests.swift's FakeContext/FakePolisher (FakeRecorder,
// FakeTranscriber, and FakeInserter collapse into FakeEngine -- see pipeline.ts's header
// comment). Not a test file itself (no `describe`/`it`), so both suites can import it
// without vitest re-registering tests.
import type { EngineRequest, ReplyMap } from '../../shared/protocol'
import type { OutputLanguage } from './language'
import type { NoteDestination, NoteSaving } from './noteSaver'
import type { EngineApi } from './pipeline'
import type { Polishing } from './polisher'
import type { Style } from './styleRouter'

type Op = EngineRequest['op']

/** A fixed amount of silence -- never passes the engine's speech gate. */
export const silenceStopReply: ReplyMap['stopRecording'] = { result: 'noSpeech', seconds: 1 }

export function textStopReply(text: string): ReplyMap['stopRecording'] {
  return { result: 'text', text, seconds: 1 }
}

export const slackContext: ReplyMap['context'] = {
  appId: 'com.tinyspeck.slackmacgap',
  windowTitle: null,
  secureInput: false,
  elevated: false
}

export const terminalContext: ReplyMap['context'] = {
  appId: 'com.apple.Terminal',
  windowTitle: null,
  secureInput: false,
  elevated: false
}

/**
 * Replaces PipelineTests.swift's FakeRecorder + FakeTranscriber + FakeContext + FakeInserter:
 * in v2 the engine (not the brain) owns the microphone, the speech gate, and Whisper, so one
 * `stopRecording` reply now stands in for what used to be a recorder + a transcriber.
 */
export class FakeEngine implements EngineApi {
  readonly calls: EngineRequest[] = []
  readonly calledOps = new Set<Op>()
  private readonly queues = new Map<Op, unknown[]>()
  private readonly errors = new Map<Op, unknown>()
  private readonly gates = new Map<Op, { promise: Promise<void>; resolve: () => void }>()

  constructor() {
    this.setReply('context', slackContext)
    this.setReply('startRecording', {})
    this.setReply('cancelRecording', {})
    this.setReply('stopRecording', textStopReply('um ship it today'))
    this.setReply('selection', { text: null })
    this.setReply('paste', { result: 'pasted' })
    this.setReply('copy', {})
  }

  /**
   * Queues one or more replies for `op`. With more than one, each is returned once, in order,
   * then the last repeats -- mirroring FakeContext's `contexts.count > 1 ? removeFirst() : [0]`.
   */
  setReply<O extends Op>(op: O, ...replies: ReplyMap[O][]): void {
    this.queues.set(op, [...replies])
  }

  setError(op: Op, err: unknown): void {
    this.errors.set(op, err)
  }

  clearError(op: Op): void {
    this.errors.delete(op)
  }

  callsFor(op: Op): EngineRequest[] {
    return this.calls.filter((c) => c.op === op)
  }

  /** Suspends replies to `op` until the returned function is called, to test ordering mid-flight. */
  suspend(op: Op): () => void {
    let resolve!: () => void
    const promise = new Promise<void>((r) => {
      resolve = r
    })
    this.gates.set(op, { promise, resolve })
    return () => {
      resolve()
      this.gates.delete(op)
    }
  }

  async request<O extends Op>(req: Extract<EngineRequest, { op: O }>): Promise<ReplyMap[O]> {
    this.calls.push(req)
    this.calledOps.add(req.op)
    const gate = this.gates.get(req.op)
    if (gate) await gate.promise
    if (this.errors.has(req.op)) throw this.errors.get(req.op)
    const queue = this.queues.get(req.op)
    if (queue && queue.length > 0) {
      return (queue.length > 1 ? queue.shift() : queue[0]) as ReplyMap[O]
    }
    return {} as ReplyMap[O]
  }
}

/** Waits for microtasks to flush until `predicate` holds, mirroring Swift's `while x { await Task.yield() }`. */
export async function waitUntil(predicate: () => boolean, maxTurns = 10_000): Promise<void> {
  for (let i = 0; i < maxTurns; i++) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error('waitUntil: condition never became true')
}

export class FakePolisher implements Polishing {
  reply: string | null
  editReply: string | null = null
  configError: string | null = null
  styles: Style[] = []
  outputs: OutputLanguage[] = []
  edits: Array<{ text: string; instruction: string }> = []

  constructor(reply: string | null) {
    this.reply = reply
  }

  async polish(_text: string, style: Style, _vocabulary: string[], output: OutputLanguage = { kind: 'same' }): Promise<string | null> {
    this.styles.push(style)
    this.outputs.push(output)
    return this.reply
  }

  async edit(text: string, instruction: string, _vocabulary: string[]): Promise<string | null> {
    this.edits.push({ text, instruction })
    return this.editReply
  }

  lastConfigError(): string | null {
    return this.configError
  }
}

/** Replaces PipelineModesTests.swift's FakeNotes. */
export class FakeNotes implements NoteSaving {
  destination: NoteDestination | null
  saved: string[] = []

  constructor(destination: NoteDestination | null) {
    this.destination = destination
  }

  async save(text: string): Promise<NoteDestination | null> {
    this.saved.push(text)
    return this.destination
  }
}
