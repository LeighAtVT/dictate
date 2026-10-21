// Ported from Sources/DictateCore/EventLog.swift. Appends timestamped lines to
// a log file, keeping one rotated copy at the 1 MB default. Never given
// dictated text (global-constraints.md).
import fs from 'node:fs'
import path from 'node:path'

export class EventLog {
  private readonly file: string
  private readonly maxBytes: number

  constructor(file: string, maxBytes = 1_000_000) {
    this.file = file
    this.maxBytes = maxBytes
  }

  write(message: string): void {
    const line = `${new Date().toISOString()} ${message}\n`
    const lineBytes = Buffer.byteLength(line, 'utf8')
    const dir = path.dirname(this.file)
    fs.mkdirSync(dir, { recursive: true })

    let size = 0
    try {
      size = fs.statSync(this.file).size
    } catch {
      size = 0
    }

    if (size > 0 && size + lineBytes > this.maxBytes) {
      const rotated = `${this.file}.1`
      try {
        fs.rmSync(rotated)
      } catch {
        // no existing rotated file; fine
      }
      try {
        fs.renameSync(this.file, rotated)
      } catch {
        // best effort
      }
    }

    fs.appendFileSync(this.file, line)
  }
}
