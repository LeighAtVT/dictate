// Dictate v2, Task 12: the Settings and Onboarding windows, the Electron half of v1's
// `AppDelegate.showSettings`/`showOnboarding`/`makeWindow`/`present`
// (Sources/DictateApp/AppDelegate.swift): titled and closable only, centered, created on first use
// and brought to the front on every open. Both load the sandboxed preload/index.ts. What they show
// is the renderer's job (renderer/settings, renderer/onboarding); this only creates and finds them.
import { app, BrowserWindow, type WebContents } from 'electron'
import { join } from 'node:path'

type Kind = 'settings' | 'onboarding'

const SPEC: Record<Kind, { width: number; height: number; title: (appName: string) => string }> = {
  // v1: a 600 x 460 TabView with 20 px padding.
  settings: { width: 640, height: 500, title: (name) => `${name} Settings` },
  // v1: 460 wide with 24 px padding; taller for the key step.
  onboarding: { width: 508, height: 470, title: (name) => `Set up ${name}` }
}

export class AppWindows {
  private readonly windows: Partial<Record<Kind, BrowserWindow>> = {}

  /** `log` gets load failures only, never anything typed into the windows. */
  constructor(
    private readonly appName: string,
    private readonly log: (message: string) => void
  ) {}

  openSettings(): void {
    this.open('settings')
  }

  openOnboarding(): void {
    this.open('onboarding')
  }

  /** Whether `contents` belongs to Settings or Onboarding (the only windows `window.dictate` serves). */
  owns(contents: unknown): boolean {
    return Object.values(this.windows).some((w) => w !== undefined && !w.isDestroyed() && w.webContents === contents)
  }

  /** Sends to every open Settings or Onboarding window. */
  broadcast(channel: string, payload: unknown): void {
    for (const w of Object.values(this.windows)) {
      if (w !== undefined && !w.isDestroyed()) w.webContents.send(channel, payload)
    }
  }

  private open(kind: Kind): void {
    let window = this.windows[kind]
    if (window === undefined || window.isDestroyed()) {
      window = this.create(kind)
      this.windows[kind] = window
    }
    // v1's `present`: NSApp.activate(ignoringOtherApps:) then makeKeyAndOrderFront. A menu-bar
    // app is never frontmost on its own, so it has to take focus.
    app.focus({ steal: true })
    window.show()
    window.focus()
  }

  private create(kind: Kind): BrowserWindow {
    const spec = SPEC[kind]
    const window = new BrowserWindow({
      width: spec.width,
      height: spec.height,
      useContentSize: true,
      title: spec.title(this.appName),
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      center: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    // Keep the variant's title rather than the page's <title>.
    window.on('page-title-updated', (event) => event.preventDefault())
    window.on('closed', () => {
      if (this.windows[kind] === window) delete this.windows[kind]
    })
    const contents: WebContents = window.webContents
    // Nothing in these windows navigates or opens windows; refuse both.
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('preload-error', (_event, _path, error) => this.log(`${kind}: preload failed: ${error.message}`))
    contents.on('did-fail-load', (_event, code, description) => this.log(`${kind}: page failed to load: ${code} ${description}`))
    contents.on('render-process-gone', (_event, details) => this.log(`${kind}: renderer gone: ${details.reason}`))

    if (process.env['ELECTRON_RENDERER_URL']) {
      void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${kind}/index.html`)
    } else {
      void window.loadFile(join(__dirname, `../renderer/${kind}/index.html`))
    }
    return window
  }
}
