// Dictate v2: the composition root. Wires the engine (engine.ts) to the hotkey controller and the
// pipeline (core/), and the pipeline to the pill (pill.ts, pillPresenter.ts) and the menu-bar item
// (tray.ts, trayModel.ts), and the Settings and Onboarding windows (windows.ts) to their API
// (ipc.ts), the way v1's `AppDelegate.applicationDidFinishLaunching` does
// (Sources/DictateApp/AppDelegate.swift), plus the login agent hand-off (startup.ts), the
// first-launch copy of v1's data (migrate.ts), and pausing or switching back to v1
// (side-by-side.ts), plus dictate.log (appLog.ts), the update check (updateCheck.ts), and Copy
// diagnostics (diagnostics.ts). Logic lives in those modules; this file only connects them.
// Never log dictated text, the API key, or request bodies here.
import { app, clipboard, ipcMain, powerMonitor, shell, systemPreferences } from 'electron'
import fs from 'node:fs'
import { join } from 'node:path'
import { atomicWrite } from './core/atomicWrite'
import { EventLog } from './core/eventLog'
import { loadShortcuts, loadVocabulary, saveShortcuts, saveVocabulary } from './core/fileStores'
import { History } from './core/history'
import { HotkeyController } from './core/hotkeyController'
import { NoteSaver } from './core/noteSaver'
import { Pipeline } from './core/pipeline'
import { Polisher } from './core/polisher'
import { RunJournal } from './core/runJournal'
import { SettingsStore } from './core/settingsStore'
import { Engine } from './engine'
import { createHandlers, distinctBundleIDs, registerIpc } from './ipc'
import { copyV1Data, finishMigration, readV1Defaults, type DataStep } from './migrate'
import {
  PAUSE_FAILED,
  SWITCH_BACK_FAILED,
  execFileExec,
  pauseV1,
  serialProbe,
  switchBackToV1,
  v1Status,
  type V1Status
} from './side-by-side'
import { handOff, isAgentLaunch } from './startup'
import { isSettingsTab, SETTINGS_CHANGED } from '../shared/dictate'
import { dictationReporter, launchLine, logRecorder, previousRunLines } from './appLog'
import { AppStatus } from './appStatus'
import { copyDiagnostics, diagnostics } from './diagnostics'
import { PillWindow } from './pill'
import { PillPresenter } from './pillPresenter'
import { TrayController } from './tray'
import { phaseAfter, sideBySide, trayIcon, type DictationPhase } from './trayModel'
import { UpdateChecker, checkForUpdate, releaseUrl } from './updateCheck'
import { variantFor } from './variant'
import { AppWindows } from './windows'

const home = app.getPath('home')
const variant = variantFor(app.getName(), home)
// Before `ready` and before the single-instance lock (which lives in userData): Electron's own
// files go in the variant's data folder rather than a folder named after package.json.
app.setPath('userData', variant.dataDir)

// Menu-bar only app (LSUIElement): closing the pill or any window never quits.
app.on('window-all-closed', () => {})

const record = logRecorder(new EventLog(variant.logFile))
// macOS only, where Node always has getuid.
const uid = process.getuid!()
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// v1's handOffToAgentIfNeeded: run under the login agent, which also takes the single-instance lock.
void handOff({
  label: variant.agentLabel,
  isPackaged: app.isPackaged,
  executable: process.execPath,
  env: process.env,
  home,
  uid,
  exec: execFileExec,
  requestLock: () => app.requestSingleInstanceLock(),
  releaseLock: () => app.releaseSingleInstanceLock(),
  readFile: (file) => {
    try {
      return fs.readFileSync(file, 'utf8')
    } catch {
      return null
    }
  },
  writeFile: atomicWrite,
  sleep,
  now: () => Date.now(),
  log: record
})
  .catch((error: unknown) => {
    // Never expected (exec doesn't reject); keep running as the one copy rather than sit idle.
    record(`handoff failed: ${error instanceof Error ? error.message : String(error)}`)
    return app.requestSingleInstanceLock() ? ('run' as const) : ('quit' as const)
  })
  .then((result) => {
    if (result === 'quit') return app.quit()
    void app
      .whenReady()
      .then(start)
      .catch((error: unknown) => record(`start failed: ${error instanceof Error ? error.message : String(error)}`))
  })

function enginePath(): string {
  // Packaged: Contents/Resources (resourcesPath) and Contents/MacOS are siblings.
  if (app.isPackaged) return join(process.resourcesPath, '..', 'MacOS', 'dictate-engine')
  return join(app.getAppPath(), '..', '.build', 'debug', 'dictate-engine')
}

