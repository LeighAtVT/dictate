// Ported from the `logRotatesAtLimit` case in Tests/DictateCoreTests/RunJournalTests.swift
// (v1 defines EventLog in Sources/DictateCore/EventLog.swift; the rotation test lives
// alongside RunJournal's tests in Swift). Keeps the 1 MB default and single rotated copy.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventLog } from './eventLog'

describe('EventLog', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictate-log-'))
    file = path.join(dir, 'logs', 'dictate.log')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  // @Test logRotatesAtLimit
  it('rotates at the byte limit, keeping one rotated copy', () => {
    const log = new EventLog(file, 100)
    const message = 'm'.repeat(40)
    for (let i = 0; i < 5; i++) log.write(message)

    expect(fs.existsSync(`${file}.1`)).toBe(true)
    const size = fs.statSync(file).size
    expect(size).toBeLessThan(100)
    const lines = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.length > 0)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.every((l) => l.endsWith(message))).toBe(true)
  })

  it('defaults maxBytes to 1,000,000', () => {
    const log = new EventLog(file)
    log.write('hello')
    expect(fs.existsSync(`${file}.1`)).toBe(false)
    expect(fs.readFileSync(file, 'utf8').endsWith('hello\n')).toBe(true)
  })

  it('creates the log directory if missing', () => {
    const log = new EventLog(file)
    log.write('first')
    expect(fs.existsSync(file)).toBe(true)
  })
})
