// Ported from Sources/DictateCore/StyleRouter.swift. Maps the target app (and, for
// browsers, the tab title) to a polish style. `overrides` moves from a struct field to
// an explicit second argument on the pure `styleFor` function; `bundleID` becomes `appId`
// to match AppContext's TS shape (app/src/shared/protocol.ts's `context` reply).

export type Style = 'slack' | 'email' | 'docs' | 'raw' | 'off'

export interface AppContext {
  appId: string
  windowTitle: string | null
  secureInput: boolean
}

const APP_STYLES: Record<string, Style> = {
  'com.tinyspeck.slackmacgap': 'slack',
  'com.apple.Terminal': 'raw',
  'com.googlecode.iterm2': 'raw',
  'com.microsoft.VSCode': 'raw',
  'com.apple.dt.Xcode': 'raw',
  'com.todesktop.230313mzl4w4u92': 'raw', // Cursor
  'dev.zed.Zed': 'raw',
  'com.mitchellh.ghostty': 'raw',
  'com.microsoft.Outlook': 'email',
  'com.apple.mail': 'email'
}

const BROWSERS = new Set(['com.google.Chrome', 'com.apple.Safari', 'company.thebrowser.Browser', 'org.mozilla.firefox'])

// Checked in order against the lowercased window title.
const TITLE_STYLES: Array<{ needle: string; style: Style }> = [
  { needle: 'slack', style: 'slack' },
  { needle: 'gmail', style: 'email' },
  { needle: 'outlook', style: 'email' },
  { needle: 'mail', style: 'email' },
  { needle: 'jira', style: 'docs' },
  { needle: 'google docs', style: 'docs' },
  { needle: 'confluence', style: 'docs' }
]

export function styleFor(ctx: AppContext, overrides: Record<string, Style>): Style {
  if (ctx.secureInput) return 'off'
  const style = overrides[ctx.appId] ?? APP_STYLES[ctx.appId]
  if (style) return style
  if (BROWSERS.has(ctx.appId) && ctx.windowTitle) {
    const title = ctx.windowTitle.toLowerCase()
    const match = TITLE_STYLES.find((t) => title.includes(t.needle))
    if (match) return match.style
  }
  return 'docs'
}