async function start(): Promise<void> {
  const dataDir = variant.dataDir
  fs.mkdirSync(dataDir, { recursive: true })

  // --- Run journal (v1's startJournal) -----------------------------------------------------
  const journal = new RunJournal(join(dataDir, 'run.json'))
  let exitReason = 'quit'
  record(
    launchLine({
      pid: process.pid,
      version: app.getVersion(),
      agent: isAgentLaunch(process.env, variant.agentLabel),
      // v1's AXIsProcessTrusted(), asked by the brain; `false`: never prompt. The engine's own
      // answer follows in the first "permissions accessibility=… microphone=…" line.
      accessibility: systemPreferences.isTrustedAccessibilityClient(false)
    })
  )
  const previous = journal.begin(process.pid, new Date())
  powerMonitor.on('shutdown', () => {
    exitReason = 'logout'
  })

  // --- First launch: v1's files and settings, before the stores read them (preview only) ------
  // The key half runs once the engine is up (below), so a Keychain prompt never holds up startup.
  let migration: DataStep = { status: 'alreadyMigrated' }
  if (!variant.isFinal) {
    migration = await copyV1Data({
      v1Dir: join(home, 'Library', 'Application Support', 'Dictate'),
      dataDir,
      readDefaults: () => readV1Defaults(execFileExec)
    })
    if (migration.status === 'failed') record(`migration failed: ${migration.error}`)
  }

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
  /** Reads this app's own key into `apiKey`; false when the engine went away mid-read. */
  const refreshKey = async (): Promise<boolean> => {
    try {
      apiKey = (await engine.request({ op: 'secret.get' })).value
      return true
    } catch {
      // Engine went away mid-read; the next 'up' reads it again.
      return false
    }
  }
  /** The read started by the latest 'up'; the migration's key step waits for it (Ruling R37). */
  let keyRead: Promise<boolean> = Promise.resolve(false)
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
      file: join(home, 'Documents', 'Dictate Notes.md')
    }),
    modelReady: () => status.modelReady,
    hasKey: () => apiKey !== null && apiKey.length > 0,
    platform: 'mac'
  })

  const report = dictationReporter(record, () => pipeline.lastTimings)

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
  const openSettings = (tab?: string): void => windows.openSettings(isSettingsTab(tab) ? tab : undefined)
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

  // --- Update check: at launch, every 24 h, 1 h after a failure, and on wake (R41, R46) -------
  const updates = new UpdateChecker({
    check: () => checkForUpdate(fetch, app.getVersion()),
    log: record,
    onFound: (found) => record(`update available: ${found.version}`)
  })
  updates.start()
  powerMonitor.on('resume', () => updates.checkNow())

  // --- Side by side with v1 (preview only): which item the tray shows -------------------------
  let v1: V1Status | null = null
  const probeV1 = serialProbe(async () => {
    if (variant.isFinal) return
    // Null: the agent's state couldn't be read, so keep the last status.
    v1 = (await v1Status({ exec: execFileExec, uid, home, exists: (file) => fs.existsSync(file) })) ?? v1
  })
  probeV1()
  setInterval(probeV1, 10_000)

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
      engineFailed: status.engineFailed,
      sideBySide: sideBySide(v1),
      update: updates.update
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
      pauseV1: () => {
        void pauseV1({ exec: execFileExec, uid, sleep, now: () => Date.now() }).then((r) => {
          record(r.ok ? 'side-by-side: paused v1' : `side-by-side: pause failed at ${r.failed}`)
          if (!r.ok) pill.show(PAUSE_FAILED, false, 3)
          probeV1()
        })
      },
      switchBackToV1: () => {
        record('side-by-side: switching back to v1')
        void switchBackToV1({
          exec: execFileExec,
          uid,
          home,
          previewLabel: variant.agentLabel,
          quit: () => app.quit()
        }).then((r) => {
          if (!r.ok) {
            record(`side-by-side: switch back failed at ${r.failed}`)
            pill.show(SWITCH_BACK_FAILED, false, 3)
          }
          probeV1()
        })
      },
      openUpdate: (url) => {
        // The release page only (updateCheck.ts already filtered it), as its normalized URL.
        const page = releaseUrl(url)
        if (page !== null) void shell.openExternal(page)
      },
      copyDiagnostics: () => {
        void copyDiagnostics({
          text: () =>
            diagnostics({
              appVersion: app.getVersion(),
              osVersion: process.getSystemVersion(),
              variant,
              status,
              permissions: () => engine.request({ op: 'permissions' }),
              hasKey: apiKey !== null && apiKey.length > 0,
              settings: settings.get(),
              update: updates.update,
              updateStatus: updates.status,
              home,
              logFile: variant.logFile
            }),
          copy: (text) => engine.request({ op: 'copy', text }),
          fallback: (text) => clipboard.writeText(text)
        })
          .then((via) => {
            record(`diagnostics copied (${via === 'engine' ? 'engine' : 'app clipboard'})`)
            // Never over a dictation's Listening… or Working… pill.
            if (phase === 'idle') pill.diagnosticsCopied()
          })
          .catch((error: unknown) =>
            record(`diagnostics failed: ${error instanceof Error ? error.message : String(error)}`)
          )
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
    status.engineUp()
    pill.engineUp()
    keyRead = refreshKey()
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

  // The other half of the first launch: v1's key (one Keychain prompt), recorded in the marker.
  // Also runs on a later launch when an earlier try was cut off ('pending', Ruling R33).
  if (migration.status === 'copied') {
    const { copied, model, settings: keys } = migration.data
    record(`migration: copied=${copied.join(',') || 'none'} model=${model} settings=${keys.length}`)
  }
  // Ruling R37: one secret.get only. The engine answers an overlapping second read with null, so
  // the key step uses the startup read ('up' fired inside engine.start()) instead of its own.
  if (migration.status === 'copied' || migration.status === 'keyPending') {
    void keyRead.then(async (ok) => {
      // Couldn't tell whether this app has a key: leave the marker 'pending' for the next launch.
      if (!ok) return record('migration: key step skipped (key read failed)')
      const result = await finishMigration(dataDir, engine, apiKey)
      if (result.status === 'failed') return record(`migration failed: ${result.error}`)
      record(`migration: key=${result.key}`)
      await refreshKey()
    })
  }

  settings.on('change', (s, changed) => {
    if (changed.includes('cleanupModel') || changed.includes('editModel')) polisher = makePolisher()
    if (changed.includes('hotkey')) {
      controller.reset()
      engine.request({ op: 'setHotkey', key: s.hotkey }).catch(() => {})
    }
    // Last, so a failed send to a window can't skip the polisher rebuild or the hotkey reset.
    windows.broadcast(SETTINGS_CHANGED, s)
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
    for (const line of previousRunLines(previous, join(home, 'Library', 'Logs', 'DiagnosticReports'))) record(line)
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
