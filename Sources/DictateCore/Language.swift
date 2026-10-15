import Foundation

public struct Language: Hashable, Identifiable, Sendable {
    public let code: String
    public let name: String
    public var id: String { code }

    public static let all: [Language] = [
        ("en", "English"), ("es", "Spanish"), ("fr", "French"), ("de", "German"), ("pt", "Portuguese"),
        ("it", "Italian"), ("nl", "Dutch"), ("pl", "Polish"), ("ru", "Russian"), ("uk", "Ukrainian"),
        ("tr", "Turkish"), ("ar", "Arabic"), ("hi", "Hindi"), ("zh", "Chinese"), ("ja", "Japanese"),
        ("ko", "Korean"), ("vi", "Vietnamese"), ("tl", "Tagalog"),
    ].map { Language(code: $0.0, name: $0.1) }

    public static func name(for code: String) -> String? {
        all.first { $0.code == code }?.name
    }
}

/// The language the polished text should be written in.
public enum OutputLanguage: Sendable, Equatable {
    case same
    case language(String) // English name, used in the prompt
}

/// "I speak" and "Paste in" from Settings.
public struct LanguageSettings: Sendable, Equatable {
    public var spoken: String // "en", "auto", or a code from Language.all
    public var paste: String // "same" or a code from Language.all

    public static let `default` = LanguageSettings(spoken: "en", paste: "same")

    public init(spoken: String, paste: String) {
        self.spoken = spoken
        self.paste = paste
    }

    public var output: OutputLanguage {
        guard paste != "same", let name = Language.name(for: paste), paste != spoken else { return .same }
        return .language(name)
    }
}
