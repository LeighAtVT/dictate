import Foundation

/// A phrase that, said on its own, pastes saved text exactly.
public struct Shortcut: Codable, Equatable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var phrase: String
    public var text: String

    public init(id: UUID = UUID(), phrase: String, text: String) {
        self.id = id
        self.phrase = phrase
        self.text = text
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        phrase = try c.decode(String.self, forKey: .phrase)
        text = try c.decode(String.self, forKey: .text)
    }
}

public struct ShortcutStore: Sendable {
    let fileURL: URL

    public init(fileURL: URL) {
        self.fileURL = fileURL
    }

    public func load() -> [Shortcut] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        return (try? JSONDecoder().decode([Shortcut].self, from: data)) ?? []
    }

    public func save(_ shortcuts: [Shortcut]) throws {
        let kept = shortcuts.filter { !$0.phrase.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try encoder.encode(kept).write(to: fileURL, options: .atomic)
    }
}

public enum ShortcutMatcher {
    /// Lowercase, punctuation and symbols removed, whitespace collapsed.
    public static func normalize(_ s: String) -> String {
        let stripped = s.lowercased().unicodeScalars
            .filter { !CharacterSet.punctuationCharacters.contains($0) && !CharacterSet.symbols.contains($0) }
        return String(String.UnicodeScalarView(stripped))
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
    }

    /// The shortcut whose phrase is exactly what was said, ignoring case and punctuation.
    public static func match(_ transcript: String, in shortcuts: [Shortcut]) -> Shortcut? {
        let said = normalize(transcript)
        guard !said.isEmpty else { return nil }
        return shortcuts.first { normalize($0.phrase) == said }
    }
}
