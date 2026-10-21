import DictateCore
import Foundation

// Dictate v2 Mac Preview, Task 5: the engine's desktop-facing handlers —
// context, paste, copy, selection, permissions, requestPermission,
// secret.get/set/delete, and legacyKey — built from the same DictateCore
// pieces v1's `Sources/DictateApp/AppDelegate.swift` wires up (`Inserter`,
// `FrontmostContext`, `SelectionReader`, `KeychainStore`), plus
// `DictateCore.Permissions` (moved there from v1's `OnboardingView.swift` by
// controller ruling R7).
//
// `ContextProviding`, `Inserting`, and `SelectionReading` are class-bound,
// non-Sendable protocols (`Inserting`/`SelectionReading` are `@MainActor`,
// so calling them from here hops automatically; `ContextProviding` isn't
// actor-isolated, so this wraps its calls in `MainActor.run` itself — same
// AX-on-main-thread convention `FrontmostContext` already follows).
// `Desktop` is `@unchecked Sendable`, matching `KeyTap`/`Speech` elsewhere in
// this target: safe because every method only reads its own `let`
// properties and funnels the actual work through one `MainActor.run` (or an
// already-`@MainActor` protocol call) or one `Task.detached`, never touching
// shared mutable state directly.

/// One generic-password Keychain item's read/write/delete, the shape both
/// `KeychainStore` and `legacyKey`'s fake in `DesktopTests.swift` share.
/// Exists so `legacyKey`'s test can inject a fake and assert it never calls
/// `write` or `delete`, without touching the real Keychain (global
/// constraints: tests use fakes, never v1's real Keychain items).
public protocol SecretStoring: Sendable {
    func read() -> String?
    func write(_ value: String) throws
    func delete() throws
}

extension KeychainStore: SecretStoring {}

public final class Desktop: @unchecked Sendable {
    private let frontmostContext: ContextProviding
    private let inserter: Inserting
    private let selectionReader: SelectionReading
    private let secretStore: SecretStoring
    private let legacyStore: SecretStoring

    public init(
        frontmostContext: ContextProviding,
        inserter: Inserting,
        selectionReader: SelectionReading,
        secretStore: SecretStoring,
        legacyStore: SecretStoring
    ) {
        self.frontmostContext = frontmostContext
        self.inserter = inserter
        self.selectionReader = selectionReader
        self.secretStore = secretStore
        self.legacyStore = legacyStore
    }

    /// `FrontmostContext.current()` touches Accessibility, so it hops to the main thread, the same
    /// way `FrontmostContext` itself expects to be called (see its AX-timeout comments).
    public func context() async throws -> [String: JSONValue] {
        let context = await MainActor.run { self.frontmostContext.current() }
        return [
            "appId": .string(context.bundleID),
            "windowTitle": context.windowTitle.map(JSONValue.string) ?? .null,
            "secureInput": .bool(context.secureInput),
            "elevated": .bool(false),
        ]
    }

    public func paste(_ text: String) async throws -> [String: JSONValue] {
        let result = await inserter.insert(text)
        return ["result": .string(result == .pasted ? "pasted" : "copied")]
    }

    public func copy(_ text: String) async throws -> [String: JSONValue] {
        await inserter.copy(text)
        return [:]
    }

    public func selection() async throws -> [String: JSONValue] {
        let text = await selectionReader.selectedText()
        return ["text": text.map(JSONValue.string) ?? .null]
    }

    public func permissions() async throws -> [String: JSONValue] {
        let (accessibility, microphone) = await MainActor.run {
            (Permissions.accessibility, Permissions.microphoneStatusName)
        }
        return ["accessibility": .bool(accessibility), "microphone": .string(microphone)]
    }

    public func requestPermission(_ name: EngineRequest.PermissionName) async throws -> [String: JSONValue] {
        await MainActor.run {
            switch name {
            case .microphone: Permissions.requestMicrophone()
            case .accessibility: Permissions.requestAccessibility()
            }
        }
        return [:]
    }

    /// Runs off the main actor, detached from whatever context dispatched this request: a
    /// Keychain read can block the calling thread outright (e.g. behind a Keychain-unlock
    /// prompt), and must never hold up `context`/`paste`/other main-actor work queued behind it.
    public func secretGet() async throws -> [String: JSONValue] {
        let value = await Task.detached { [secretStore] in secretStore.read() }.value
        return ["value": value.map(JSONValue.string) ?? .null]
    }

    public func secretSet(_ value: String) async throws -> [String: JSONValue] {
        try await Task.detached { [secretStore] in try secretStore.write(value) }.value
        return [:]
    }

    public func secretDelete() async throws -> [String: JSONValue] {
        try await Task.detached { [secretStore] in try secretStore.delete() }.value
        return [:]
    }

    /// Reads v1's real Keychain item (service `com.leigh.dictate`, account `openrouter`) —
    /// always that exact service, never `--keychain-service` (the Preview build's own secret
    /// lives under a different service; this is strictly v1's legacy item for one-time import).
    /// Never writes or deletes it.
    public func legacyKey() async throws -> [String: JSONValue] {
        let key = await Task.detached { [legacyStore] in legacyStore.read() }.value
        return ["key": key.map(JSONValue.string) ?? .null]
    }
}
