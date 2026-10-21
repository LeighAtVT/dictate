// Ported from Tests/DictateCoreTests/PolisherTests.swift, PolisherEditTranslateTests.swift
// (PolisherTranslateTests + PolisherEditTests), PolisherModelTests.swift, and
// PolishFailureTests.swift's PolisherConfigErrorTests suite. PolishFailureTests.swift's
// second suite, PipelinePolishFailureTests, exercises Pipeline rather than Polisher and is
// ported in pipeline.test.ts instead. stubFetch replaces StubTransport.
import { describe, expect, it, vi } from 'vitest'
import type { ModelChoice, Thinking } from './modelCatalog'
import { Polisher } from './polisher'

interface RecordedCall {
  url: string
  init: RequestInit
}

interface StubState {
  reply?: string
  status: number
  delayMs: number
  shouldThrow: boolean
  rawBody?: string
}

function stubFetch(opts: Partial<StubState> = {}): { fn: typeof fetch; calls: RecordedCall[]; state: StubState } {
  const state: StubState = {
    reply: opts.reply,
    status: opts.status ?? 200,
    delayMs: opts.delayMs ?? 0,
    shouldThrow: opts.shouldThrow ?? false,
    rawBody: opts.rawBody
  }
  const calls: RecordedCall[] = []

  async function respond(): Promise<Response> {
    if (state.shouldThrow) throw new TypeError('cannotConnectToHost')
    const body = state.rawBody ?? JSON.stringify({ choices: [{ message: { content: state.reply ?? '' } }] })
    return new Response(body, { status: state.status })
  }

  const fn = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    if (state.delayMs <= 0) return respond()
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        respond().then(resolve, reject)
      }, state.delayMs)
      const signal = init.signal as AbortSignal | undefined
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new DOMException('aborted', 'AbortError'))
      })
    })
  }) as unknown as typeof fetch

  return { fn, calls, state }
}

function lastRequest(calls: RecordedCall[]): RecordedCall {
  const call = calls[calls.length - 1]
  if (!call) throw new Error('no request was sent')
  return call
}

function lastBody(calls: RecordedCall[]): Record<string, unknown> {
  return JSON.parse(lastRequest(calls).init.body as string) as Record<string, unknown>
}

function lastHeaders(calls: RecordedCall[]): Headers {
  return new Headers(lastRequest(calls).init.headers as HeadersInit)
}

function mc(id: string, thinking: Thinking = 'modelDefault'): ModelChoice {
  return { id, thinking }
}

const DEFAULT_MODEL = mc('anthropic/claude-haiku-5.5')

