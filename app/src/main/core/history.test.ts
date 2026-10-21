// Ported from Tests/DictateCoreTests/HistoryTests.swift. v1 keeps the last 50
// dictations for 7 days, JSON-encoded with ISO 8601 dates and the `bundleID` key
// (kept as-is here so a v1 history.json stays loadable).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { History, type HistoryEntry } from './history'

describe('History', () => {
  let dir: string
  let file: string
  let clockNow: Date

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictate-history-'))
    file = path.join(dir, 'history.json')
    clockNow = new Date(1_800_000_000 * 1000)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function history(): History {
    return new History(file, () => clockNow)
  }

  function entry(n: number, at?: Date): HistoryEntry {
    return { date: (at ?? clockNow).toISOString(), bundleID: 'app', raw: `raw ${n}`, final: `final ${n}` }
  }

  // @Test capsAtFifty
  it('caps at fifty entries, dropping the oldest', () => {
    const h = history()
    for (let i = 0; i < 55; i++) {
      clockNow = new Date(clockNow.getTime() + 1000)
      h.add(entry(i))
    }
    const recent = h.recent()
    expect(recent.length).toBe(50)
    expect(recent[recent.length - 1].raw).toBe('raw 5')
  })

  // @Test prunesOlderThanSevenDays
  it('prunes entries older than seven days', () => {
    const h = history()
    h.add(entry(1, new Date(clockNow.getTime() - 8 * 86_400 * 1000)))
    h.add(entry(2))
    expect(h.recent().map((e) => e.raw)).toEqual(['raw 2'])
  })

  // @Test persistsAcrossInstances
  it('persists across instances', () => {
    history().add(entry(1))
    expect(history().recent().map((e) => e.raw)).toEqual(['raw 1'])
  })

  // @Test newestFirst
  it('returns newest first', () => {
    const h = history()
    h.add(entry(1))
    clockNow = new Date(clockNow.getTime() + 1000)
    h.add(entry(2))
    expect(h.recent().map((e) => e.raw)).toEqual(['raw 2', 'raw 1'])
  })

  // @Test corruptFileStartsEmpty
  it('starts empty when the file is corrupt', () => {
    fs.writeFileSync(file, 'not json')
    expect(history().recent()).toEqual([])
  })

  // Added per task-8 brief: a v1 history.json written by Swift's ISO 8601 encoder loads.
  it('loads a v1 history.json written by Swift JSONEncoder(.iso8601)', () => {
    // Shape Swift's JSONEncoder produces: compact, field order date/bundleID/raw/final,
    // dates as "yyyy-MM-dd'T'HH:mm:ss'Z'" (no fractional seconds).
    const v1Json =
      '[{"date":"2026-10-20T15:04:05Z","bundleID":"com.apple.Notes","raw":"hello there","final":"Hello there."}]'
    fs.writeFileSync(file, v1Json)
    const recent = history().recent()
    expect(recent).toEqual([
      { date: '2026-10-20T15:04:05Z', bundleID: 'com.apple.Notes', raw: 'hello there', final: 'Hello there.' }
    ])
  })

  it('clear() empties and persists', () => {
    const h = history()
    h.add(entry(1))
    h.clear()
    expect(h.recent()).toEqual([])
    expect(history().recent()).toEqual([])
  })
})
