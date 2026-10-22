// Fix round 1: atomicWrite was duplicated verbatim in fileStores.ts, history.ts,
// runJournal.ts, and settingsStore.ts. Moved into this one shared module.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { atomicWrite } from './atomicWrite'

describe('atomicWrite', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictate-atomic-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('creates missing parent dirs and leaves no temp file behind', () => {
    const file = path.join(dir, 'nested', 'deeper', 'data.json')
    atomicWrite(file, 'hello')

    expect(fs.readFileSync(file, 'utf8')).toBe('hello')
    const siblings = fs.readdirSync(path.join(dir, 'nested', 'deeper'))
    expect(siblings).toEqual(['data.json'])
  })

  it("replaces an existing file's content", () => {
    const file = path.join(dir, 'data.json')
    fs.writeFileSync(file, 'old content')

    atomicWrite(file, 'new content')

    expect(fs.readFileSync(file, 'utf8')).toBe('new content')
    expect(fs.readdirSync(dir)).toEqual(['data.json'])
  })
})
