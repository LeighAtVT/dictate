import Foundation

// Dictate v2, Task 2: the JSON-lines protocol spoken between the Electron
// "brain" and this Swift "engine". Both sides are exercised against the same
// fixtures file (app/src/shared/protocol-fixtures.json, mirrored by
// app/src/shared/protocol.ts) so they can't drift apart. See the design
// spec, section 2.3, for the wire format.

/// A JSON value with no fixed Swift shape, used for `EngineReply.ok` fields
/// (e.g. `context`'s reply has different fields than `permissions`'s).
public enum JSONValue: Codable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

/// Mirrors TS `Modifier`.
public enum Modifier: String, Codable, Equatable, Sendable {
    case shift, control, alt, command
}

/// Mirrors TS `ModeAction`.
public enum ModeAction: String, Codable, Equatable, Sendable {
    case dictate, edit, note
}

/// Mirrors TS `EngineEvent`. Encode-only: the engine produces events, it
/// never consumes them.
public enum EngineEvent: Encodable, Equatable, Sendable {
    public enum ModelState: String, Codable, Equatable, Sendable {
        case downloading, loading, ready, failed
    }

    case key(down: Bool, held: [Modifier])
    case modifiers(held: [Modifier])
    case otherKey
    case escape
    case shortcut(action: ModeAction)
    case model(state: ModelState, fraction: Double?)
    case log(message: String)

    private enum CodingKeys: String, CodingKey {
        case event, down, held, action, state, fraction, message
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .key(let down, let held):
            try container.encode("key", forKey: .event)
            try container.encode(down, forKey: .down)
            try container.encode(held, forKey: .held)
        case .modifiers(let held):
            try container.encode("modifiers", forKey: .event)
            try container.encode(held, forKey: .held)
        case .otherKey:
            try container.encode("otherKey", forKey: .event)
        case .escape:
            try container.encode("escape", forKey: .event)
        case .shortcut(let action):
            try container.encode("shortcut", forKey: .event)
            try container.encode(action, forKey: .action)
        case .model(let state, let fraction):
            try container.encode("model", forKey: .event)
            try container.encode(state, forKey: .state)
            try container.encodeIfPresent(fraction, forKey: .fraction)
        case .log(let message):
            try container.encode("log", forKey: .event)
            try container.encode(message, forKey: .message)
        }
    }
}

/// Mirrors TS `EngineRequest`. Decode-only: the engine consumes requests, it
/// never produces them. The wire envelope also carries an `id: Int`
/// (`{id, ...EngineRequest}`, see `encodeRequest` in protocol.ts), but `id`
/// is not part of the request's own shape in either language — decoding
/// simply ignores it here, the same way TS's `EngineRequest` type excludes it.
public enum EngineRequest: Decodable, Equatable, Sendable {
    public enum PermissionName: String, Decodable, Equatable, Sendable {
        case microphone, accessibility
    }

    case startRecording
    case cancelRecording
    case stopRecording(language: String, vocabulary: [String])
    case context
    case selection
    case paste(text: String)
    case copy(text: String)
    case setHotkey(key: String)
    case permissions
    case requestPermission(name: PermissionName)
    case secretGet
    case secretSet(value: String)
    case secretDelete
    case legacyKey
    case quit

    /// The wire `op` string for this request, e.g. `"secret.get"` for `.secretGet`.
    public var op: String {
        switch self {
        case .startRecording: "startRecording"
        case .cancelRecording: "cancelRecording"
        case .stopRecording: "stopRecording"
        case .context: "context"
        case .selection: "selection"
        case .paste: "paste"
        case .copy: "copy"
        case .setHotkey: "setHotkey"
        case .permissions: "permissions"
        case .requestPermission: "requestPermission"
        case .secretGet: "secret.get"
        case .secretSet: "secret.set"
        case .secretDelete: "secret.delete"
        case .legacyKey: "legacyKey"
        case .quit: "quit"
        }
    }

    private enum CodingKeys: String, CodingKey {
        case op, language, vocabulary, text, key, name, value
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let op = try container.decode(String.self, forKey: .op)
        switch op {
        case "startRecording": self = .startRecording
        case "cancelRecording": self = .cancelRecording
        case "stopRecording":
            self = .stopRecording(
                language: try container.decode(String.self, forKey: .language),
                vocabulary: try container.decode([String].self, forKey: .vocabulary)
            )
        case "context": self = .context
        case "selection": self = .selection
        case "paste": self = .paste(text: try container.decode(String.self, forKey: .text))
        case "copy": self = .copy(text: try container.decode(String.self, forKey: .text))
        case "setHotkey": self = .setHotkey(key: try container.decode(String.self, forKey: .key))
        case "permissions": self = .permissions
        case "requestPermission":
            self = .requestPermission(name: try container.decode(PermissionName.self, forKey: .name))
        case "secret.get": self = .secretGet
        case "secret.set": self = .secretSet(value: try container.decode(String.self, forKey: .value))
        case "secret.delete": self = .secretDelete
        case "legacyKey": self = .legacyKey
        case "quit": self = .quit
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .op,
                in: container,
                debugDescription: "Unknown op: \(op)"
            )
        }
    }
}

/// The reply envelope: `{reply: id, ok: true, ...fields}` or
/// `{reply: id, ok: false, error: message}`, mirroring TS's
/// `{reply: id, ok, ...} | {reply: id, ok: false, error}`.
public struct EngineReply: Encodable, Equatable, Sendable {
    public let reply: Int
    public let ok: Bool
    public let fields: [String: JSONValue]
    public let error: String?

    private init(reply: Int, ok: Bool, fields: [String: JSONValue] = [:], error: String? = nil) {
        self.reply = reply
        self.ok = ok
        self.fields = fields
        self.error = error
    }

    public static func ok(_ id: Int, _ fields: [String: JSONValue] = [:]) -> EngineReply {
        EngineReply(reply: id, ok: true, fields: fields)
    }

    public static func error(_ id: Int, _ message: String) -> EngineReply {
        EngineReply(reply: id, ok: false, error: message)
    }

    private enum EnvelopeKeys: String, CodingKey {
        case reply, ok, error
    }

    /// Dynamic keys so `fields` can merge arbitrary reply-shape properties
    /// (`appId`, `text`, `accessibility`, ...) into the same top-level JSON
    /// object as `reply`/`ok`/`error`, matching the flat wire shape.
    private struct FieldKey: CodingKey {
        var stringValue: String
        init?(stringValue: String) { self.stringValue = stringValue }
        var intValue: Int? { nil }
        init?(intValue: Int) { nil }
    }

    public func encode(to encoder: Encoder) throws {
        var envelope = encoder.container(keyedBy: EnvelopeKeys.self)
        try envelope.encode(reply, forKey: .reply)
        try envelope.encode(ok, forKey: .ok)
        if let error {
            try envelope.encode(error, forKey: .error)
        }
        var fieldContainer = encoder.container(keyedBy: FieldKey.self)
        for (key, value) in fields {
            guard let fieldKey = FieldKey(stringValue: key) else { continue }
            try fieldContainer.encode(value, forKey: fieldKey)
        }
    }
}

/// Encodes any `Encodable` protocol value (an `EngineEvent` or `EngineReply`)
/// as a single JSON line: UTF-8 text, no raw newlines (`JSONEncoder` escapes
/// control characters, including the ones inside pasted text).
public func encodeLine(_ value: Encodable) -> String {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(value) else { return "" }
    return String(decoding: data, as: UTF8.self)
}
