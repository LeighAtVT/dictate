// Ported from Tests/DictateCoreTests/LocalCleanerTests.swift (LocalCleanerTests and
// VocabularyCasingTests suites). Each `it` name notes the Swift @Test it replaces.
import { describe, expect, it } from 'vitest'
import { LocalCleaner } from './localCleaner'

describe('LocalCleaner.clean', () => {
  // @Test stripsFillers
  it('strips fillers', () => {
    expect(LocalCleaner.clean('Um, so I think, uh, we ship it.')).toBe('So I think we ship it.')
  })

  // @Test collapsesStutters
  it('collapses stutters', () => {
    expect(LocalCleaner.clean('I I think the the queue cleared.')).toBe('I think the queue cleared.')
  })

  // @Test keepsMeaningfulLike
  it('keeps meaningful like', () => {
    expect(LocalCleaner.clean('I like the new plan.')).toBe('I like the new plan.')
  })

  // @Test dropsFillerLike
  it('drops filler like', () => {
    expect(LocalCleaner.clean('It was, like, really fast.')).toBe('It was really fast.')
  })

  // @Test trimsAndRecapitalizes
  it('trims and recapitalizes', () => {
    expect(LocalCleaner.clean('  uh hello there  ')).toBe('Hello there')
  })

  // @Test emptyStaysEmpty
  it('empty stays empty', () => {
    expect(LocalCleaner.clean('um uh')).toBe('')
  })

  // Global constraints: \b/\w must match Unicode letters (accented-word proof).
  // A plain ASCII \w stutter regex would not collapse "café café" since "é" isn't in \w.
  it('collapses stutters with an accented word', () => {
    expect(LocalCleaner.clean('café café is great')).toBe('Café is great')
  })
})

describe('LocalCleaner.stripAnnotations', () => {
  it('removes bracketed, parenthetical, and starred annotations', () => {
    expect(LocalCleaner.stripAnnotations('[BLANK_AUDIO] hello (coughs) world *laughs*')).toBe('hello world')
  })
})

describe('LocalCleaner.applyVocabulary (ported VocabularyCasingTests)', () => {
  // @Test fixesCasingOfVocabularyTerms
  it('fixes casing of vocabulary terms', () => {
    expect(LocalCleaner.applyVocabulary('File it in JIRA for the design team', ['Jira', 'Design Team'])).toBe(
      'File it in Jira for the Design Team'
    )
  })

  // @Test onlyWholeWords
  it('only matches whole words', () => {
    expect(LocalCleaner.applyVocabulary('The figma-looking figmaish thing', ['Figma'])).toBe(
      'The Figma-looking figmaish thing'
    )
  })

  // @Test emptyTermsIsNoOp
  it('treats empty terms as a no-op', () => {
    expect(LocalCleaner.applyVocabulary('hello', ['', '  '])).toBe('hello')
  })

  // Global constraints: accented-word proof for the \b boundary in applyVocabulary.
  // A plain ASCII \b would also (incorrectly) treat "é" as a non-word char and let
  // "café" match inside "cafébar"; the Unicode-aware boundary must not.
  it('matches an accented whole word but not inside a longer accented word', () => {
    expect(
      LocalCleaner.applyVocabulary('the café is nice cafébar is not, but café alone works', ['Café'])
    ).toBe('the Café is nice cafébar is not, but Café alone works')
  })
})
