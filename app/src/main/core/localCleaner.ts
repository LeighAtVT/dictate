// Ported from Sources/DictateCore/LocalCleaner.swift. Deterministic, offline cleanup:
// used for raw/off styles and whenever polish is unavailable.
//
// Swift's NSRegularExpression `\b`/`\w` are ICU-backed and already Unicode-letter-aware;
// JS's `\b`/`\w` are ASCII-only even with the `u` flag, so every boundary/word-char use
// below is rebuilt from `\p{L}`/`\p{N}` (see global-constraints.md's porting rule).

// `(?<!WORD)`/`(?!WORD)` stand in for `\b` around a word-like run; `WORD_CHAR` stands in for `\w`.
const WORD_CHAR = '\\p{L}\\p{N}_'
const BEFORE_WORD = `(?<![${WORD_CHAR}])`
const AFTER_WORD = `(?![${WORD_CHAR}])`

// "like" is a filler only when set off by commas: "it was, like, fast".
const FILLER_LIKE = /,\s*like\s*,/gi
const FILLERS = new RegExp(`(?:,\\s*)?${BEFORE_WORD}(?:um+|uh+|er|ah|hmm+)${AFTER_WORD}(?:\\s*,)?`, 'giu')
// Stutters: "the the" -> "the".
const STUTTERS = new RegExp(`${BEFORE_WORD}([${WORD_CHAR}]+)(?:\\s+\\1${AFTER_WORD})+`, 'giu')
const COLLAPSE_WHITESPACE = /\s+/g
const SPACE_BEFORE_PUNCTUATION = /\s+([,.!?;:])/g
const LEADING_JUNK = /^[\s,;:]+/

const RULES: Array<[RegExp, string]> = [
  [FILLER_LIKE, ' '],
  [FILLERS, ' '],
  [STUTTERS, '$1'],
  [COLLAPSE_WHITESPACE, ' '],
  [SPACE_BEFORE_PUNCTUATION, '$1'],
  [LEADING_JUNK, '']
]

const ANNOTATIONS = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeReplacement(s: string): string {
  return s.replace(/\$/g, '$$$$')
}

export const LocalCleaner = {
  /** Removes Whisper's non-speech annotations: "[BLANK_AUDIO]", "[MUSIC]", "(coughs)", "*laughs*". */
  stripAnnotations(text: string): string {
    return text.replace(ANNOTATIONS, ' ').replace(COLLAPSE_WHITESPACE, ' ').trim()
  },

  clean(text: string): string {
    let s = text
    for (const [pattern, template] of RULES) {
      s = s.replace(pattern, template)
    }
    s = s.trim()
    if (s.length === 0) return ''
    return s[0].toUpperCase() + s.slice(1)
  },

  /** Rewrites vocabulary terms to their exact spelling ("JIRA" -> "Jira"), matching whole words only. */
  applyVocabulary(text: string, terms: string[]): string {
    let s = text
    for (const raw of terms) {
      const term = raw.trim()
      if (term.length === 0) continue
      const pattern = new RegExp(`${BEFORE_WORD}${escapeRegExp(term)}${AFTER_WORD}`, 'giu')
      s = s.replace(pattern, escapeReplacement(term))
    }
    return s
  }
}
