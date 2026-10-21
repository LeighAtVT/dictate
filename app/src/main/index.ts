// Dictate v2: the composition root. Wires the engine (engine.ts) to the hotkey controller and the
// pipeline (core/), and the pipeline to the pill (pill.ts, pillPresenter.ts) and the menu-bar item
// (tray.ts, trayModel.ts), and the Settings and Onboarding windows (windows.ts) to their API
// (ipc.ts), the way v1's `AppDelegate.applicationDidFinishLaunching` does
// (Sources/DictateApp/AppDelegate.swift). Logic lives in those modules; this file only connects
// them. Never log dictated text, the API key, or request bodies here.
import { app, ipcMain, powerMonitor, shell } from 'electron'
import fs from 'node:fs'
import { join } from 'node:path'
import { EventLog } from './core/eventLog'
import { loadShortcuts, loadVocabulary, saveShortcuts, saveVocabulary } from './core/fileStores'
import { History } from './core/history'
import { HotkeyController } from './core/hotkeyController'
import { NoteSaver } from './core/noteSaver'
import { Pipeline, type PipelineOutcome } from './core/pipeline'
import { Polisher } from './core/polisher'
import { RunJournal } from './core/runJournal'
import { SettingsStore } from './core/settingsStore'
import { Engine } from './engine'
import { createHandlers, distinctBundleIDs, registerIpc } from './ipc'
import { SETTINGS_CHANGED } from '../shared/dictate'
import { AppStatus, outcomeLogLine } from './appStatus'
import { PillWindow } from './pill'
import { PillPresenter } from './pillPresenter'
import { TrayController } from './tray'
import { phaseAfter, trayIcon, type DictationPhase } from './trayModel'
import { variantFor } from './variant'
import { AppWindows } from './windows'

const variant = variantFor(app.getName(), app.getPath('home'))
// Before `ready` and before the single-instance lock (which lives in userData): Electron's own
// files go in the variant's data folder rather than a folder named after package.json.
app.setPath('userData', variant.dataDir)

// Menu-bar only app (LSUIElement): closing the pill or any window never quits.
app.on('window-all-closed', () => {})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void app.whenReady().then(start)
}

function enginePath(): string {
  // Packaged: Contents/Resources (resourcesPath) and Contents/MacOS are siblings.
  if (app.isPackaged) return join(process.resourcesPath, '..', 'MacOS', 'dictate-engine')
  return join(app.getAppPath(), '..', '.build', 'debug', 'dictate-engine')
}

