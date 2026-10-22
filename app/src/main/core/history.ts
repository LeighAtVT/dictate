// Ported from Sources/DictateCore/History.swift. The last few dictations (text
// only), kept on disk so "Copy last" and "Paste raw instead" survive a restart.
// `bundleID` keeps v1's JSON key so a history.json written by v1 stays loadable.
import fs from 'node:fs'
import { atomicWrite } from './atomicWrite'

export interface HistoryEntry {
  /** ISO 8601, e.g. "2026-10-20T15:04:05Z". */
  date: string
  bundleID: string
  raw: string
  final: string
}

const MAX_ENTRIES = 50
const MAX_AGE_MS = 7 * 86_400 * 1000

export class History {
  private readonly file: string
  private readonly now: () => Date
  private entries: HistoryEntry[]

  constructor(file: string, now: () => Date = () => new Date()) {
    this.file = file
    this.now = now
    this.entries = this.readFile()
  }

  add(entry: HistoryEntry): void {
    this.entries.push(entry)
    this.pruneLocked()
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(this.entries.length - MAX_ENTRIES)
    }
    this.save()
  }

  /** Newest first. */
  recent(): HistoryEntry[] {
    return [...this.entries].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  }

  prune(): void {
    this.pruneLocked()
    this.save()
  }

  clear(): void {
    this.entries = []
    this.save()
  }

  private pruneLocked(): void {
    const cutoff = this.now().getTime() - MAX_AGE_MS
    this.entries = this.entries.filter((e) => Date.parse(e.date) >= cutoff)
    this.entries.sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  }

  private readFile(): HistoryEntry[] {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : []
    } catch {
      return []
    }
  }

  private save(): void {
    atomicWrite(this.file, JSON.stringify(this.entries))
  }
}
