import DictateCore
import Foundation

/// User preferences that aren't secrets. The OpenRouter key lives in the Keychain, never here.
@MainActor
final class AppSettings: ObservableObject {
    static let defaultModel = "anthropic/claude-haiku-5.5"

    private let defaults = UserDefaults.standard
    let keychain = KeychainStore()
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
        hasKey = keychain.read() != nil
    }

    func saveKey(_ key: String) {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { try? keychain.delete() } else { try? keychain.write(trimmed) }
        hasKey = keychain.read() != nil
    }

    var router: StyleRouter { StyleRouter(overrides: overrides) }
}
