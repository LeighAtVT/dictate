// Ported from Sources/DictateCore/RunJournal.swift: the journal (remembers
// whether the last run ended cleanly) plus the crash-report scan.
// `Instance.isAgentLaunch`/`isDuplicate` are not ported here; they belong with
// LaunchAgent, which hasn't landed in TS yet.
import fs from 'node:fs'
import path from 'node:path'
import { atomicWrite } from './atomicWrite'

export interface RunRecord {
  pid: number
  /** ISO 8601. */
  launchedAt: string
  cleanExit: boolean
  exitReason?: string | null
}

export class RunJournal {
  private readonly file: string

  constructor(file: string) {
    this.file = file
  }

  /** Records this launch. Returns the previous run only when it did not end cleanly. */
  begin(pid: number, now: Date): RunRecord | null {
    const previous = this.read()
    this.write({ pid, launchedAt: now.toISOString(), cleanExit: false, exitReason: null })
    if (!previous || previous.cleanExit) return null
    return previous
  }

  markClean(reason: string): void {
    const record = this.read()
    if (!record) return
    record.cleanExit = true
    record.exitReason = reason
    this.write(record)
  }

  /** Crash reports for Dictate written after `since`, newest first. */
  static crashReports(dir: string, since: Date): string[] {
    let names: string[]
    try {
      names = fs.readdirSync(dir)
    } catch {
      return []
    }
    return names
      .filter((name) => name.startsWith('Dictate') && name.endsWith('.ips'))
      .map((name) => {
        const full = path.join(dir, name)
        let mtimeMs = 0
        try {
          mtimeMs = fs.statSync(full).mtimeMs
        } catch {
          mtimeMs = 0
        }
        return { full, mtimeMs }
      })
      .filter((f) => f.mtimeMs > since.getTime())
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .map((f) => f.full)
  }

  private read(): RunRecord | null {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      return JSON.parse(raw) as RunRecord
    } catch {
      return null
    }
  }

  private write(record: RunRecord): void {
    atomicWrite(this.file, JSON.stringify(record))
  }
}
