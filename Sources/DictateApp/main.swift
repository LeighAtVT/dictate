import AppKit
import DictateCore
import ServiceManagement

/// Dictate should always run under its LaunchAgent, which restarts it after any exit other than Quit.
/// A copy opened from Finder or Spotlight hands over to the agent and exits, but only once the agent's
/// copy is confirmed running; otherwise it keeps running itself.
@MainActor func handOffToAgentIfNeeded() {
    let others = { NSRunningApplication.runningApplications(withBundleIdentifier: "com.leigh.dictate").map(\.processIdentifier) }

    if Instance.isAgentLaunch(environment: ProcessInfo.processInfo.environment) {
        // The copy that handed off may still be exiting; give it a moment before deciding we're a duplicate.
        let deadline = Date().addingTimeInterval(3)
        while Instance.isDuplicate(selfPID: getpid(), runningPIDs: others()), Date() < deadline {
            Thread.sleep(forTimeInterval: 0.1)
        }
        if Instance.isDuplicate(selfPID: getpid(), runningPIDs: others()) { exit(0) }
        return
    }

    if Instance.isDuplicate(selfPID: getpid(), runningPIDs: others()) { exit(0) }
    try? SMAppService.mainApp.unregister() // v1.0 used a login item; the agent replaces it

    let log = EventLog(fileURL: FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Dictate/dictate.log"))
    guard Bundle.main.bundleIdentifier == "com.leigh.dictate", let executable = Bundle.main.executablePath,
          LaunchAgent.canInstall(executable: executable) else {
        log.write("handoff: not an installed app bundle; running without auto-restart")
        return
    }
    let data = LaunchAgent.plistData(executable: executable)
    let url = LaunchAgent.plistURL
    let service = "gui/\(getuid())/\(LaunchAgent.label)"
    if (try? Data(contentsOf: url)) != data {
        _ = launchctl(["bootout", service])
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        do { try data.write(to: url, options: .atomic) } catch {
            log.write("handoff: couldn't write LaunchAgent: \(error)")
            return
        }
    }
    if launchctl(["print", service]) == nil { _ = launchctl(["bootstrap", "gui/\(getuid())", url.path]) }
    _ = launchctl(["kickstart", service])
    if waitForAgent(service) { exit(0) }
    log.write("handoff: agent did not start; running without auto-restart")
}

/// Waits up to 3 s for the LaunchAgent's copy to be running.
func waitForAgent(_ service: String) -> Bool {
    let deadline = Date().addingTimeInterval(3)
    while Date() < deadline {
        if let out = launchctl(["print", service]), out.contains("\n\tstate = running") { return true }
        Thread.sleep(forTimeInterval: 0.2)
    }
    return false
}

func launchctl(_ args: [String]) -> String? {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    process.arguments = args
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    guard (try? process.run()) != nil else { return nil }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    return process.terminationStatus == 0 ? String(decoding: data, as: UTF8.self) : nil
}

handOffToAgentIfNeeded()

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
