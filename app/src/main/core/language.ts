// Ported from Sources/DictateCore/Language.swift. `LanguageSettings.output`'s logic
// becomes the pure function `outputLanguage(spoken, paste)`.

export interface Language {
  code: string
  name: string
}

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'it', name: 'Italian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'ru', name: 'Russian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'tl', name: 'Tagalog' }
]

function nameForCode(code: string): string | undefined {
  return LANGUAGES.find((l) => l.code === code)?.name
}

/** The language the polished text should be written in. */
export type OutputLanguage = { kind: 'same' } | { kind: 'language'; name: string }

export function outputLanguage(spoken: string, paste: string): OutputLanguage {
  if (paste === 'same') return { kind: 'same' }
  const name = nameForCode(paste)
  if (!name || paste === spoken) return { kind: 'same' }
  return { kind: 'language', name }
}
