import Foundation

/// Terms Whisper and the polisher should spell exactly. Stored one per line.
public struct Vocabulary: Sendable {
    public static let seed = [
        "OpenRouter", "Jira", "Slack", "GitHub", "Figma", "Supabase", "PostgreSQL", "Kubernetes", "Priya",
    ]

    let fileURL: URL

    public init(fileURL: URL) {
        self.fileURL = fileURL
    }

    public func load() -> [String] {
        guard let text = try? String(contentsOf: fileURL, encoding: .utf8) else { return Self.seed }
        return Self.parse(text)
    }

    public func save(_ terms: [String]) throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Self.parse(terms.joined(separator: "\n")).joined(separator: "\n").write(to: fileURL, atomically: true, encoding: .utf8)
    }

    static func parse(_ text: String) -> [String] {
        text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
}
