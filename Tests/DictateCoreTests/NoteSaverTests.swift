import Foundation
import Testing
@testable import DictateCore

final class RecordingTransport: HTTPTransport, @unchecked Sendable {
    var status = 200
    var delay: TimeInterval = 0
    var shouldThrow = false
    private(set) var requests: [URLRequest] = []
    func send(_ req: URLRequest, timeout: TimeInterval) async throws -> (Data, Int) {
        requests.append(req)
        if delay > 0 { try await Task.sleep(for: .seconds(delay)) }
        if shouldThrow { throw URLError(.cannotConnectToHost) }
        return (Data("{}".utf8), status)
    }
}

@Suite struct NoteSaverTests {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("notes-\(UUID()).md")
    let fixedNow = Date(timeIntervalSince1970: 1_792_000_000)

    func saver(_ t: RecordingTransport, token: String? = "tok", file: URL? = nil, timeout: TimeInterval = 2) -> NoteSaver {
        NoteSaver(transport: t, token: { token }, fileURL: file ?? self.file, now: { [fixedNow] in fixedNow }, timeout: timeout)
    }

    var expectedLine: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH:mm"
        return "- [ ] \(f.string(from: fixedNow)) — Call the dentist\n"
    }

    @Test func shortTextHasNoContext() {
        #expect(NoteSaver.taskBody("Call the dentist") == ["text": "Call the dentist"])
    }

    @Test func longTextIsCutAtAWordAndKeptInContext() throws {
        let long = Array(repeating: "remember", count: 40).joined(separator: " ") // 359 chars
        let body = NoteSaver.taskBody(long)
        let text = try #require(body["text"])
        #expect(text.count <= 200)
        #expect(long.hasPrefix(text))
        #expect(text.hasSuffix("remember"))
        #expect(body["context"] == long)
    }

    @Test func savesToTasks() async throws {
        let t = RecordingTransport()
        #expect(await saver(t).save("Call the dentist") == .tasks)
        let req = try #require(t.requests.first)
        #expect(req.url == NoteSaver.endpoint)
        #expect(req.httpMethod == "POST")
        #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer tok")
        let json = try JSONSerialization.jsonObject(with: try #require(req.httpBody)) as? [String: String]
        #expect(json == ["text": "Call the dentist"])
        #expect(!FileManager.default.fileExists(atPath: file.path))
    }

    @Test func noTokenWritesTheFile() async throws {
        let t = RecordingTransport()
        #expect(await saver(t, token: nil).save("Call the dentist") == .file)
        #expect(t.requests.isEmpty)
        #expect(try String(contentsOf: file, encoding: .utf8) == expectedLine)
    }

    @Test func errorsFallBackToTheFileAndAppend() async throws {
        let t = RecordingTransport()
        t.status = 404
        #expect(await saver(t).save("Call the dentist") == .file)
        t.shouldThrow = true
        #expect(await saver(t).save("Call the dentist") == .file)
        #expect(try String(contentsOf: file, encoding: .utf8) == expectedLine + expectedLine)
    }

    @Test func multiLineNotesStayOneChecklistItem() async throws {
        try Data("# My notes".utf8).write(to: file) // no trailing newline
        #expect(await saver(RecordingTransport(), token: nil).save("Call the dentist\n\nabout Tuesday") == .file)
        let lines = try String(contentsOf: file, encoding: .utf8).split(separator: "\n", omittingEmptySubsequences: false)
        #expect(lines[0] == "# My notes")
        #expect(lines[1].hasSuffix("— Call the dentist about Tuesday"))
    }

    @Test func slowYardmasterFallsBack() async {
        let t = RecordingTransport()
        t.delay = 3
        #expect(await saver(t, timeout: 0.3).save("Call the dentist") == .file)
    }

    @Test func nowhereToSaveReturnsNil() async {
        let unwritable = URL(fileURLWithPath: "/System/dictate-\(UUID()).md")
        #expect(await saver(RecordingTransport(), token: nil, file: unwritable).save("x") == nil)
    }
}
