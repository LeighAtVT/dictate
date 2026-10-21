import DictateCore
import Foundation
import Testing
@testable import EngineKit

// Dictate v2 Mac Preview, Task 5: `Desktop` wires `FrontmostContext`,
// `Inserter`, `SelectionReader`, and `KeychainStore` into the engine's
// `context`/`paste`/`copy`/`selection`/`permissions`/`requestPermission`/
// `secret.*`/`legacyKey` handlers. Fakes only here — never the real Keychain
// or a real `FrontmostContext`/`Inserter` against this machine's actual UI
// state (global constraints: "Don't touch v1's real Keychain items from
// tests: use fakes").

// MARK: Fakes

private final class FakeContext: ContextProviding, @unchecked Sendable {
    var context = AppContext(bundleID: "com.apple.Safari", windowTitle: "Example", secureInput: false)
    var focused = true
    func current() -> AppContext { context }
    func hasFocusedTextField() -> Bool { focused }
}

@MainActor
private final class FakeInserter: Inserting {
    var insertedText: String?
    var copiedText: String?
    var resultToReturn: InsertResult = .pasted
    func insert(_ text: String) async -> InsertResult {
        insertedText = text
        return resultToReturn
    }
    func copy(_ text: String) {
        copiedText = text
    }
}

@MainActor
private final class FakeSelectionReader: SelectionReading {
    var textToReturn: String?
    func selectedText() async -> String? { textToReturn }
}

/// A fake `SecretStoring` that counts calls to each method, so
/// `legacyKeyReadsOnlyNeverWritesOrDeletes` can prove `legacyKey` never
/// calls `write` or `delete` without touching the real Keychain.
/// `readDelay`, when set, blocks the calling thread (not just suspends it —
/// a real Keychain prompt blocks a thread too), for
/// `secretGetBlockedDoesNotDelayContextReply`.
private final class FakeSecretStore: SecretStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var _readCalls = 0
    private var _writeCalls = 0
    private var _deleteCalls = 0
    var valueToReturn: String?
    var readDelay: TimeInterval = 0

    func read() -> String? {
        lock.withLock { _readCalls += 1 }
        if readDelay > 0 { Thread.sleep(forTimeInterval: readDelay) }
        return valueToReturn
    }
    func write(_ value: String) throws { lock.withLock { _writeCalls += 1 } }
    func delete() throws { lock.withLock { _deleteCalls += 1 } }

    var readCalls: Int { lock.withLock { _readCalls } }
    var writeCalls: Int { lock.withLock { _writeCalls } }
    var deleteCalls: Int { lock.withLock { _deleteCalls } }
}

/// Minimal `Pasteboarding` fake (the engine-level tests need their own copy:
/// `Tests/DictateCoreTests/InserterTests.swift`'s `FakePasteboard` lives in a
/// different test target).
private final class FakePasteboard: Pasteboarding, @unchecked Sendable {
    var items: [[String: Data]]
    var changeCount = 0
    init(items: [[String: Data]] = []) { self.items = items }
    func snapshot() -> [[String: Data]] { items }
    func restore(_ items: [[String: Data]]) { self.items = items; changeCount += 1 }
    func setString(_ s: String) {
        items = [["public.utf8-plain-text": Data(s.utf8)]]
        changeCount += 1
    }
    func readString() -> String? {
        items.first?["public.utf8-plain-text"].map { String(decoding: $0, as: UTF8.self) }
    }
}

private final class FakeKeys: KeySending, @unchecked Sendable {
    var pastes = 0
    func sendCommandV() { pastes += 1 }
    func sendCommandC() {}
}

/// Thread-safe sink + minimal line decoder, matching `ServerTests.swift`'s
/// (private to that file, so re-declared here for the concurrency test).
private final class LineSink: @unchecked Sendable {
    private let lock = NSLock()
    private var _lines: [String] = []
    func add(_ line: String) { lock.withLock { _lines.append(line) } }
    var lines: [String] { lock.withLock { _lines } }
}

private struct DecodedLine {
    let reply: Int?
    let ok: Bool?
    init(_ line: String) {
        let object = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any] ?? [:]
        reply = object["reply"] as? Int
        ok = object["ok"] as? Bool
    }
}

private func makeDesktop(
    context: ContextProviding = FakeContext(),
    inserter: Inserting = FakeInserter(),
    selectionReader: SelectionReading = FakeSelectionReader(),
    secretStore: SecretStoring = FakeSecretStore(),
    legacyStore: SecretStoring = FakeSecretStore()
) -> Desktop {
    Desktop(frontmostContext: context, inserter: inserter, selectionReader: selectionReader,
            secretStore: secretStore, legacyStore: legacyStore)
}

@MainActor
@Suite struct DesktopTests {
    @Test func contextMapsFrontmostContextFields() async throws {
        let fakeContext = FakeContext()
        let desktop = makeDesktop(context: fakeContext)

        let fields = try await desktop.context()

        #expect(fields["appId"] == .string("com.apple.Safari"))
        #expect(fields["windowTitle"] == .string("Example"))
        #expect(fields["secureInput"] == .bool(false))
        #expect(fields["elevated"] == .bool(false))
    }

    @Test func contextMapsNilWindowTitleToNull() async throws {
        let fakeContext = FakeContext()
        fakeContext.context = AppContext(bundleID: "com.apple.Finder", windowTitle: nil, secureInput: true)
        let desktop = makeDesktop(context: fakeContext)

        let fields = try await desktop.context()

        #expect(fields["windowTitle"] == .null)
        #expect(fields["secureInput"] == .bool(true))
    }

