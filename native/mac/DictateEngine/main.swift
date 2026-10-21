import AppKit
import DictateCore
import EngineKit
import Foundation

// Dictate v2 Mac Preview, Task 3: the real engine protocol (JSON-line
// requests and events, spec section 2.3) replaces the spike's bare
// print-and-tap. The spike's periodic accessibility/microphone status
// reporting and 3-second test recording were removed once the Task 1 spike
// passed.
//
// Task 4: the spike's inline Fn-only `KeyTap` (above, now removed) is
// replaced by `EngineKit.KeyTap`, which reports the talk key, other modifier
// changes, Esc, and "some other key" with modifier names instead of a bare
// `down` flag, and supports changing the hotkey at runtime via `setHotkey`.

/// Serializes every stdout write behind one queue: `Server` dispatches each
/// request in its own `Task`, so without this, two replies' JSON could
/// interleave mid-line.
private let outputQueue = DispatchQueue(label: "com.leigh.dictate.engine.output")

private func writeLine(_ line: String) {
    outputQueue.sync {
        print(line)
        fflush(stdout)
    }
}

/// `setHotkey`'s reply for a raw value that isn't one of `Hotkey`'s cases. `description` (not the
/// unparsed raw value, which is never echoed back) becomes the `EngineReply.error` message.
private struct UnknownHotkey: Error, CustomStringConvertible {
    var description: String { "unknown hotkey" }
}

/// Finds `--name value` in the CLI arguments.
private func argumentValue(_ name: String, in arguments: [String]) -> String? {
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}

let arguments = CommandLine.arguments
guard let dataDirPath = argumentValue("--data-dir", in: arguments),
      let keychainService = argumentValue("--keychain-service", in: arguments) else {
    writeLine(encodeLine(EngineEvent.log(message: "usage: dictate-engine --data-dir <path> --keychain-service <service>")))
    exit(2)
}
// Secret ops (secret.get/set/delete) are wired to this service in a later task.
_ = keychainService

let dataDir = URL(fileURLWithPath: dataDirPath)
let speech = Speech(
    recorder: AudioRecorder(),
    modelDirectory: dataDir.appendingPathComponent("models"),
    downloader: URLSessionDownloader(),
    makeTranscriber: { try Transcriber(modelURL: $0) },
    emit: { event in writeLine(encodeLine(event)) }
)

let keyTap = KeyTap(hotkey: .default, emit: { event in writeLine(encodeLine(event)) })

let handlers = Handlers(
    startRecording: {
        try speech.start()
        return [:]
    },
    cancelRecording: {
        speech.cancel()
        return [:]
    },
    stopRecording: { language, vocabulary in
        let outcome = try await speech.stop(language: language, vocabulary: vocabulary)
        var fields: [String: JSONValue] = [
            "result": .string(outcome.result),
            "seconds": .number(outcome.seconds)
        ]
        if let text = outcome.text {
            fields["text"] = .string(text)
        }
        return fields
    },
    setHotkey: { key in
        guard let hotkey = Hotkey(rawValue: key) else { throw UnknownHotkey() }
        // `keyTap.hotkey` is read on the main thread by the tap callback without locking, so it's
        // only ever written from the main thread too.
        await MainActor.run { keyTap.hotkey = hotkey }
        return [:]
    },
    quit: {
        // `shutdownThenExit` awaits `speech.shutdown()` to full completion
        // before even scheduling `exit` — if a transcription is in flight,
        // `Transcriber.close()` queues behind it on the actor, so this can
        // take a while. Only once that's done does this closure return,
        // letting `Server` write the reply; `exit` then fires a short grace
        // period later, giving that reply (and its `fflush`) time to land.
        await shutdownThenExit(shutdown: { await speech.shutdown() }, queue: outputQueue, exit: { exit($0) })
        return [:]
    }
)

let server = Server(output: writeLine, handlers: handlers)

Task.detached {
    await speech.loadModel()
}

/// `true` for a `{"id":N,"op":"quit",...}` line. Checked so the reader loop can stop
/// itself without also racing the `quit` handler's own shutdown+exit: if the brain
/// closes stdin right after sending `quit` (plausible for a graceful shutdown), the
/// next `readLine()` would otherwise see EOF and run the EOF shutdown path too,
/// potentially exiting before the `quit` request's own reply is written.
private let isQuitRequest: @Sendable (String) -> Bool = { line in
    guard let object = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else { return false }
    return object["op"] as? String == "quit"
}

let stdinThread = Thread {
    while let line = readLine(strippingNewline: true) {
        server.receive(line)
        if isQuitRequest(line) {
            // The dispatched `quit` handler (above) now owns shutdown + exit
            // via the same `shutdownThenExit` routine as the EOF path below;
            // stop reading so a closed pipe's EOF can't race ahead of it.
            return
        }
    }
    // EOF with no `quit` seen: the parent (the Electron brain) closed the
    // pipe some other way, e.g. it exited. Same shutdown-then-exit routine
    // as the `quit` handler, so the two paths can't diverge.
    Task {
        await shutdownThenExit(shutdown: { await speech.shutdown() }, queue: outputQueue, exit: { exit($0) })
    }
}
stdinThread.start()

// `start()` returns false without Accessibility permission. There's no "start tap" request in
// the protocol for the brain to retry with, so the engine retries on its own, once a second,
// until the tap is up — e.g. once the user grants Accessibility in System Settings.
func startKeyTapRetrying() {
    guard !keyTap.start() else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { startKeyTapRetrying() }
}
startKeyTapRetrying()

RunLoop.main.run()
