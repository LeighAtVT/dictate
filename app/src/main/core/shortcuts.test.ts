// Ported from Tests/DictateCoreTests/ShortcutsTests.swift, matcher cases only
// (`normalizes`, `matchesWholeUtteranceOnly`, `blankPhraseNeverMatches`). The
// ShortcutStore round-trip tests move to Task 8 along with file persistence.
import { describe, expect, it } from 'vitest'
import { matchShortcut, normalizePhrase, type Shortcut } from './shortcuts'

const zoom: Shortcut = { id: 'zoom', phrase: 'my zoom link', text: 'https://zoom.us/j/1' }

describe('normalizePhrase', () => {
  // @Test normalizes
  it('lowercases, strips punctuation and symbols, and collapses whitespace', () => {
    expect(normalizePhrase('  My, Zoom   link! ')).toBe('my zoom link')
  })

  // Global constraints: accented-word proof. Punctuation/symbol stripping must not
  // touch Unicode letters.
  it('keeps an accented word intact', () => {
    expect(normalizePhrase('Café, please!')).toBe('café please')
  })
})

describe('matchShortcut', () => {
  // @Test matchesWholeUtteranceOnly
  it('matches the whole utterance only', () => {
    expect(matchShortcut('My zoom link.', [zoom])).toEqual(zoom)
    expect(matchShortcut('send my zoom link', [zoom])).toBeNull()
  })

  // @Test blankPhraseNeverMatches
  it('never matches a blank phrase', () => {
    expect(matchShortcut('', [{ id: 'a', phrase: ' ', text: 'x' }])).toBeNull()
    expect(matchShortcut('!', [{ id: 'b', phrase: '?', text: 'x' }])).toBeNull()
  })
})
