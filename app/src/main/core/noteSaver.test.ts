// Ported from Tests/DictateCoreTests/NoteSaverTests.swift. fetch is injected
// (the brief's decision) instead of v1's HTTPTransport protocol/RecordingTransport.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteSaver } from './noteSaver'

function formatLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface RecordedRequest {
  url: string
  init: RequestInit
}

function recordingFetch(opts: { status?: number; delayMs?: number; shouldThrow?: boolean } = {}) {
  const requests: RecordedRequest[] = []
  const fn = ((url: string, init: RequestInit = {}) => {
    requests.push({ url, init })
    return new Promise<Response>((resolve, reject) => {
      const settle = (): void => {
        if (opts.shouldThrow) {
          reject(new TypeError('cannotConnectToHost'))
          return
        }
        resolve(new Response('{}', { status: opts.status ?? 200 }))
      }
      if (opts.delayMs && opts.delayMs > 0) {
        const t = setTimeout(settle, opts.delayMs)
        const signal = init.signal as AbortSignal | undefined
        signal?.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new DOMException('aborted', 'AbortError'))
        })
      } else {
        settle()
      }
    })
  }) as unknown as typeof fetch
  return { fn, requests }
}

describe('NoteSaver', () => {
  let dir: string
  let file: string
  const fixedNow = new Date(1_792_000_000 * 1000)

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictate-notes-'))
    file = path.join(dir, 'notes.md')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
    vi.useRealTimers()
  })

  function saver(
    fetchFn: typeof fetch,
    opts: { token?: string | null; file?: string; timeoutMs?: number } = {}
  ): NoteSaver {
    return new NoteSaver({
      fetch: fetchFn,
      token: () => (opts.token === undefined ? 'tok' : opts.token),
      file: opts.file ?? file,
      now: () => fixedNow,
      timeoutMs: opts.timeoutMs ?? 2000
    })
  }

  const expectedLine = `- [ ] ${formatLocal(fixedNow)} — Call the dentist\n`

  // @Test shortTextHasNoContext
  it('has no context for short text', () => {
    expect(NoteSaver.taskBody('Call the dentist')).toEqual({ text: 'Call the dentist' })
  })

  // @Test longTextIsCutAtAWordAndKeptInContext
  it('cuts long text at a word and keeps the context', () => {
    const long = Array(40).fill('remember').join(' ') // 359 chars
    const body = NoteSaver.taskBody(long)
    expect(body.text.length).toBeLessThanOrEqual(200)
    expect(long.startsWith(body.text)).toBe(true)
    expect(body.text.endsWith('remember')).toBe(true)
    expect(body.context).toBe(long)
  })

  // @Test savesToTasks
  it('saves to tasks', async () => {
    const { fn, requests } = recordingFetch()
    await expect(saver(fn).save('Call the dentist')).resolves.toBe('tasks')
    expect(requests.length).toBe(1)
    expect(requests[0].url).toBe('http://127.0.0.1:19519/tasks-v2/create')
    expect(requests[0].init.method).toBe('POST')
    const headers = new Headers(requests[0].init.headers)
    expect(headers.get('Authorization')).toBe('Bearer tok')
    expect(JSON.parse(requests[0].init.body as string)).toEqual({ text: 'Call the dentist' })
    expect(fs.existsSync(file)).toBe(false)
  })

  // @Test noTokenWritesTheFile
  it('writes the file when there is no token', async () => {
    const { fn, requests } = recordingFetch()
    await expect(saver(fn, { token: null }).save('Call the dentist')).resolves.toBe('file')
    expect(requests.length).toBe(0)
    expect(fs.readFileSync(file, 'utf8')).toBe(expectedLine)
  })

  // @Test errorsFallBackToTheFileAndAppend
  it('falls back to the file and appends on error', async () => {
    const notFound = recordingFetch({ status: 404 })
    await expect(saver(notFound.fn).save('Call the dentist')).resolves.toBe('file')
    const thrown = recordingFetch({ shouldThrow: true })
    await expect(saver(thrown.fn).save('Call the dentist')).resolves.toBe('file')
    expect(fs.readFileSync(file, 'utf8')).toBe(expectedLine + expectedLine)
  })

  // @Test multiLineNotesStayOneChecklistItem
  it('keeps multi-line notes as one checklist item', async () => {
    fs.writeFileSync(file, '# My notes') // no trailing newline
    const { fn } = recordingFetch()
    await expect(saver(fn, { token: null }).save('Call the dentist\n\nabout Tuesday')).resolves.toBe('file')
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    expect(lines[0]).toBe('# My notes')
    expect(lines[1].endsWith('— Call the dentist about Tuesday')).toBe(true)
  })

  // @Test slowYardmasterFallsBack
  it('falls back when Yardmaster is slow', async () => {
    const { fn } = recordingFetch({ delayMs: 3000 })
    await expect(saver(fn, { timeoutMs: 300 }).save('Call the dentist')).resolves.toBe('file')
  })

  // @Test nowhereToSaveReturnsNil
  it('returns null when there is nowhere to save', async () => {
    const { fn } = recordingFetch()
    const unwritable = path.join(dir, 'missing-subdir', 'notes.md')
    await expect(saver(fn, { token: null, file: unwritable }).save('x')).resolves.toBeNull()
  })

  // @Test defaultToken: $YARDMASTER_CLI_TOKEN, else ~/.yardmaster/cli-token.
  // HOME is overridden to a temp dir so this never touches the real
  // ~/.yardmaster/cli-token on this machine.
  describe('defaultToken', () => {
    let prevEnv: string | undefined
    let prevHome: string | undefined
    let fakeHome: string

    beforeEach(() => {
      prevEnv = process.env.YARDMASTER_CLI_TOKEN
      prevHome = process.env.HOME
      delete process.env.YARDMASTER_CLI_TOKEN
      fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dictate-home-'))
      process.env.HOME = fakeHome
    })

    afterEach(() => {
      if (prevEnv === undefined) delete process.env.YARDMASTER_CLI_TOKEN
      else process.env.YARDMASTER_CLI_TOKEN = prevEnv
      if (prevHome === undefined) delete process.env.HOME
      else process.env.HOME = prevHome
      fs.rmSync(fakeHome, { recursive: true, force: true })
    })

    it('prefers the env var', () => {
      process.env.YARDMASTER_CLI_TOKEN = 'env-token'
      fs.mkdirSync(path.join(fakeHome, '.yardmaster'), { recursive: true })
      fs.writeFileSync(path.join(fakeHome, '.yardmaster', 'cli-token'), 'file-token')
      expect(NoteSaver.defaultToken()).toBe('env-token')
    })

    it('falls back to the file, trimmed', () => {
      fs.mkdirSync(path.join(fakeHome, '.yardmaster'), { recursive: true })
      fs.writeFileSync(path.join(fakeHome, '.yardmaster', 'cli-token'), '  file-token\n')
      expect(NoteSaver.defaultToken()).toBe('file-token')
    })

    it('is null when neither is set', () => {
      expect(NoteSaver.defaultToken()).toBeNull()
    })

    it('is null when the file is empty', () => {
      fs.mkdirSync(path.join(fakeHome, '.yardmaster'), { recursive: true })
      fs.writeFileSync(path.join(fakeHome, '.yardmaster', 'cli-token'), '   ')
      expect(NoteSaver.defaultToken()).toBeNull()
    })
  })
})
