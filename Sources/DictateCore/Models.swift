import Foundation

/// How dictated text is treated for a given target app.
public enum Style: String, Codable, Sendable, CaseIterable {
    case slack, email, docs, raw, off
}

/// Where the text is going, captured at key-down.
public struct AppContext: Equatable, Sendable {
    public var bundleID: String
    public var windowTitle: String?
    public var secureInput: Bool

    public init(bundleID: String, windowTitle: String? = nil, secureInput: Bool = false) {
        self.bundleID = bundleID
        self.windowTitle = windowTitle
        self.secureInput = secureInput
    }
}

public struct HistoryEntry: Codable, Equatable, Sendable {
    public var date: Date
    public var bundleID: String
    public var raw: String
    public var final: String

    public init(date: Date, bundleID: String, raw: String, final: String) {
        self.date = date
        self.bundleID = bundleID
        self.raw = raw
        self.final = final
    }
}
