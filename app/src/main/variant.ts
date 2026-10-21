// Dictate v2, Task 11: which build this is. The preview ("Dictate Preview") runs side by side
// with v1 and keeps everything separate from it; the final build ("Dictate", Task 17) takes over
// v1's identity. Pure: index.ts passes `app.getName()` and the home folder, so this is testable
// without Electron.
import path from 'node:path'

export interface Variant {
  /** Product name: the app's name, the data and log folder names, and the "Quit …" menu item. */
  name: string
  bundleId: string
  /** Settings, history, shortcuts, vocabulary, the speech model, and Electron's own userData. */
  dataDir: string
  logFile: string
  /** The login LaunchAgent's label (Task 13). */
  agentLabel: string
  /** Keychain service of the OpenRouter key item (account `openrouter`). */
  keychainService: string
  isFinal: boolean
}

export const FINAL_NAME = 'Dictate'
export const PREVIEW_NAME = 'Dictate Preview'

/** `"Dictate"` is the final build; any other name is the preview. */
export function variantFor(appName: string, home: string): Variant {
  const isFinal = appName === FINAL_NAME
  const name = isFinal ? FINAL_NAME : PREVIEW_NAME
  const bundleId = isFinal ? 'com.leigh.dictate' : 'com.leigh.dictate.preview'
  return {
    name,
    bundleId,
    dataDir: path.join(home, 'Library', 'Application Support', name),
    logFile: path.join(home, 'Library', 'Logs', name, 'dictate.log'),
    agentLabel: `${bundleId}.keepalive`,
    keychainService: bundleId,
    isFinal
  }
}
