import DictateCore
import Foundation

/// User preferences that aren't secrets. The OpenRouter key lives in the Keychain, never here.
@MainActor
final class AppSettings: ObservableObject {
    private let defaults = UserDefaults.standard
    let keychain = KeychainStore()
    /// Read once, off the main thread: after an update macOS may ask to allow Keychain access, and
    /// Dictate must keep working (unpolished) while that prompt waits.
    let apiKey: CachedSecret
    let vocabularyStore: Vocabulary
    let shortcutStore: ShortcutStore

    /// Cleanup and translation.
    @Published var model: ModelChoice { didSet { save(model, forKey: "cleanupModel") } }
    @Published var editModel: ModelChoice { didSet { save(editModel, forKey: "editModel") } }
    @Published var overrides: [String: Style] {
        didSet { defaults.set(overrides.mapValues(\.rawValue), forKey: "styleOverrides") }
    }
    @Published var hotkey: Hotkey { didSet { defaults.set(hotkey.rawValue, forKey: "hotkey") } }
    @Published var vocabulary: [String] { didSet { try? vocabularyStore.save(vocabulary) } }
    @Published var shortcuts: [Shortcut] { didSet { try? shortcutStore.save(shortcuts) } }
    @Published var spokenLanguage: String { didSet { defaults.set(spokenLanguage, forKey: "spokenLanguage") } }
    @Published var pasteLanguage: String { didSet { defaults.set(pasteLanguage, forKey: "pasteLanguage") } }
    @Published private(set) var hasKey: Bool

    init(supportDirectory: URL) {
        vocabularyStore = Vocabulary(fileURL: supportDirectory.appendingPathComponent("vocabulary.txt"))
        model = Self.load("cleanupModel", from: defaults) ?? ModelCatalog.migrate(legacy: defaults.string(forKey: "polishModel"))
        editModel = Self.load("editModel", from: defaults) ?? ModelCatalog.defaultEdit
        let raw = defaults.dictionary(forKey: "styleOverrides") as? [String: String] ?? [:]
        overrides = raw.compactMapValues(Style.init(rawValue:))
        hotkey = defaults.string(forKey: "hotkey").flatMap(Hotkey.init(rawValue:)) ?? .default
        vocabulary = vocabularyStore.load()
        shortcutStore = ShortcutStore(fileURL: supportDirectory.appendingPathComponent("shortcuts.json"))
        shortcuts = shortcutStore.load()
        spokenLanguage = defaults.string(forKey: "spokenLanguage") ?? LanguageSettings.default.spoken
        pasteLanguage = defaults.string(forKey: "pasteLanguage") ?? LanguageSettings.default.paste
        let keychain = keychain
        apiKey = CachedSecret { keychain.read() }
        hasKey = false
        // Assignments in init skip didSet, so write migrated or default models now; a later catalog
        // reorder then can't silently switch anyone's model.
        if defaults.data(forKey: "cleanupModel") == nil { save(model, forKey: "cleanupModel") }
        if defaults.data(forKey: "editModel") == nil { save(editModel, forKey: "editModel") }
        Task.detached { [apiKey] in
            let found = apiKey.value() != nil
            await MainActor.run { [weak self] in self?.hasKey = found }
        }
    }

    func saveKey(_ key: String) {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            if trimmed.isEmpty { try keychain.delete() } else { try keychain.write(trimmed) }
            apiKey.set(trimmed.isEmpty ? nil : trimmed)
            hasKey = !trimmed.isEmpty
        } catch {}
    }

    private func save(_ choice: ModelChoice, forKey key: String) {
        defaults.set(try? JSONEncoder().encode(choice), forKey: key)
    }

    private static func load(_ key: String, from defaults: UserDefaults) -> ModelChoice? {
        defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(ModelChoice.self, from: $0) }
    }

    var router: StyleRouter { StyleRouter(overrides: overrides) }
    var language: LanguageSettings { LanguageSettings(spoken: spokenLanguage, paste: pasteLanguage) }
}
