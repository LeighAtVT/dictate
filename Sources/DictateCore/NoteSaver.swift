import Foundation

public enum NoteDestination: Sendable, Equatable {
    case tasks, file
}

public protocol NoteSaving: Sendable {
    /// Where the note went, or nil when it couldn't be saved anywhere.
    func save(_ text: String) async -> NoteDestination?
}

/// Saves a note to self as a Yardmaster task, or appends it to a Markdown file when Yardmaster isn't running.
public struct NoteSaver: NoteSaving {
    public static let endpoint = URL(string: "http://127.0.0.1:19519/tasks-v2/create")!
    static let maxTaskLength = 200

    let transport: HTTPTransport
    let token: @Sendable () -> String?
    let fileURL: URL
    let now: @Sendable () -> Date
    let timeout: TimeInterval

    public init(transport: HTTPTransport, token: @escaping @Sendable () -> String?, fileURL: URL,
                now: @escaping @Sendable () -> Date = { Date() }, timeout: TimeInterval = 2) {
        self.transport = transport
        self.token = token
        self.fileURL = fileURL
        self.now = now
        self.timeout = timeout
    }

    public func save(_ text: String) async -> NoteDestination? {
        if await saveToTasks(text) { return .tasks }
        return appendToFile(text) ? .file : nil
    }

    /// Task text is capped at 200 characters, cut at a word; the full note goes in `context` when cut.
    public static func taskBody(_ text: String) -> [String: String] {
        guard text.count > maxTaskLength else { return ["text": text] }
        let head = String(text.prefix(maxTaskLength))
        let cut = head.lastIndex(where: { $0.isWhitespace }).map { String(head[..<$0]) } ?? head
        return ["text": cut.trimmingCharacters(in: .whitespaces), "context": text]
    }

    /// $YARDMASTER_CLI_TOKEN, else ~/.yardmaster/cli-token.
    public static func defaultToken() -> String? {
        if let env = ProcessInfo.processInfo.environment["YARDMASTER_CLI_TOKEN"], !env.isEmpty { return env }
        let file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".yardmaster/cli-token")
        let token = (try? String(contentsOf: file, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
        return token?.isEmpty == false ? token : nil
    }

    private func saveToTasks(_ text: String) async -> Bool {
        guard let token = token(), let body = try? JSONSerialization.data(withJSONObject: Self.taskBody(text)) else { return false }
        var req = URLRequest(url: Self.endpoint)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        guard let (_, status) = await withDeadline(timeout, { [transport, timeout, req] in try await transport.send(req, timeout: timeout) }) else { return false }
        return (200..<300).contains(status)
    }

    private func appendToFile(_ text: String) -> Bool {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH:mm"
        // One checklist item per note, even when the note has paragraphs.
        let oneLine = text.split(whereSeparator: \.isNewline).joined(separator: " ")
        let line = "- [ ] \(f.string(from: now())) — \(oneLine)\n"
        let fm = FileManager.default
        if !fm.fileExists(atPath: fileURL.path) {
            return (try? Data(line.utf8).write(to: fileURL, options: .atomic)) != nil
        }
        guard let handle = try? FileHandle(forUpdating: fileURL) else { return false }
        defer { try? handle.close() }
        guard let end = try? handle.seekToEnd() else { return false }
        var needsBreak = false
        if end > 0, (try? handle.seek(toOffset: end - 1)) != nil, let last = try? handle.read(upToCount: 1) {
            needsBreak = last != Data("\n".utf8)
        }
        guard (try? handle.seekToEnd()) != nil else { return false }
        return (try? handle.write(contentsOf: Data(((needsBreak ? "\n" : "") + line).utf8))) != nil
    }
}
