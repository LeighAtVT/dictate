// Ported from Sources/DictateCore/DictationMode.swift.
//
// What a recording is for, chosen by modifiers held with the dictation key.
// In v1, `DictationMode.from(flags:excluding:)` masked out the hotkey's own
// device bit before reading Shift/Control. In v2 that exclusion already
// happens on the engine side (Task 6): `EngineEvent`'s `held: Modifier[]`
// never includes the talk key's own bit. So `modeFrom` here takes an
// already-excluded `held` list directly, with no `excluding` parameter.
import type { Modifier } from '../../shared/protocol'

export type DictationMode = 'dictate' | 'edit' | 'note'

/** Note wins over edit (a note never changes the document). */
export function modeFrom(held: Modifier[], noteModifier: Modifier): DictationMode {
  if (held.includes(noteModifier)) return 'note'
  if (held.includes('shift')) return 'edit'
  return 'dictate'
}

/** Collects every modifier held at any point during one recording. */
export class ModeTracker {
  private readonly noteModifier: Modifier
  private held: Set<Modifier> = new Set()

  constructor(noteModifier: Modifier) {
    this.noteModifier = noteModifier
  }

  get mode(): DictationMode {
    return modeFrom(Array.from(this.held), this.noteModifier)
  }

  begin(held: Modifier[]): void {
    this.held = new Set(held)
  }

  /**
   * Returns the new mode when this change altered it. Modifiers only count
   * while the dictation key is held, so typing a capital letter during
   * hands-free dictation doesn't turn it into an edit.
   */
  update(held: Modifier[], keyIsDown: boolean): DictationMode | null {
    if (!keyIsDown) return null
    const before = this.mode
    for (const m of held) this.held.add(m)
    const after = this.mode
    return after === before ? null : after
  }
}
