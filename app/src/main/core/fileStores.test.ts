// Ported from Tests/DictateCoreTests/VocabularyTests.swift (load/save, seed when
// missing) and the ShortcutsTests.swift store cases. The pure parsing/matching
// surfaces live in vocabulary.ts and shortcuts.ts (Task 6); this covers the
// file-backed load/save that v1's Vocabulary and ShortcutStore do.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VOCABULARY_SEED } from './vocabulary'
import type { Shortcut } from './shortcuts'
import { loadShortcuts, loadVocabulary, saveShortcuts, saveVocabulary } from './fileStores'

describe('vocabulary file store', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictate-vocab-'))
    file = path.join(dir, 'vocabulary.txt')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  // @Test vocabularySeedWhenMissing
  it('seeds when the file is missing', () => {
    expect(loadVocabulary(file)).toEqual(VOCABULARY_SEED)
    expect(VOCABULARY_SEED).toContain('Supabase')
  })

  // @Test vocabularyRoundTrip
  it('round trips, dropping blanks', () => {
    saveVocabulary(file, ['Priya', 'Figma', '  ', 'Design Team'])
    expect(loadVocabulary(file)).toEqual(['Priya', 'Figma', 'Design Team'])
  })
})

describe('shortcuts file store', () => {
  let dir: string
  let file: string
  const zoom: Shortcut = { id: 'zoom-id', phrase: 'my zoom link', text: 'https://zoom.us/j/1' }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictate-shortcuts-'))
    file = path.join(dir, 'shortcuts.json')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  // @Test storeRoundTripsAndDropsBlankPhrases
  it('is empty when missing, round trips, and drops blank phrases', () => {
    expect(loadShortcuts(file)).toEqual([])
    saveShortcuts(file, [zoom, { id: 'dropped-id', phrase: '  ', text: 'dropped' }])
    expect(loadShortcuts(file)).toEqual([zoom])
  })

  // @Test loadsFilesWithoutIDs
  it('loads files without ids, assigning one', () => {
    fs.writeFileSync(file, '[{"phrase":"sig","text":"Thanks,\\nL"}]')
    const loaded = loadShortcuts(file)
    expect(loaded.length).toBe(1)
    expect(loaded[0].text).toBe('Thanks,\nL')
    expect(typeof loaded[0].id).toBe('string')
    expect(loaded[0].id.length).toBeGreaterThan(0)
  })

  it('writes pretty-printed JSON with sorted keys', () => {
    saveShortcuts(file, [zoom])
    const raw = fs.readFileSync(file, 'utf8')
    expect(raw).toContain('\n') // pretty-printed
    const parsed = JSON.parse(raw)
    expect(Object.keys(parsed[0])).toEqual(['id', 'phrase', 'text'])
  })
})
