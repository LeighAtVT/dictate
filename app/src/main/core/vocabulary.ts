// Ported from Sources/DictateCore/Vocabulary.swift, parsing only. The file-backed
// `load()`/`save()` (fileURL-based) move to Task 8; `parse` is what both funnel through
// in Swift, so it is the pure surface ported here.

/** Terms Whisper and the polisher should spell exactly. Stored one per line. */
export const VOCABULARY_SEED: string[] = [
  'OpenRouter',
  'Jira',
  'Slack',
  'GitHub',
  'Figma',
  'Supabase',
  'PostgreSQL',
  'Kubernetes',
  'Priya'
]

export function parseVocabulary(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}