function start(): void {
  const dataDir = variant.dataDir
  fs.mkdirSync(dataDir, { recursive: true })
  const events = new EventLog(variant.logFile)
  const record = (message: string): void => {
    try {
      events.write(message)
    } catch {
      // Logging must never break dictation.
    }
  }

  // --- Run journal (v1's startJournal) -----------------------------------------------------
  const journal = new RunJournal(join(dataDir, 'run.json'))
  let exitReason = 'quit'
  record(`launch pid=${process.pid} version=${app.getVersion()}`)
  const previous = journal.begin(process.pid, new Date())
  powerMonitor.on('shutdown', () => {
    exitReason = 'logout'
  })

  // --- Stores --------------------------------------------------------------------------------
  const settings = new SettingsStore(join(dataDir, 'settings.json'))
  const history = new History(join(dataDir, 'history.json'))
  history.prune()
  const vocabularyFile = join(dataDir, 'vocabulary.txt')
  const shortcutsFile = join(dataDir, 'shortcuts.json')

  // --- Engine --------------------------------------------------------------------------------
  const args = ['--data-dir', dataDir, '--keychain-service', variant.keychainService]
  // Ruling R3: only an `--e2e` engine build acts on this; a release engine ignores the argument.
  const testAudio = process.env['DICTATE_TEST_AUDIO']
  if (testAudio) args.push('--test-audio', testAudio)
  const engine = new Engine({ command: enginePath(), args })

  let apiKey: string | null = null
  const refreshKey = async (): Promise<void> => {
    try {
      apiKey = (await engine.request({ op: 'secret.get' })).value
    } catch {
      // Engine went away mid-read; the next 'up' reads it again.
    }
  }
  const makePolisher = (): Polisher => {
    const s = settings.get()
    return new Polisher({ fetch, apiKey: () => apiKey, model: s.cleanupModel, editModel: s.editModel })
  }
  let polisher = makePolisher()

  // --- Status shown in the menu bar ----------------------------------------------------------
  const status = new AppStatus()
  let phase: DictationPhase = 'idle'

  // --- Pipeline, hotkey, pill, tray ----------------------------------------------------------
  const pipeline = new Pipeline({
    engine,
    polisher: () => polisher,
    settings: () => settings.get(),
    vocabulary: () => loadVocabulary(vocabularyFile),
    shortcuts: () => loadShortcuts(shortcutsFile),
    history,
    notes: new NoteSaver({
      fetch,
      token: () => NoteSaver.defaultToken(),
      file: join(app.getPath('home'), 'Documents', 'Dictate Notes.md')
    }),
    modelReady: () => status.modelReady,
    hasKey: () => apiKey !== null && apiKey.length > 0,
    platform: 'mac'
  })

  const report = (outcome: PipelineOutcome | null): void => {
    const line = outcomeLogLine(outcome, pipeline.lastTimings)
    if (line) record(line)
  }

  // Ruling R14: `pipeline.handle` is called synchronously and its promise returned as is, and
  // `canBegin` is backed by `pipeline.acceptsBegin` (see the header comments of
  // core/hotkeyController.ts and core/pipeline.ts). `report` only observes the outcome.
  const controller = new HotkeyController(
    'control',
    (action, mode) => {
      const outcome = pipeline.handle(action, mode)
      // Observing only: a throw in `report` must not become an unhandled rejection.
      outcome.then(report).catch(() => {})
      return outcome
    },
    undefined,
    undefined,
    () => pipeline.acceptsBegin
  )

  const pill = new PillPresenter(new PillWindow(record), () => settings.get().hotkey)
  controller.onModeChange = (mode) => pill.modeChanged(mode, pipeline.isListening)

  // --- Settings and Onboarding windows, and their window.dictate API (ipc.ts) ----------------
  const windows = new AppWindows(variant.name, record)
  const openOnboarding = (): void => windows.openOnboarding()
  const openSettings = (): void => windows.openSettings()
  registerIpc(
    ipcMain,
    createHandlers({
      settings,
      // Ruling R22: only this app's own Keychain item; the key never goes back to a window.
      saveKey: async (key) => {
        await engine.request({ op: 'secret.set', value: key })
        apiKey = key
      },
      removeKey: async () => {
        await engine.request({ op: 'secret.delete' })
        apiKey = null
      },
      hasKey: async () => {
        await refreshKey()
        return apiKey !== null && apiKey.length > 0
      },
      // v1: makePolisher().check(choice). An unsaved key (Onboarding) is tested without saving it.
      testModel: async (choice, key) => {
        if (key === null) await refreshKey()
        return new Polisher({ fetch, apiKey: () => key ?? apiKey, model: choice }).check(choice)
      },
      vocabulary: { get: () => loadVocabulary(vocabularyFile), set: (terms) => saveVocabulary(vocabularyFile, terms) },
      shortcuts: { get: () => loadShortcuts(shortcutsFile), set: (list) => saveShortcuts(shortcutsFile, list) },
      knownApps: () => distinctBundleIDs(history.recent()),
      permissions: () => engine.request({ op: 'permissions' }),
      requestPermission: async (name) => {
        await engine.request({ op: 'requestPermission', name })
      },
      clearHistory: () => history.clear(),
      openKeyboardSettings: () => {
        void shell.openExternal('x-apple.systempreferences:com.apple.Keyboard-Settings.extension')
      }
    }),
    (sender) => windows.owns(sender)
  )

  const iconDir = app.isPackaged ? join(process.resourcesPath, 'tray') : join(app.getAppPath(), 'resources', 'tray')
  const tray = new TrayController(
    iconDir,
    variant.name,
    () => ({
      appName: variant.name,
      recent: history.recent(),
      permissionsOK: status.permissionsOK,
      hasKey: apiKey !== null && apiKey.length > 0,
      modelStatus: status.modelStatus,
      engineFailed: status.engineFailed
    }),
    {
      openOnboarding,
      openSettings,
      copyLast: () => {
        const last = history.recent()[0]
        if (last) engine.request({ op: 'copy', text: last.final }).catch(() => {})
      },
      pasteRaw: () => {
        const last = history.recent()[0]
        if (last) engine.request({ op: 'paste', text: last.raw }).catch(() => {})
      },
      copyEntry: (text) => {
        if (text !== undefined) engine.request({ op: 'copy', text }).catch(() => {})
      },
      quit: () => app.quit()
    }
  )
  const refreshIcon = (): void =>
    tray.set(
      trayIcon(phase, {
        permissionsOK: status.permissionsOK,
        modelReady: status.modelReady,
        engineFailed: status.engineFailed
      })
    )
  refreshIcon()

  pipeline.onState = (state) => {
    pill.render(state)
    phase = phaseAfter(state, phase)
    refreshIcon()
  }

  // --- Engine events and lifecycle -----------------------------------------------------------
  let quitting = false
  engine.on('event', (event) => {
    switch (event.event) {
      case 'model': {
        const line = status.model(event)
        if (line) record(line)
        refreshIcon()
        return
      }
      case 'log':
        record(`engine: ${event.message}`)
        return
      default:
        controller.onEvent(event)
    }
  })
  engine.on('up', () => {
    record('engine up')
    pill.engineUp()
    void refreshKey()
  })
  engine.on('down', () => {
    if (quitting) return
    record('engine down')
    status.engineDown()
    // Any recording died with the process, and its key-up will never arrive.
    controller.reset()
    pill.engineDown()
    refreshIcon()
  })
  engine.on('failed', () => {
    record('engine failed: stopped restarting')
    status.engineFailedForGood()
    pill.engineUp()
    refreshIcon()
  })

  engine.start()
  engine.request({ op: 'setHotkey', key: settings.get().hotkey }).catch(() => {})

  settings.on('change', (s, changed) => {
    windows.broadcast(SETTINGS_CHANGED, s)
    if (changed.includes('cleanupModel') || changed.includes('editModel')) polisher = makePolisher()
    if (changed.includes('hotkey')) {
      controller.reset()
      engine.request({ op: 'setHotkey', key: s.hotkey }).catch(() => {})
    }
  })

  // --- Permissions: poll every second, Onboarding while one is missing ------------------------
  let polling = false
  setInterval(() => {
    if (polling) return
    polling = true
    engine
      .request({ op: 'permissions' })
      .then((p) => {
        const { log, openOnboarding: missing } = status.permissionsReport(p)
        if (log) record(log)
        if (missing) openOnboarding()
        refreshIcon()
      })
      .catch(() => {})
      .finally(() => {
        polling = false
      })
  }, 1000)

  if (previous) {
    record(`previous run ended unexpectedly (pid=${previous.pid} launched ${previous.launchedAt})`)
    const reports = join(app.getPath('home'), 'Library', 'Logs', 'DiagnosticReports')
    for (const file of RunJournal.crashReports(reports, new Date(previous.launchedAt))) record(`crash report: ${file}`)
    setTimeout(() => pill.restartNotice(), 1000)
  }

  // v1's applicationShouldHandleReopen: opening Dictate again shows its window. A second launch
  // arrives as 'second-instance'; opening the running app (Finder, `open -a`) as 'activate'.
  const reopen = (): void => (status.permissionsOK ? openSettings() : openOnboarding())
  app.on('second-instance', reopen)
  app.on('activate', reopen)

  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    journal.markClean(exitReason)
    record(`terminate reason=${exitReason}`)
    void engine.stop().finally(() => app.quit())
  })
}
