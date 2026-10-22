// Ported from Tests/DictateCoreTests/VocabularyTests.swift, parse cases only. v1's
// `Vocabulary.load()`/`save()` do file I/O (fileURL-backed); the TS brain's task-6
// surface is pure parsing, so the file-backed round trip is re-expressed directly
// against `parseVocabulary`, which is what `save`/`load` both funnel through in
// Swift (`Vocabulary.parse`). The file-backed store itself moves to Task 8.
import { describe, expect, it } from 'vitest'
import { parseVocabulary, VOCABULARY_SEED } from './vocabulary'

describe('VOCABULARY_SEED', () => {
  // @Test vocabularySeedWhenMissing
  it('contains the seed terms, including Supabase', () => {
    expect(VOCABULARY_SEED).toEqual([
      'OpenRouter',
      'Jira',
      'Slack',
      'GitHub',
      'Figma',
      'Supabase',
      'PostgreSQL',
      'Kubernetes',
      'Priya'
    ])
    expect(VOCABULARY_SEED).toContain('Supabase')
  })
})

describe('parseVocabulary', () => {
  // @Test vocabularyRoundTrip (re-expressed as a direct parse: Vocabulary.save() calls
  // Self.parse on the joined input before writing, and Vocabulary.load() parses the
  // file's contents the same way, so the round trip reduces to parsing the joined lines.)
  it('trims each line and drops blank ones', () => {
    expect(parseVocabulary(['Priya', 'Figma', '  ', 'Design Team'].join('\n'))).toEqual([
      'Priya',
      'Figma',
      'Design Team'
    ])
  })
})