describe('Polisher', () => {
  function polisher(fn: typeof fetch, opts: { key?: string | null; timeoutMs?: number; model?: ModelChoice } = {}): Polisher {
    return new Polisher({
      fetch: fn,
      apiKey: () => (opts.key === undefined ? 'test-key' : opts.key),
      model: opts.model ?? DEFAULT_MODEL,
      timeoutMs: opts.timeoutMs ?? 2500
    })
  }

  // @Test returnsPolishedText
  it('returns the polished text', async () => {
    const { fn } = stubFetch({ reply: 'Can you ask Priya if the queue cleared?' })
    const out = await polisher(fn).polish('um can you ask priya if the queue cleared', 'slack', [])
    expect(out).toBe('Can you ask Priya if the queue cleared?')
  })

  // @Test sendsBearerAndModel
  it('sends the bearer token and model', async () => {
    const { fn, calls } = stubFetch({ reply: 'Ship it today.' })
    await polisher(fn).polish('ship it today', 'slack', [])
    expect(lastRequest(calls).url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(lastHeaders(calls).get('Authorization')).toBe('Bearer test-key')
    expect(lastBody(calls).model).toBe('anthropic/claude-haiku-5.5')
  })

  // @Test nilWhenNoKey
  it('is null when there is no key', async () => {
    const { fn, calls } = stubFetch({ reply: 'x' })
    expect(await polisher(fn, { key: null }).polish('hello there', 'slack', [])).toBeNull()
    expect(calls).toHaveLength(0)
  })

  // @Test nilForRawAndOff
  it('is null for raw and off styles', async () => {
    const { fn, calls } = stubFetch({ reply: 'x' })
    const p = polisher(fn)
    expect(await p.polish('hello there', 'raw', [])).toBeNull()
    expect(await p.polish('hello there', 'off', [])).toBeNull()
    expect(calls).toHaveLength(0)
  })

  // @Test nilOnTimeout
  it('is null on timeout', async () => {
    vi.useFakeTimers()
    try {
      const { fn } = stubFetch({ reply: 'Hello there.', delayMs: 3000 })
      const result = polisher(fn).polish('hello there', 'slack', [])
      await vi.advanceTimersByTimeAsync(2500)
      expect(await result).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  // @Test nilOnTransportError
  it('is null on a transport error', async () => {
    const { fn } = stubFetch({ reply: 'Hello there.', shouldThrow: true })
    expect(await polisher(fn).polish('hello there', 'slack', [])).toBeNull()
  })

  // @Test nilOn500
  it('is null on a 500', async () => {
    const { fn } = stubFetch({ reply: 'Hello there.', status: 500 })
    expect(await polisher(fn).polish('hello there', 'slack', [])).toBeNull()
  })

  // @Test nilOnEmptyContent
  it('is null on empty content', async () => {
    const { fn } = stubFetch({ reply: '  ' })
    expect(await polisher(fn).polish('hello there', 'slack', [])).toBeNull()
  })

  // @Test stripsPreambleAndQuotes
  it('strips a preamble and wrapping quotes', async () => {
    const { fn } = stubFetch({ reply: `Here's the cleaned text: "Ship it today."` })
    expect(await polisher(fn).polish('ship it today', 'slack', [])).toBe('Ship it today.')
  })

  // @Test keepsSpokenHeresTheThing
  it('keeps a spoken "here\'s the thing"', async () => {
    const { fn } = stubFetch({ reply: "Here's the thing: we ship Friday." })
    expect(await polisher(fn).polish("here's the thing we ship friday", 'slack', [])).toBe("Here's the thing: we ship Friday.")
  })

  // @Test keepsSpokenOkayWithTime
  it('keeps a spoken "okay" with a time in the text', async () => {
    const reply = "Okay, let's meet at 3:30 tomorrow to review the GitHub backlog and Figma numbers."
    const { fn } = stubFetch({ reply })
    const out = await polisher(fn).polish(
      "okay let's meet at 3:30 tomorrow to review the github backlog and figma numbers",
      'slack',
      []
    )
    expect(out).toBe(reply)
  })

  // @Test fallsBackWhenOutputBallooned
  it('falls back when the output ballooned', async () => {
    const input = Array(10).fill('word').join(' ')
    const { fn } = stubFetch({ reply: Array(40).fill('poem').join(' ') })
    expect(await polisher(fn).polish(input, 'slack', [])).toBeNull()
  })

  // @Test fallsBackWhenOutputCollapsed
  it('falls back when the output collapsed', async () => {
    const input = Array(20).fill('word').join(' ')
    const { fn } = stubFetch({ reply: 'one two three four five' })
    expect(await polisher(fn).polish(input, 'slack', [])).toBeNull()
  })

  // @Test promptListsVocabularyAndNoAnswerRule
  it('lists vocabulary and the no-answer rule in the prompt', () => {
    const p = Polisher.systemPrompt('slack', ['PostgreSQL'])
    expect(p).toContain('PostgreSQL')
    expect(p).toContain('never answer')
    expect(p).toContain("Casual and concise; keep the speaker's voice; no greeting or sign-off unless spoken.")
  })
})

describe('Polisher translation', () => {
  function polisher(fn: typeof fetch, opts: { translateTimeoutMs?: number } = {}): Polisher {
    return new Polisher({ fetch: fn, apiKey: () => 'k', model: mc('m'), translateTimeoutMs: opts.translateTimeoutMs ?? 4000 })
  }

  // @Test samePromptForbidsTranslation
  it('the same-language prompt forbids translation', () => {
    expect(Polisher.systemPrompt('slack', [], { kind: 'same' })).toContain('Keep the text in its original language; never translate.')
  })

  // @Test languagePromptAsksForTranslation
  it('the language prompt asks for translation', () => {
    expect(Polisher.systemPrompt('slack', [], { kind: 'language', name: 'English' })).toContain(
      'Write the result in English, translating if needed.'
    )
  })

  // @Test rawAppsTranslateFaithfully
  it('raw apps translate faithfully', async () => {
    const { fn, calls } = stubFetch({ reply: 'Deploy tomorrow.' })
    const out = await polisher(fn).polish('despliega mañana', 'raw', [], { kind: 'language', name: 'English' })
    expect(out).toBe('Deploy tomorrow.')
    const messages = lastBody(calls).messages as Array<{ content: string }>
    expect(messages[0].content).toContain('Translate faithfully; do not restyle.')
  })

  // @Test rawWithoutTranslationSendsNothing
  it('raw without translation sends nothing', async () => {
    const { fn, calls } = stubFetch({ reply: 'x' })
    expect(await polisher(fn).polish('hola', 'raw', [], { kind: 'same' })).toBeNull()
    expect(calls).toHaveLength(0)
  })

  // @Test offNeverSends
  it('off never sends', async () => {
    const { fn, calls } = stubFetch({ reply: 'x' })
    expect(await polisher(fn).polish('hola', 'off', [], { kind: 'language', name: 'English' })).toBeNull()
    expect(calls).toHaveLength(0)
  })

  // @Test translationSkipsWordRatio
  it('translation skips the word-count ratio check', async () => {
    const { fn } = stubFetch({ reply: 'We have a meeting with the sales team tomorrow at three.' })
    const out = await polisher(fn).polish('明日三時に営業会議', 'docs', [], {
      kind: 'language',
      name: 'English'
    })
    expect(out).toBe('We have a meeting with the sales team tomorrow at three.')
  })

  // @Test translationUsesItsOwnTimeout
  it('translation uses its own timeout', async () => {
    vi.useFakeTimers()
    try {
      const { fn } = stubFetch({ reply: 'Hello there.', delayMs: 3000 })
      const longEnough = polisher(fn, { translateTimeoutMs: 4000 }).polish('hola', 'docs', [], { kind: 'language', name: 'English' })
      await vi.advanceTimersByTimeAsync(3000)
      await expect(longEnough).resolves.toBe('Hello there.')

      const tooShort = polisher(fn, { translateTimeoutMs: 1000 }).polish('hola', 'docs', [], { kind: 'language', name: 'English' })
      await vi.advanceTimersByTimeAsync(1000)
      await expect(tooShort).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Polisher edit', () => {
  const text =
    'Hey team, I wanted to let you all know that the release is going to be delayed until next week because of a bug.'

  function polisher(fn: typeof fetch, opts: { key?: string | null; editTimeoutMs?: number } = {}): Polisher {
    return new Polisher({
      fetch: fn,
      apiKey: () => (opts.key === undefined ? 'k' : opts.key),
      model: mc('m'),
      editTimeoutMs: opts.editTimeoutMs ?? 8000
    })
  }

  // @Test sendsInstructionAndText
  it('sends the instruction and the text', async () => {
    const { fn, calls } = stubFetch({ reply: 'Release slips to next week (bug).' })
    const out = await polisher(fn).edit(text, 'shorten it', ['Figma'])
    expect(out).toBe('Release slips to next week (bug).') // far shorter than the input: no ratio check
    const messages = lastBody(calls).messages as Array<{ content: string }>
    expect(messages[0].content).toContain('Apply the instruction to the text')
    expect(messages[0].content).toContain('Figma')
    expect(messages[1].content).toBe(`Instruction: shorten it\n\nText:\n${text}`)
  })

  // @Test stripsLeadIn
  it('strips a lead-in', async () => {
    const { fn } = stubFetch({ reply: "Here's the rewritten text: Release slips a week." })
    expect(await polisher(fn).edit(text, 'shorten it', [])).toBe('Release slips a week.')
  })

  // @Test failuresReturnNil
  it('failures return null', async () => {
    const serverError = stubFetch({ reply: 'x', status: 500 })
    expect(await polisher(serverError.fn).edit(text, 'shorten', [])).toBeNull()
    const empty = stubFetch({ reply: '  ' })
    expect(await polisher(empty.fn, { key: 'k' }).edit(text, 'shorten', [])).toBeNull()
    const noKey = stubFetch({ reply: 'x' })
    expect(await polisher(noKey.fn, { key: null }).edit(text, 'shorten', [])).toBeNull()
  })

  // @Test usesEditTimeout
  it('uses the edit timeout', async () => {
    vi.useFakeTimers()
    try {
      const { fn } = stubFetch({ reply: 'Short.', delayMs: 3000 })
      const longEnough = polisher(fn, { editTimeoutMs: 8000 }).edit(text, 'shorten', [])
      await vi.advanceTimersByTimeAsync(3000)
      await expect(longEnough).resolves.toBe('Short.')

      const tooShort = polisher(fn, { editTimeoutMs: 1000 }).edit(text, 'shorten', [])
      await vi.advanceTimersByTimeAsync(1000)
      await expect(tooShort).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Polisher model routing', () => {
  const cleanup = mc('z-ai/glm-5.3-flash', 'minimal')
  const edit = mc('deepseek/deepseek-v4.1-flash', 'off')

  // @Test polishSendsCleanupModelThinkingAndPrivacy
  it('polish sends the cleanup model, its thinking level, and the privacy provider', async () => {
    const { fn, calls } = stubFetch({ reply: 'Ship it today.' })
    await new Polisher({ fetch: fn, apiKey: () => 'k', model: cleanup, editModel: edit }).polish('ship it today', 'slack', [])
    const body = lastBody(calls)
    expect(body.model).toBe('z-ai/glm-5.3-flash')
    expect((body.reasoning as Record<string, unknown>).effort).toBe('minimal')
    const provider = body.provider as Record<string, unknown>
    expect(provider.zdr).toBe(true)
    expect(provider.data_collection).toBe('deny')
  })

  // @Test translationUsesCleanupModel
  it('translation uses the cleanup model', async () => {
    const { fn, calls } = stubFetch({ reply: 'Hello.' })
    await new Polisher({ fetch: fn, apiKey: () => 'k', model: cleanup, editModel: edit }).polish('hola', 'docs', [], {
      kind: 'language',
      name: 'English'
    })
    expect(lastBody(calls).model).toBe('z-ai/glm-5.3-flash')
  })

  // @Test editSendsEditModel
  it('edit sends the edit model', async () => {
    const { fn, calls } = stubFetch({ reply: 'Friendlier text.' })
    await new Polisher({ fetch: fn, apiKey: () => 'k', model: cleanup, editModel: edit }).edit('Text.', 'make this friendlier', [])
    const body = lastBody(calls)
    expect(body.model).toBe('deepseek/deepseek-v4.1-flash')
    expect((body.reasoning as Record<string, unknown>).enabled).toBe(false)
  })

  // @Test modelDefaultSendsNoReasoning
  it('the default thinking level sends no reasoning field', async () => {
    const { fn, calls } = stubFetch({ reply: 'Ship it today.' })
    await new Polisher({ fetch: fn, apiKey: () => 'k', model: mc('someone/custom') }).polish('ship it today', 'slack', [])
    const body = lastBody(calls)
    expect(body.reasoning).toBeUndefined()
    expect(body.model).toBe('someone/custom')
  })

  // @Test editModelDefaultsToCleanupModel
  it('the edit model defaults to the cleanup model', async () => {
    const { fn, calls } = stubFetch({ reply: 'Shorter.' })
    await new Polisher({ fetch: fn, apiKey: () => 'k', model: cleanup }).edit('Longer text.', 'shorten', [])
    expect(lastBody(calls).model).toBe('z-ai/glm-5.3-flash')
  })

  // @Test checkReportsSuccess
  it('check reports success', async () => {
    const { fn, calls } = stubFetch({ reply: 'Can you send the link?' })
    const result = await new Polisher({ fetch: fn, apiKey: () => 'k', model: cleanup }).check(edit)
    if (!('worked' in result)) throw new Error(`expected success, got ${JSON.stringify(result)}`)
    expect(result.worked).toBeGreaterThanOrEqual(0)
    expect(lastBody(calls).model).toBe('deepseek/deepseek-v4.1-flash')
  })

  // @Test checkReportsOpenRouterError
  it('check reports an OpenRouter error', async () => {
    const { fn } = stubFetch({ status: 404, rawBody: '{"error":{"message":"No endpoints found matching your data policy","code":404}}' })
    const result = await new Polisher({ fetch: fn, apiKey: () => 'k', model: cleanup }).check(mc('someone/custom'))
    expect(result).toEqual({ failed: 'No endpoints found matching your data policy' })
  })

  // @Test checkReportsMissingKey
  it('check reports a missing key', async () => {
    const { fn, calls } = stubFetch({ reply: 'x' })
    const result = await new Polisher({ fetch: fn, apiKey: () => null, model: cleanup }).check(cleanup)
    expect(result).toEqual({ failed: 'Add your OpenRouter key first.' })
    expect(calls).toHaveLength(0)
  })

  // @Test checkReportsTimeout
  it('check reports a timeout', async () => {
    vi.useFakeTimers()
    try {
      const { fn } = stubFetch({ reply: 'x', delayMs: 1000 })
      const result = new Polisher({ fetch: fn, apiKey: () => 'k', model: cleanup, timeoutMs: 200 }).check(cleanup, 200)
      await vi.advanceTimersByTimeAsync(200)
      expect(await result).toEqual({ failed: 'No reply within 0.2 seconds.' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Polisher config error (refusal)', () => {
  function polisher(fn: typeof fetch, timeoutMs = 2500): Polisher {
    return new Polisher({ fetch: fn, apiKey: () => 'k', model: mc('someone/custom'), timeoutMs })
  }

  // @Test refusedRequestIsRemembered
  it('remembers a refused request', async () => {
    const { fn } = stubFetch({ status: 404, rawBody: '{"error":{"message":"No endpoints found matching your data policy","code":404}}' })
    const p = polisher(fn)
    expect(await p.polish('ship it today', 'slack', [])).toBeNull()
    expect(p.lastConfigError()).toBe('No endpoints found matching your data policy')
  })

  // @Test successClearsIt
  it('a success clears it', async () => {
    const { fn, state } = stubFetch({ status: 402, rawBody: '{"error":{"message":"Insufficient credits"}}' })
    const p = polisher(fn)
    await p.polish('ship it today', 'slack', [])
    expect(p.lastConfigError()).toBe('Insufficient credits')
    state.status = 200
    state.rawBody = undefined
    state.reply = 'Ship it today.'
    expect(await p.polish('ship it today', 'slack', [])).toBe('Ship it today.')
    expect(p.lastConfigError()).toBeNull()
  })

  // @Test serverErrorsAndTimeoutsAreNotConfigErrors
  it('server errors and timeouts are not config errors', async () => {
    const { fn, state } = stubFetch({ reply: 'x', status: 503 })
    const p = polisher(fn, 200)
    await p.polish('ship it today', 'slack', [])
    expect(p.lastConfigError()).toBeNull()

    vi.useFakeTimers()
    try {
      state.status = 200
      state.delayMs = 1000
      const result = p.polish('ship it today', 'slack', [])
      await vi.advanceTimersByTimeAsync(200)
      await result
    } finally {
      vi.useRealTimers()
    }
    expect(p.lastConfigError()).toBeNull()
  })

  // @Test refusalWithoutBodyStillReported
  it('a refusal without a parseable body is still reported', async () => {
    const { fn } = stubFetch({ status: 401, rawBody: 'not json' })
    const p = polisher(fn)
    await p.polish('ship it today', 'slack', [])
    expect(p.lastConfigError()).toBe('OpenRouter returned 401.')
  })
})
