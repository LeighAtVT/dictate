import Foundation

/// Maps the target app (and, for browsers, the tab title) to a polish style.
public struct StyleRouter: Sendable {
    public var overrides: [String: Style]

    public init(overrides: [String: Style] = [:]) {
        self.overrides = overrides
    }

    static let appStyles: [String: Style] = [
        "com.tinyspeck.slackmacgap": .slack,
        "com.apple.Terminal": .raw,
        "com.googlecode.iterm2": .raw,
        "com.microsoft.VSCode": .raw,
        "com.apple.dt.Xcode": .raw,
        "com.todesktop.230313mzl4w4u92": .raw, // Cursor
        "dev.zed.Zed": .raw,
        "com.mitchellh.ghostty": .raw,
        "com.microsoft.Outlook": .email,
        "com.apple.mail": .email,
    ]

    static let browsers: Set<String> = [
        "com.google.Chrome", "com.apple.Safari", "company.thebrowser.Browser", "org.mozilla.firefox",
    ]

    /// Checked in order against the lowercased window title.
    static let titleStyles: [(needle: String, style: Style)] = [
        ("slack", .slack),
        ("gmail", .email), ("outlook", .email), ("mail", .email),
        ("jira", .docs), ("google docs", .docs), ("confluence", .docs),
    ]

    public func style(for ctx: AppContext) -> Style {
        if ctx.secureInput { return .off }
        if let style = overrides[ctx.bundleID] ?? Self.appStyles[ctx.bundleID] { return style }
        if Self.browsers.contains(ctx.bundleID), let title = ctx.windowTitle?.lowercased(),
           let match = Self.titleStyles.first(where: { title.contains($0.needle) }) {
            return match.style
        }
        return .docs
    }
}
