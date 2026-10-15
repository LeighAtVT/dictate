import Foundation

/// Deterministic, offline cleanup: used for raw/off styles and whenever polish is unavailable.
public enum LocalCleaner {
    private static let rules: [(pattern: String, template: String)] = [
        // "like" is a filler only when set off by commas: "it was, like, fast".
        (#"(?i),\s*like\s*,"#, " "),
        (#"(?i)(,\s*)?\b(um+|uh+|er|ah|hmm+)\b(\s*,)?"#, " "),
        // Stutters: "the the" -> "the".
        (#"(?i)\b(\w+)(\s+\1\b)+"#, "$1"),
        (#"\s+"#, " "),
        (#"\s+([,.!?;:])"#, "$1"),
        (#"^[\s,;:]+"#, ""),
    ]

    /// Removes Whisper's non-speech annotations: "[BLANK_AUDIO]", "[MUSIC]", "(coughs)", "*laughs*".
    public static func stripAnnotations(_ text: String) -> String {
        text.replacingOccurrences(of: #"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    public static func clean(_ text: String) -> String {
        var s = text
        for rule in rules {
            s = s.replacingOccurrences(of: rule.pattern, with: rule.template, options: .regularExpression)
        }
        s = s.trimmingCharacters(in: .whitespaces)
        guard let first = s.first else { return "" }
        return first.uppercased() + s.dropFirst()
    }

    /// Rewrites vocabulary terms to their exact spelling ("JIRA" -> "Jira"), matching whole words only.
    public static func applyVocabulary(_ text: String, terms: [String]) -> String {
        var s = text
        for term in terms.map({ $0.trimmingCharacters(in: .whitespaces) }) where !term.isEmpty {
            let pattern = "(?i)\\b" + NSRegularExpression.escapedPattern(for: term) + "\\b"
            s = s.replacingOccurrences(of: pattern, with: NSRegularExpression.escapedTemplate(for: term), options: .regularExpression)
        }
        return s
    }
}
