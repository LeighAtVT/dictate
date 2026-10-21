// Which Settings tab to show: main opens the window with the tab's name as the URL hash
// (windows.ts), e.g. "#polish" from the tray's "add OpenRouter key" item. Pure.
import { SETTINGS_TABS } from '../../shared/dictate'

/** The tab index for a URL hash; the first tab (Key) when there's none or it's unknown. */
export function tabIndex(hash: string): number {
  return Math.max(0, (SETTINGS_TABS as readonly string[]).indexOf(hash.replace(/^#/, '')))
}
