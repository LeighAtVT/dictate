// Ported from Tests/DictateCoreTests/RunJournalTests.swift (journal cases). The
// `Instance.isAgentLaunch`/`isDuplicate` cases belong with LaunchAgent, not ported
// here. The crash-report scan becomes an `.ips` filter test on the same fixtures
// as Swift's `crashReportsFiltersByNameAndDate`.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RunJournal } from './runJournal'

describe('RunJournal', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictate-runjournal-'))
    file = path.join(dir, 'run.json')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function journal(): RunJournal {
    return new RunJournal(file)
  }

  // @Test firstLaunchHasNoPrevious
  it('reports no previous run on first launch', () => {
    expect(journal().begin(1, new Date())).toBeNull()
  })

  // @Test uncleanPreviousIsReported
  it('reports an unclean previous run', () => {
    const j = journal()
    const first = new Date(1_000_000)
    j.begin(11, first)
    const previous = journal().begin(12, new Date())
    expect(previous?.pid).toBe(11)
    expect(previous?.cleanExit).toBe(false)
    expect(previous?.launchedAt).toBe(first.toISOString())
  })

  // @Test cleanPreviousIsNotReported
  it('does not report a clean previous run', () => {
    const j = journal()
    j.begin(11, new Date())
    j.markClean('quit')
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(data.exitReason).toBe('quit')
    expect(journal().begin(12, new Date())).toBeNull()
  })

  // @Test crashReportsFiltersByNameAndDate -> ported as an .ips filter test on the
  // same fixtures (three files: a recent Dictate crash, an old Dictate crash, and
  // a non-Dictate crash).
  it('filters crash reports by Dictate name, .ips extension, and date', () => {
    const since = new Date(Date.now() - 60_000)
    const recent = path.join(dir, 'Dictate-2026-10-15.ips')
    const old = path.join(dir, 'Dictate-old.ips')
    const other = path.join(dir, 'Other.ips')
    fs.writeFileSync(recent, 'x')
    fs.writeFileSync(old, 'x')
    fs.writeFileSync(other, 'x')
    const oldTime = new Date(Date.now() - 3_600_000)
    fs.utimesSync(old, oldTime, oldTime)

    const found = RunJournal.crashReports(dir, since).map((p) => path.basename(p))
    expect(found).toEqual(['Dictate-2026-10-15.ips'])
  })

  it('sorts crash reports newest first', () => {
    const since = new Date(Date.now() - 3_600_000)
    const a = path.join(dir, 'Dictate-a.ips')
    const b = path.join(dir, 'Dictate-b.ips')
    fs.writeFileSync(a, 'x')
    const aTime = new Date(Date.now() - 1000)
    fs.utimesSync(a, aTime, aTime)
    fs.writeFileSync(b, 'x') // newer mtime (written after a)

    const found = RunJournal.crashReports(dir, since).map((p) => path.basename(p))
    expect(found).toEqual(['Dictate-b.ips', 'Dictate-a.ips'])
  })
})
