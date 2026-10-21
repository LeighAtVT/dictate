import Foundation

// Dictate v2, Task 3: dispatches JSON-line requests (spec section 2.3) to one
// async closure per `EngineRequest` op, writing exactly one reply line per
// request. Each request runs in its own `Task` so a slow op (e.g. a
// transcription in progress) never delays another request's reply.

/// Thrown by a `Handlers` closure that hasn't been wired up yet (an op this
/// build doesn't implement). Its `description` never includes request
/// contents, so it's safe to put directly into an `EngineReply.error`.
public struct HandlerNotImplemented: Error, CustomStringConvertible {
    public let op: String
    public init(op: String) { self.op = op }
    public var description: String { "\(op) not implemented" }
}

/// One async closure per `EngineRequest` op (brief: "so tests inject
/// fakes"). Each closure returns the fields for that op's `EngineReply.ok`
/// (e.g. `stopRecording`'s closure returns `result`/`text`/`seconds`); a
/// thrown error becomes `EngineReply.error`. Every closure defaults to
/// throwing `HandlerNotImplemented`, so a build that only wires up some ops
/// (as this task's `main.swift` does for the speech ops) fails loudly and
/// honestly for the rest instead of pretending to succeed.
public struct Handlers: Sendable {
    public var startRecording: @Sendable () async throws -> [String: JSONValue]
    public var cancelRecording: @Sendable () async throws -> [String: JSONValue]
    public var stopRecording: @Sendable (_ language: String, _ vocabulary: [String]) async throws -> [String: JSONValue]
    public var context: @Sendable () async throws -> [String: JSONValue]
    public var selection: @Sendable () async throws -> [String: JSONValue]
    public var paste: @Sendable (_ text: String) async throws -> [String: JSONValue]
    public var copy: @Sendable (_ text: String) async throws -> [String: JSONValue]
    public var setHotkey: @Sendable (_ key: String) async throws -> [String: JSONValue]
    public var permissions: @Sendable () async throws -> [String: JSONValue]
    public var requestPermission: @Sendable (_ name: EngineRequest.PermissionName) async throws -> [String: JSONValue]
    public var secretGet: @Sendable () async throws -> [String: JSONValue]
    public var secretSet: @Sendable (_ value: String) async throws -> [String: JSONValue]
    public var secretDelete: @Sendable () async throws -> [String: JSONValue]
    public var legacyKey: @Sendable () async throws -> [String: JSONValue]
    public var quit: @Sendable () async throws -> [String: JSONValue]

    public init(
        startRecording: @escaping @Sendable () async throws -> [String: JSONValue] = { throw HandlerNotImplemented(op: "startRecording") },
        cancelRecording: @escaping @Sendable () async throws -> [String: JSONValue] = { throw HandlerNotImplemented(op: "cancelRecording") },
        stopRecording: @escaping @Sendable (String, [String]) async throws -> [String: JSONValue] = { _, _ in throw HandlerNotImplemented(op: "stopRecording") },
        context: @escaping @Sendable () async throws -> [String: JSONValue] = { throw HandlerNotImplemented(op: "context") },
        selection: @escaping @Sendable () async throws -> [String: JSONValue] = { throw HandlerNotImplemented(op: "selection") },
        paste: @escaping @Sendable (String) async throws -> [String: JSONValue] = { _ in throw HandlerNotImplemented(op: "paste") },
        copy: @escaping @Sendable (String) async throws -> [String: JSONValue] = { _ in throw HandlerNotImplemented(op: "copy") },
        setHotkey: @escaping @Sendable (String) async throws -> [String: JSONValue] = { _ in throw HandlerNotImplemented(op: "setHotkey") },
        permissions: @escaping @Sendable () async throws -> [String: JSONValue] = { throw HandlerNotImplemented(op: "permissions") },
        requestPermission: @escaping @Sendable (EngineRequest.PermissionName) async throws -> [String: JSONValue] = { _ in throw HandlerNotImplemented(op: "requestPermission") },
        secretGet: @escaping @Sendable () async throws -> [String: JSONValue] = { throw HandlerNotImplemented(op: "secret.get") },
        secretSet: @escaping @Sendable (String) async throws -> [String: JSONValue] = { _ in throw HandlerNotImplemented(op: "secret.set") },
        secretDelete: @escaping @Sendable () async throws -> [String: JSONValue] = { throw HandlerNotImplemented(op: "secret.delete") },
        legacyKey: @escaping @Sendable () async throws -> [String: JSONValue] = { throw HandlerNotImplemented(op: "legacyKey") },
        quit: @escaping @Sendable () async throws -> [String: JSONValue] = { throw HandlerNotImplemented(op: "quit") }
    ) {
        self.startRecording = startRecording
        self.cancelRecording = cancelRecording
        self.stopRecording = stopRecording
        self.context = context
        self.selection = selection
        self.paste = paste
        self.copy = copy
        self.setHotkey = setHotkey
        self.permissions = permissions
        self.requestPermission = requestPermission
        self.secretGet = secretGet
        self.secretSet = secretSet
        self.secretDelete = secretDelete
        self.legacyKey = legacyKey
        self.quit = quit
    }
}

