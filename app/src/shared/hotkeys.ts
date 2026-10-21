// v1's `Hotkey` names (Sources/DictateCore/Hotkey.swift): the raw values the settings store and
// the engine's setHotkey use, the Settings picker's `displayName`, and the instructions'
// `shortName`. Shared by the pill (main) and the Settings and Onboarding windows. Pure.

export interface HotkeyInfo {
  raw: string
  displayName: string
  shortName: string
}

export const HOTKEYS: readonly HotkeyInfo[] = [
  { raw: 'fn', displayName: 'Fn (🌐)', shortName: 'Fn' },
  { raw: 'rightOption', displayName: 'Right Option (⌥)', shortName: 'Right Option' },
  { raw: 'rightCommand', displayName: 'Right Command (⌘)', shortName: 'Right Command' },
  { raw: 'rightControl', displayName: 'Right Control (⌃)', shortName: 'Right Control' },
  { raw: 'rightShift', displayName: 'Right Shift (⇧)', shortName: 'Right Shift' },
  { raw: 'leftOption', displayName: 'Left Option (⌥)', shortName: 'Left Option' },
  { raw: 'leftControl', displayName: 'Left Control (⌃)', shortName: 'Left Control' }
]

/** v1's `Hotkey.shortName`, from the settings' raw hotkey value; unknown values read as Fn (v1's default). */
export function hotkeyShortName(raw: string): string {
  return (HOTKEYS.find((h) => h.raw === raw) ?? HOTKEYS[0]).shortName
}
