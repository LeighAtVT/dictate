// Dictate v2, Task 11: the pill window, the Electron half of v1's `PillWindow`
// (Sources/DictateApp/PillWindow.swift). A transparent, never-focused panel that floats over
// everything (full-screen apps and every Space included) just below the cursor. What it says and
// when it fades is PillPresenter's job (pillPresenter.ts); this only draws and places it.
import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { pillBounds, type PillSurface } from './pillPresenter'

/**
 * Fixed window size, wide enough for the longest pill text; the capsule inside is centered and
 * sized to its text, and the rest of the window is transparent and ignores the mouse.
 */
const SIZE = { width: 560, height: 44 }

export interface PillMessage {
  text: string
  listening: boolean
}

export class PillWindow implements PillSurface {
  private readonly window: BrowserWindow
  /** Re-sent once the page has loaded, in case the first show came before it could listen. */
  private last: PillMessage = { text: '', listening: false }

  /** `log` gets load failures only (never pill text), so a blank pill shows up in dictate.log. */
  constructor(log: (message: string) => void) {
    this.window = new BrowserWindow({
      ...SIZE,
      type: 'panel',
      transparent: true,
      frame: false,
      focusable: false,
      alwaysOnTop: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/pill.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    this.window.setAlwaysOnTop(true, 'screen-saver')
    // LSUIElement already makes this a UI-element app, so skip the process-type flip that would
    // briefly hide windows on every call.
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    this.window.setIgnoreMouseEvents(true)
    const contents = this.window.webContents
    contents.on('did-finish-load', () => this.send(this.last))
    contents.on('preload-error', (_event, _path, error) => log(`pill: preload failed: ${error.message}`))
    contents.on('did-fail-load', (_event, code, description) => log(`pill: page failed to load: ${code} ${description}`))
    contents.on('render-process-gone', (_event, details) => log(`pill: renderer gone: ${details.reason}`))

    if (process.env['ELECTRON_RENDERER_URL']) {
      void this.window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/pill/index.html`)
    } else {
      void this.window.loadFile(join(__dirname, '../renderer/pill/index.html'))
    }
  }

  show(text: string, listening: boolean): void {
    if (this.window.isDestroyed()) return
    this.send({ text, listening })
    const cursor = screen.getCursorScreenPoint()
    this.window.setBounds(pillBounds(cursor, SIZE, screen.getDisplayNearestPoint(cursor).workArea))
    this.window.showInactive()
  }

  hide(): void {
    if (this.window.isDestroyed()) return
    this.window.hide()
    // Blank it so the next show never flashes the old text for a frame.
    this.send({ text: '', listening: false })
  }

  private send(message: PillMessage): void {
    this.last = message
    this.window.webContents.send('pill', message)
  }
}
