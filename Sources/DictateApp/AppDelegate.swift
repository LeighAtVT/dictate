import AppKit
import Combine
import DictateCore
import OSLog
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let log = Logger(subsystem: "com.leigh.dictate", category: "pipeline")
    private let supportDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Dictate")

    private var settings: AppSettings!
    private var history: History!
    private var inserter: Inserter!
    private var pipeline: Pipeline!
    private var statusItem: StatusItemController!
    private var hotkey: HotkeyMonitor!
    private let transcriber = LazyTranscriber()
    private let pill = PillWindow()
    private let permissionState = PermissionState()
    private var settingsWindow: NSWindow?
    private var onboardingWindow: NSWindow?
    private var permissionTimer: Timer?
    private let events = EventLog(fileURL: FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/Dictate/dictate.log"))
    private var journal: RunJournal!
    private var exitReason = "quit"

    func applicationDidFinishLaunching(_ notification: Notification) {
        startJournal()
        settings = AppSettings(supportDirectory: supportDir)
        history = History(fileURL: supportDir.appendingPathComponent("history.json"))
        history.prune()
        let context = FrontmostContext()
        inserter = Inserter(pasteboard: SystemPasteboard(), keys: CGEventKeySender(), hasFocusedTextField: { context.hasFocusedTextField() })
        pipeline = Pipeline(recorder: AudioRecorder(), transcriber: transcriber, context: context,
                            router: { [unowned self] in settings.router }, polisher: makePolisher(), inserter: inserter,
                            history: history, vocabulary: { [unowned self] in settings.vocabulary },
                            transcriberReady: { [transcriber] in transcriber.isLoaded })
        pipeline.onStateChange = { [weak self] in self?.render($0) }

        statusItem = StatusItemController(history: history, actions: .init(
            copyLast: { [unowned self] in if let e = history.recent().first { inserter.copy(e.final) } },
            pasteRawInstead: { [unowned self] in
                guard let e = history.recent().first else { return }
                Task { _ = await inserter.insert(e.raw) }
            },
            copyEntry: { [unowned self] in inserter.copy($0.final) },
            openSettings: { [unowned self] in showSettings() },
            openOnboarding: { [unowned self] in showOnboarding() }
        ))
        statusItem.hasKey = { [unowned self] in settings.hasKey }
        statusItem.permissionsOK = { Permissions.allGranted }

        hotkey = HotkeyMonitor(hotkey: settings.hotkey) { [weak self] action, mode in
            guard let self else { return }
            Task { @MainActor in self.report(await self.pipeline.handle(action, mode: mode)) }
        }
        hotkey.onModeChange = { [weak self] mode in
            // Queued behind the begin action, so the pill is already showing.
            Task { @MainActor in
                guard let self, self.pipeline.isListening else { return }
                switch mode {
                case .edit: self.pill.show("Editing selection…", listening: true)
                case .note: self.pill.show("Note to self…", listening: true)
                case .dictate: break
                }
            }
        }

        // Rebuild the polisher when the model changes so the next dictation uses it.
        settingsObserver = settings.$model.dropFirst().sink { [weak self] _ in
            guard let self else { return }
            DispatchQueue.main.async { self.pipeline.polisher = self.makePolisher() }
        }

        hotkeyObserver = settings.$hotkey.dropFirst().sink { [weak self] key in
            self?.hotkey.hotkey = key
        }

        startPermissionWatch()
        loadModel()
    }

    private var settingsObserver: Any?
    private var hotkeyObserver: Any?

    /// Opening Dictate again (Spotlight, Finder, Dock) shows its window: the menu-bar icon can be hidden behind the notch.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if Permissions.allGranted { showSettings() } else { showOnboarding() }
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        journal.markClean(reason: exitReason)
        record("terminate reason=\(exitReason)")
        // ggml aborts at exit if the Whisper context is still alive, so unload it first.
        Task {
            await transcriber.close()
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    // MARK: Run journal

    /// Notes each launch and exit so an unexpected stop shows up in ~/Library/Logs/Dictate/dictate.log.
    private func startJournal() {
        journal = RunJournal(fileURL: supportDir.appendingPathComponent("run.json"))
        let agent = Instance.isAgentLaunch(environment: ProcessInfo.processInfo.environment)
        record("launch pid=\(getpid()) agent=\(agent) accessibility=\(AXIsProcessTrusted())")
        if let previous = journal.begin(pid: getpid(), now: Date()) {
            record("previous run ended unexpectedly (pid=\(previous.pid) launched \(previous.launchedAt.ISO8601Format()))")
            let reports = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/DiagnosticReports")
            for report in RunJournal.crashReports(in: reports, since: previous.launchedAt) {
                record("crash report: \(report.path)")
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
                self?.pill.show("Dictate restarted after an unexpected stop", listening: false, fadeAfter: 3)
            }
        }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.willPowerOffNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.exitReason = "logout" }
        }
    }

    private func record(_ message: String) {
        events.write(message)
        log.info("\(message, privacy: .public)")
    }

    private func makePolisher() -> Polisher {
        let apiKey = settings.apiKey
        return Polisher(transport: URLSessionTransport(), apiKey: { apiKey.value() }, model: settings.model)
    }

    // MARK: Model

    private func loadModel() {
        let store = ModelStore(directory: supportDir.appendingPathComponent("models"), spec: .largeV3TurboQ5, downloader: URLSessionDownloader())
        statusItem.modelStatus = "Preparing speech model…"
        refreshIcon()
        Task.detached { [transcriber] in
            do {
                try await store.ensureModel { fraction in
                    Task { @MainActor [weak self] in
                        self?.statusItem.modelStatus = "Downloading speech model… \(Int(fraction * 100))%"
                    }
                }
                let loaded = try Transcriber(modelURL: store.modelURL)
                transcriber.set(loaded)
                await MainActor.run { [weak self] in
                    self?.statusItem.modelStatus = nil
                    self?.refreshIcon()
                }
            } catch {
                await MainActor.run { [weak self] in
                    self?.statusItem.modelStatus = "Speech model failed to download — relaunch to retry"
                    self?.refreshIcon()
                }
            }
        }
    }

    // MARK: Permissions

    private func startPermissionWatch() {
        if !Permissions.allGranted { showOnboarding() }
        permissionTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.permissionState.refresh()
                if Permissions.accessibility { _ = self.hotkey.start() }
                self.refreshIcon()
            }
        }
        if Permissions.accessibility { _ = hotkey.start() }
    }

    private func refreshIcon() {
        // Don't clobber the red/working icon while a dictation is in progress.
        guard !pipeline.isBusy, !pipeline.isListening else { return }
        statusItem.set(Permissions.allGranted && transcriber.isLoaded ? .idle : .warning)
    }

    // MARK: Pipeline feedback

    private func render(_ state: PipelineState) {
        switch state {
        case .listening:
            statusItem.set(.listening)
            pill.show("Listening…", listening: true)
        case .locked:
            pill.show("Listening — tap \(settings.hotkey.shortName) to finish, Esc to cancel", listening: true)
        case .working:
            statusItem.set(.working)
            pill.show("Working…", listening: false)
        case .notice(let message):
            pill.show(message, listening: false, fadeAfter: 1.5)
        case .idle:
            pill.hide()
            refreshIcon()
        }
    }

    private func report(_ outcome: PipelineOutcome?) {
        guard let outcome else { return }
        if let t = pipeline.lastTimings, case .inserted = outcome {
            log.info("dictation transcribe=\(t.transcribe, format: .fixed(precision: 2))s polish=\(t.polish, format: .fixed(precision: 2))s insert=\(t.insert, format: .fixed(precision: 2))s total=\(t.total, format: .fixed(precision: 2))s")
        }
        if case .failed(let message) = outcome { record("dictation failed: \(message)") }
    }

    // MARK: Windows

    private func showSettings() {
        if settingsWindow == nil {
            let view = SettingsView(settings: settings, knownApps: { [unowned self] in history.recent().map(\.bundleID) })
            settingsWindow = makeWindow(title: "Dictate Settings", content: view)
        }
        present(settingsWindow)
    }

    private func showOnboarding() {
        if onboardingWindow == nil {
            onboardingWindow = makeWindow(title: "Set up Dictate", content: OnboardingView(state: permissionState, settings: settings))
        }
        present(onboardingWindow)
    }

    private func makeWindow(title: String, content: some View) -> NSWindow {
        let window = NSWindow(contentViewController: NSHostingController(rootView: content))
        window.title = title
        window.styleMask = [.titled, .closable]
        window.isReleasedWhenClosed = false
        window.center()
        return window
    }

    private func present(_ window: NSWindow?) {
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }
}
