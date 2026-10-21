import Foundation

/// An OpenRouter model and how much hidden thinking it may do. Thinking adds latency, and cleanup has 2.5 s.
public struct ModelChoice: Codable, Hashable, Sendable, ExpressibleByStringLiteral {
    public enum Thinking: String, Codable, Sendable, CaseIterable {
        case modelDefault, off, minimal, low

        /// OpenRouter's `reasoning` field, or nil to leave it to the model.
        public var parameter: [String: Any]? {
            switch self {
            case .modelDefault: nil
            case .off: ["enabled": false]
            case .minimal: ["effort": "minimal"]
            case .low: ["effort": "low"]
            }
        }
    }

    public var id: String
    public var thinking: Thinking

    public init(id: String, thinking: Thinking = .modelDefault) {
        self.id = id
        self.thinking = thinking
    }

    public init(stringLiteral id: String) { self.init(id: id) }
}

public struct ModelPreset: Identifiable, Sendable {
    public let name: String
    /// One line for Settings: what it's good at and roughly what it costs.
    public let note: String
    public let choice: ModelChoice
    public var id: String { choice.id }
}

/// Picks from a bake-off on real dictation history (Oct 2026): each graded blind, timed, and priced through
/// OpenRouter with zero-data-retention providers only. The first entry in each list is the default.
public enum ModelCatalog {
    public static let cleanup: [ModelPreset] = [
        ModelPreset(name: "GLM 5.3 Flash", note: "Best cleanup and translation tested. About 3¢ per 1,000 dictations.",
                    choice: ModelChoice(id: "z-ai/glm-5.3-flash", thinking: .minimal)),
        ModelPreset(name: "DeepSeek V4.1 Flash", note: "Nearly as good and just as fast. About 4¢ per 1,000.",
                    choice: ModelChoice(id: "deepseek/deepseek-v4.1-flash", thinking: .off)),
        ModelPreset(name: "Claude Haiku 5.5", note: "Good cleanup, but often leaves Spanish untranslated. About 6¢ per 1,000.",
                    choice: ModelChoice(id: "anthropic/claude-haiku-5.5")),
        ModelPreset(name: "GPT-6 Luna", note: "Good translation, wordier cleanup. About 3¢ per 1,000.",
                    choice: ModelChoice(id: "openai/gpt-6-luna", thinking: .off)),
    ]

    public static let edit: [ModelPreset] = [
        ModelPreset(name: "DeepSeek V4.1 Flash", note: "Best edits for the price, under 2 s. About 3¢ per 1,000 edits.",
                    choice: ModelChoice(id: "deepseek/deepseek-v4.1-flash", thinking: .off)),
        ModelPreset(name: "Claude Haiku 5.5", note: "Close second, under 2 s. About 5¢ per 1,000 edits.",
                    choice: ModelChoice(id: "anthropic/claude-haiku-5.5")),
        ModelPreset(name: "GPT-6 Luna", note: "Most careful rewrites, but takes 4–6 s. About 4¢ per 1,000 edits.",
                    choice: ModelChoice(id: "openai/gpt-6-luna")),
    ]

    public static var defaultCleanup: ModelChoice { cleanup[0].choice }
    public static var defaultEdit: ModelChoice { edit[0].choice }

    /// Before v1.2 one free-text model did everything. The old default moves to the new one; anything else
    /// was typed on purpose, so it stays as a custom cleanup model.
    static let legacyDefault = "anthropic/claude-haiku-5.5"

    public static func migrate(legacy: String?) -> ModelChoice {
        let id = legacy?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return id.isEmpty || id == legacyDefault ? defaultCleanup : ModelChoice(id: id)
    }

    public static func preset(for choice: ModelChoice, in presets: [ModelPreset]) -> ModelPreset? {
        presets.first { $0.choice == choice }
    }
}
