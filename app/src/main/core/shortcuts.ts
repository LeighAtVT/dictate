// Ported from Sources/DictateCore/Shortcuts.swift (the `ShortcutMatcher` half only;
// `ShortcutStore`'s file persistence moves to Task 8).

export interface Shortcut {
  id: string
  phrase: string
  text: string
}

// Unicode punctuation and symbol stripping per global-constraints.md step 2.
const PUNCTUATION_AND_SYMBOLS = /[\p{P}\p{S}]/gu

/** Lowercase, punctuation and symbols removed, whitespace collapsed. */
export function normalizePhrase(s: string): string {
  return s
    .toLowerCase()
    .replace(PUNCTUATION_AND_SYMBOLS, '')
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join(' ')
}

/** The shortcut whose phrase is exactly what was said, ignoring case and punctuation. */
export function matchShortcut(transcript: string, shortcuts: Shortcut[]): Shortcut | null {
  const said = normalizePhrase(transcript)
  if (said.length === 0) return null
  return shortcuts.find((shortcut) => normalizePhrase(shortcut.phrase) === said) ?? null
}
