// Ported from Sources/DictateCore/Vocabulary.swift (load/save) and the
// ShortcutStore half of Sources/DictateCore/Shortcuts.swift. Vocabulary.ts and
// shortcuts.ts (Task 6) own the pure parsing/matching this funnels through.
import crypto from 'node:crypto'
import fs from 'node:fs'
import { atomicWrite } from './atomicWrite'
import type { Shortcut } from './shortcuts'
import { parseVocabulary, VOCABULARY_SEED } from './vocabulary'

/** Terms Whisper and the polisher should spell exactly. Stored one per line. */
export function loadVocabulary(file: string): string[] {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return VOCABULARY_SEED
  }
  return parseVocabulary(text)
}

export function saveVocabulary(file: string, terms: string[]): void {
  const content = parseVocabulary(terms.join('\n')).join('\n')
  atomicWrite(file, content)
}

function normalizeShortcut(raw: unknown): Shortcut | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.phrase !== 'string' || typeof obj.text !== 'string') return null
  const id = typeof obj.id === 'string' ? obj.id : crypto.randomUUID()
  return { id, phrase: obj.phrase, text: obj.text }
}

export function loadShortcuts(file: string): Shortcut[] {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeShortcut).filter((s): s is Shortcut => s !== null)
  } catch {
    return []
  }
}

/** Pretty-printed with sorted keys (id, phrase, text are already alphabetical); blank phrases are dropped. */
export function saveShortcuts(file: string, list: Shortcut[]): void {
  const kept = list
    .filter((s) => s.phrase.trim().length > 0)
    .map((s) => ({ id: s.id, phrase: s.phrase, text: s.text }))
  atomicWrite(file, JSON.stringify(kept, null, 2))
}