    @Test func pasteReportsPastedResult() async throws {
        let inserter = FakeInserter()
        inserter.resultToReturn = .pasted
        let desktop = makeDesktop(inserter: inserter)

        let fields = try await desktop.paste("hello")

        #expect(fields["result"] == .string("pasted"))
        #expect(inserter.insertedText == "hello")
    }

    @Test func pasteReportsCopiedResultWhenNoFocusedTextField() async throws {
        let inserter = FakeInserter()
        inserter.resultToReturn = .copiedOnly
        let desktop = makeDesktop(inserter: inserter)

        let fields = try await desktop.paste("hello")

        #expect(fields["result"] == .string("copied"))
    }

    @Test func pasteWithFakePasteboardHoldingPNGItemRestoresItAfterPaste() async throws {
        // Engine-level version of InserterTests.restoresNonTextPasteboardItems.
        let image: [[String: Data]] = [["public.png": Data([0x89, 0x50, 0x4E, 0x47, 0x00, 0xFF])]]
        let pb = FakePasteboard(items: image)
        let realInserter = Inserter(pasteboard: pb, keys: FakeKeys(), restoreDelay: 0.01, hasFocusedTextField: { true })
        let desktop = makeDesktop(inserter: realInserter)

        let fields = try await desktop.paste("Hello")
        try await Task.sleep(for: .milliseconds(100))

        #expect(fields["result"] == .string("pasted"))
        #expect(pb.items == image)
    }

    @Test func copyPutsTextOnPasteboardOnlyAndReturnsEmptyFields() async throws {
        let inserter = FakeInserter()
        let desktop = makeDesktop(inserter: inserter)

        let fields = try await desktop.copy("just copy this")

        #expect(fields.isEmpty)
        #expect(inserter.copiedText == "just copy this")
    }

    @Test func selectionReturnsTextOrNull() async throws {
        let selection = FakeSelectionReader()
        selection.textToReturn = "selected words"
        let desktop = makeDesktop(selectionReader: selection)

        let withText = try await desktop.selection()
        #expect(withText["text"] == .string("selected words"))

        selection.textToReturn = nil
        let withoutText = try await desktop.selection()
        #expect(withoutText["text"] == .null)
    }

    @Test func secretGetReturnsStoredValueOrNull() async throws {
        let store = FakeSecretStore()
        store.valueToReturn = "sk-or-v1-abc123"
        let desktop = makeDesktop(secretStore: store)

        let fields = try await desktop.secretGet()
        #expect(fields["value"] == .string("sk-or-v1-abc123"))

        store.valueToReturn = nil
        let emptyFields = try await desktop.secretGet()
        #expect(emptyFields["value"] == .null)
    }

    @Test func secretSetAndDeleteCallTheInjectedStoreAndReturnEmptyFields() async throws {
        let store = FakeSecretStore()
        let desktop = makeDesktop(secretStore: store)

        let setFields = try await desktop.secretSet("new-value")
        #expect(setFields.isEmpty)
        #expect(store.writeCalls == 1)

        let deleteFields = try await desktop.secretDelete()
        #expect(deleteFields.isEmpty)
        #expect(store.deleteCalls == 1)
    }

    @Test func legacyKeyReadsOnlyNeverWritesOrDeletes() async throws {
        let legacy = FakeSecretStore()
        legacy.valueToReturn = "sk-or-legacy"
        let desktop = makeDesktop(legacyStore: legacy)

        let fields = try await desktop.legacyKey()

        #expect(fields["key"] == .string("sk-or-legacy"))
        #expect(legacy.readCalls == 1)
        #expect(legacy.writeCalls == 0)
        #expect(legacy.deleteCalls == 0)
    }

    @Test func permissionsReportsAccessibilityBoolAndMicrophoneStatusString() async throws {
        let desktop = makeDesktop()
        let fields = try await desktop.permissions()

        // Can't control the real AX/AV authorization state from a unit test, so this only proves
        // the shape: a bool and one of the three allowed strings.
        guard case .bool = fields["accessibility"] else {
            Issue.record("expected accessibility to be a bool, got \(String(describing: fields["accessibility"]))")
            return
        }
        guard case .string(let microphone) = fields["microphone"] else {
            Issue.record("expected microphone to be a string, got \(String(describing: fields["microphone"]))")
            return
        }
        #expect(["granted", "denied", "undetermined"].contains(microphone))
    }

    @Test func requestPermissionReturnsEmptyFieldsForBothNames() async throws {
        let desktop = makeDesktop()
        let microphoneFields = try await desktop.requestPermission(.microphone)
        #expect(microphoneFields.isEmpty)
    }

    @Test func secretGetBlockedDoesNotDelayContextReply() async throws {
        let slowStore = FakeSecretStore()
        slowStore.readDelay = 2.0
        let desktop = makeDesktop(secretStore: slowStore)

        let sink = LineSink()
        let server = Server(
            output: { sink.add($0) },
            handlers: Handlers(context: desktop.context, secretGet: desktop.secretGet)
        )

        server.receive("{\"id\":1,\"op\":\"secret.get\"}")
        server.receive("{\"id\":2,\"op\":\"context\"}")

        // context's reply should land well before secret.get's 2 s blocked read finishes.
        try await Task.sleep(for: .milliseconds(200))
        let linesSoFar = sink.lines.map(DecodedLine.init)
        #expect(linesSoFar.contains { $0.reply == 2 && $0.ok == true })
        #expect(!linesSoFar.contains { $0.reply == 1 })

        try await Task.sleep(for: .milliseconds(2000))
        let allLines = sink.lines.map(DecodedLine.init)
        #expect(allLines.contains { $0.reply == 1 && $0.ok == true })
        #expect(slowStore.readCalls == 1)
    }
}
