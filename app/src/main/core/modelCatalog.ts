// Ported from Sources/DictateCore/ModelChoice.swift.

export type Thinking = 'modelDefault' | 'off' | 'minimal' | 'low'

/** An OpenRouter model and how much hidden thinking it may do. Thinking adds latency, and cleanup has 2.5 s. */
export interface ModelChoice {
  id: string
  thinking: Thinking
}

export interface ModelPreset {
  name: string
  /** One line for Settings: what it's good at and roughly what it costs. */
  note: string
  choice: ModelChoice
}

// Picks from a bake-off on real dictation history (Oct 2026): each graded blind, timed, and
// priced through OpenRouter with zero-data-retention providers only. The first entry in each
// list is the default.
export const CLEANUP_PRESETS: ModelPreset[] = [
  {
    name: 'GLM 5.3 Flash',
    note: 'Best cleanup and translation tested. About 3¢ per 1,000 dictations.',
    choice: { id: 'z-ai/glm-5.3-flash', thinking: 'minimal' }
  },
  {
    name: 'DeepSeek V4.1 Flash',
    note: 'Nearly as good and just as fast. About 4¢ per 1,000.',
    choice: { id: 'deepseek/deepseek-v4.1-flash', thinking: 'off' }
  },
  {
    name: 'Claude Haiku 5.5',
    note: 'Good cleanup, but often leaves Spanish untranslated. About 6¢ per 1,000.',
    choice: { id: 'anthropic/claude-haiku-5.5', thinking: 'modelDefault' }
  },
  {
    name: 'GPT-6 Luna',
    note: 'Good translation, wordier cleanup. About 3¢ per 1,000.',
    choice: { id: 'openai/gpt-6-luna', thinking: 'off' }
  }
]

export const EDIT_PRESETS: ModelPreset[] = [
  {
    name: 'DeepSeek V4.1 Flash',
    note: 'Best edits for the price, under 2 s. About 3¢ per 1,000 edits.',
    choice: { id: 'deepseek/deepseek-v4.1-flash', thinking: 'off' }
  },
  {
    name: 'Claude Haiku 5.5',
    note: 'Close second, under 2 s. About 5¢ per 1,000 edits.',
    choice: { id: 'anthropic/claude-haiku-5.5', thinking: 'modelDefault' }
  },
  {
    name: 'GPT-6 Luna',
    note: 'Most careful rewrites, but takes 4–6 s. About 4¢ per 1,000 edits.',
    choice: { id: 'openai/gpt-6-luna', thinking: 'modelDefault' }
  }
]

export const DEFAULT_CLEANUP: ModelChoice = CLEANUP_PRESETS[0].choice
export const DEFAULT_EDIT: ModelChoice = EDIT_PRESETS[0].choice

// Before v1.2 one free-text model did everything. The old default moves to the new one;
// anything else was typed on purpose, so it stays as a custom cleanup model.
const LEGACY_DEFAULT = 'anthropic/claude-haiku-5.5'

export function migrateLegacy(id?: string): ModelChoice {
  const trimmed = (id ?? '').trim()
  return trimmed.length === 0 || trimmed === LEGACY_DEFAULT ? DEFAULT_CLEANUP : { id: trimmed, thinking: 'modelDefault' }
}

export function presetFor(choice: ModelChoice, presets: ModelPreset[]): ModelPreset | undefined {
  return presets.find((p) => p.choice.id === choice.id && p.choice.thinking === choice.thinking)
}

/** OpenRouter's `reasoning` field, or undefined to leave it to the model. */
export function reasoningParam(t: Thinking): object | undefined {
  switch (t) {
    case 'modelDefault':
      return undefined
    case 'off':
      return { enabled: false }
    case 'minimal':
      return { effort: 'minimal' }
    case 'low':
      return { effort: 'low' }
  }
}
