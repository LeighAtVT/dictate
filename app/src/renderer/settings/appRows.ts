// Dictate v2, Task 12: the Apps tab's list, v1's `apps` view (SettingsView.swift): every app seen in
// the history plus every app with an override, without blanks or "note", sorted. Pure.
import type { Style } from '../../shared/dictate'

export function appRows(known: readonly string[], overrides: Record<string, Style>): string[] {
  return [...new Set([...known, ...Object.keys(overrides)])].filter((id) => id.length > 0 && id !== 'note').sort()
}

/** The overrides after picking `style` for `id`; null is "Automatic", which removes the override. */
export function withOverride(overrides: Record<string, Style>, id: string, style: Style | null): Record<string, Style> {
  const next = { ...overrides }
  if (style === null) delete next[id]
  else next[id] = style
  return next
}
