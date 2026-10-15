import AppKit
import ApplicationServices
import Carbon.HIToolbox

public protocol ContextProviding: AnyObject {
    func current() -> AppContext
    func hasFocusedTextField() -> Bool
}

/// Reads the frontmost app, its focused window title and focused element through Accessibility.
public final class FrontmostContext: ContextProviding {
    static let textRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]
    static let axTimeout: Float = 0.25

    private var enabledPIDs: Set<pid_t> = []

    public init() {}

    public func current() -> AppContext {
        let app = NSWorkspace.shared.frontmostApplication
        var title: String?
        if let pid = app?.processIdentifier {
            let axApp = AXUIElementCreateApplication(pid)
            AXUIElementSetMessagingTimeout(axApp, Self.axTimeout)
            // Electron apps (Slack desktop) only expose their accessibility tree when asked.
            if enabledPIDs.insert(pid).inserted {
                AXUIElementSetAttributeValue(axApp, "AXManualAccessibility" as CFString, kCFBooleanTrue)
            }
            if let window: AXUIElement = Self.attribute(axApp, kAXFocusedWindowAttribute) {
                title = Self.attribute(window, kAXTitleAttribute)
            }
        }
        return AppContext(bundleID: app?.bundleIdentifier ?? "", windowTitle: title, secureInput: IsSecureEventInputEnabled())
    }

    public func hasFocusedTextField() -> Bool {
        let bundleID = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system, Self.axTimeout)
        var value: CFTypeRef?
        let err = AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &value)
        guard err == .success, let focused = value, CFGetTypeID(focused) == AXUIElementGetTypeID() else {
            return Self.looksLikeTextTarget(error: err == .success ? .failure : err, role: nil, editable: nil, valueSettable: false, bundleID: bundleID)
        }
        let element = focused as! AXUIElement
        var settable: DarwinBoolean = false
        let canSet = AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success && settable.boolValue
        return Self.looksLikeTextTarget(error: .success, role: Self.attribute(element, kAXRoleAttribute),
                                        editable: Self.attribute(element, "AXEditable"), valueSettable: canSet, bundleID: bundleID)
    }

    /// What the focused element says about its selection through Accessibility.
    public func selection() -> SelectionProbe {
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system, Self.axTimeout)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &value) == .success,
              let focused = value, CFGetTypeID(focused) == AXUIElementGetTypeID() else { return .unknown }
        let element = focused as! AXUIElement
        if let text: String = Self.attribute(element, kAXSelectedTextAttribute), !text.isEmpty { return .text(text) }
        var rangeValue: CFTypeRef?
        var range = CFRange()
        guard AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &rangeValue) == .success,
              let rangeValue, CFGetTypeID(rangeValue) == AXValueGetTypeID(),
              AXValueGetValue(rangeValue as! AXValue, .cfRange, &range) else { return .unknown }
        return range.length == 0 ? .empty : .unknown
    }

    /// Paste unless the target is clearly not a text field. Many apps (Electron, web views) under-report
    /// their focus, and a stray ⌘V is harmless while a missed paste is not, so only Finder copies instead.
    static func looksLikeTextTarget(error: AXError, role: String?, editable: Bool?, valueSettable: Bool, bundleID: String) -> Bool {
        if error == .success, let role, textRoles.contains(role) { return true }
        if editable == true || valueSettable { return true }
        if error != .success && error != .noValue { return true }
        return bundleID != "com.apple.finder"
    }

    static func attribute<T>(_ element: AXUIElement, _ name: String) -> T? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
        return value as? T
    }
}
