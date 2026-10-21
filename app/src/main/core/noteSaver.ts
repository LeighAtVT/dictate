// Ported from Sources/DictateCore/NoteSaver.swift. Saves a note to self as a
// Yardmaster task, or appends it to a Markdown file when Yardmaster isn't
// running. fetch is injected per the task-8 brief instead of v1's
// HTTPTransport protocol, and the 2 s timeout is done with AbortController.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type NoteDestination = 'tasks' | 'file'

const ENDPOINT = 'http://127.0.0.1:19519/tasks-v2/create'
const MAX_TASK_LENGTH = 200

export interface NoteSaverOptions {
  fetch: typeof fetch
  token: () => string | null
  file: string
  now?: () => Date
  timeoutMs?: number
}

export class NoteSaver {
  static readonly endpoint = ENDPOINT

  private readonly fetchFn: typeof fetch
  private readonly token: () => string | null
  private readonly file: string
  private readonly now: () => Date
  private readonly timeoutMs: number

  constructor(opts: NoteSaverOptions) {
    this.fetchFn = opts.fetch
    this.token = opts.token
    this.file = opts.file
    this.now = opts.now ?? (() => new Date())
    this.timeoutMs = opts.timeoutMs ?? 2000
  }

  async save(text: string): Promise<NoteDestination | null> {
    if (await this.saveToTasks(text)) return 'tasks'
    return this.appendToFile(text) ? 'file' : null
  }

  /** Task text is capped at 200 characters, cut at a word; the full note goes in `context` when cut. */
  static taskBody(text: string): Record<string, string> {
    if (text.length <= MAX_TASK_LENGTH) return { text }
    const head = text.slice(0, MAX_TASK_LENGTH)
    let cut = head
    for (let i = head.length - 1; i >= 0; i--) {
      if (/\s/.test(head[i])) {
        cut = head.slice(0, i)
        break
      }
    }
    return { text: cut.trim(), context: text }
  }

  /** $YARDMASTER_CLI_TOKEN, else ~/.yardmaster/cli-token. */
  static defaultToken(): string | null {
    const env = process.env.YARDMASTER_CLI_TOKEN
    if (env && env.length > 0) return env
    try {
      const file = path.join(os.homedir(), '.yardmaster', 'cli-token')
      const token = fs.readFileSync(file, 'utf8').trim()
      return token.length > 0 ? token : null
    } catch {
      return null
    }
  }

  private async saveToTasks(text: string): Promise<boolean> {
    const token = this.token()
    if (!token) return false
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await this.fetchFn(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(NoteSaver.taskBody(text)),
        signal: controller.signal
      })
      return res.status >= 200 && res.status < 300
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  private appendToFile(text: string): boolean {
    const oneLine = text
      .split(/\r\n|\r|\n/)
      .filter((part) => part.length > 0)
      .join(' ')
    const line = `- [ ] ${formatLocal(this.now())} — ${oneLine}\n`
    try {
      if (!fs.existsSync(this.file)) {
        fs.writeFileSync(this.file, line)
        return true
      }
      const existing = fs.readFileSync(this.file, 'utf8')
      const needsBreak = existing.length > 0 && !existing.endsWith('\n')
      fs.appendFileSync(this.file, (needsBreak ? '\n' : '') + line)
      return true
    } catch {
      return false
    }
  }
}

/** "yyyy-MM-dd HH:mm" in local time, matching v1's DateFormatter default time zone. */
function formatLocal(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
