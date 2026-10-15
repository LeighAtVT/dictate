import DictateCore
import Foundation

/// User preferences that aren't secrets. The OpenRouter key lives in the Keychain, never here.
@MainActor
final class AppSettings: ObservableObject {
    static let defaultModel = "anthropic/claude-haiku-5.5"

    private let defaults = UserDefaults.standard
    let keychain = KeychainStore()
    /// Read once, off the main thread: after an update macOS may ask to allow Keychain access, and
    /// Dictate must keep working (unpolished) while that prompt waits.
    let apiKey: CachedSecret
    let vocabularyStore: Vocabulary

    @Published var model: String { didSet { defaults.set(model, forKey: "polishModel") } }
    @Published var overrides: [String: Style] {
        didSet { defaults.set(overrides.mapValues(\.rawValue), forKey: "styleOverrides") }
    }
    @Published var hotkey: Hotkey { didSet { defaults.set(hotkey.rawValue, forKey: "hotkey") } }
    @Published var vocabulary: [String] { didSet { try? vocabularyStore.save(vocabulary) } }
    @Published private(set) var hasKey: Bool

    init(supportDirectory: URL) {
        vocabularyStore = Vocabulary(fileURL: supportDirectory.appendingPathComponent("vocabulary.txt"))
        model = defaults.string(forKey: "polishModel") ?? Self.defaultModel
        let raw = defaults.dictionary(forKey: "styleOverrides") as? [String: String] ?? [:]
        overrides = raw.compactMapValues(Style.init(rawValue:))
        hotkey = defaults.string(forKey: "hotkey").flatMap(Hotkey.init(rawValue:)) ?? .default
        vocabulary = vocabularyStore.load()
        let keychain = keychain
        apiKey = CachedSecret { keychain.read() }
        hasKey = false
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

    var router: StyleRouter { StyleRouter(overrides: overrides) }
}