/// Reads one JSON-line request at a time (via `receive(_:)`) and writes
/// replies through `output`. `output` is also used for the one `log` event
/// a malformed line produces. Callers (main.swift) are responsible for
/// serializing concurrent `output` calls onto one stdout writer — `Server`
/// itself doesn't buffer or reorder lines.
public final class Server: Sendable {
    private let output: @Sendable (String) -> Void
    private let handlers: Handlers

    public init(output: @escaping @Sendable (String) -> Void, handlers: Handlers) {
        self.output = output
        self.handlers = handlers
    }

    /// The wire envelope `{id, op, ...}` carries `id` outside `EngineRequest`'s
    /// own shape (see `Protocol.swift`'s doc comment on `EngineRequest`), so
    /// it's decoded separately here.
    private struct Envelope: Decodable {
        let id: Int
    }

    public func receive(_ line: String) {
        let data = Data(line.utf8)
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: data) else {
            // No `id` to reply to: a bad line (invalid JSON, or valid JSON
            // missing `id`) is reported as a log event only, never a reply.
            // The line's content isn't included: a request line can carry
            // `paste`/`secret.set` text, which must never reach a log.
            output(encodeLine(EngineEvent.log(message: "malformed request: \(data.count) bytes, no valid id")))
            return
        }
        guard let request = try? JSONDecoder().decode(EngineRequest.self, from: data) else {
            output(encodeLine(EngineReply.error(envelope.id, "unknown op")))
            return
        }
        Task {
            await self.dispatch(id: envelope.id, request: request)
        }
    }

    private func dispatch(id: Int, request: EngineRequest) async {
        do {
            let fields: [String: JSONValue]
            switch request {
            case .startRecording:
                fields = try await handlers.startRecording()
            case .cancelRecording:
                fields = try await handlers.cancelRecording()
            case .stopRecording(let language, let vocabulary):
                fields = try await handlers.stopRecording(language, vocabulary)
            case .context:
                fields = try await handlers.context()
            case .selection:
                fields = try await handlers.selection()
            case .paste(let text):
                fields = try await handlers.paste(text)
            case .copy(let text):
                fields = try await handlers.copy(text)
            case .setHotkey(let key):
                fields = try await handlers.setHotkey(key)
            case .permissions:
                fields = try await handlers.permissions()
            case .requestPermission(let name):
                fields = try await handlers.requestPermission(name)
            case .secretGet:
                fields = try await handlers.secretGet()
            case .secretSet(let value):
                fields = try await handlers.secretSet(value)
            case .secretDelete:
                fields = try await handlers.secretDelete()
            case .legacyKey:
                fields = try await handlers.legacyKey()
            case .quit:
                fields = try await handlers.quit()
            }
            output(encodeLine(EngineReply.ok(id, fields)))
        } catch {
            output(encodeLine(EngineReply.error(id, "\(error)")))
        }
    }
}
