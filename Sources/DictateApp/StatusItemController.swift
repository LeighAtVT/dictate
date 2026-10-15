import AppKit
import DictateCore

/// Menu-bar icon and menu.
@MainActor
final class StatusItemController: NSObject, NSMenuDelegate {
    enum Icon { case idle, listening, working, warning }

    struct Actions {
        var copyLast: () -> Void
        var pasteRawInstead: () -> Void
        var copyEntry: (HistoryEntry) -> Void
        var openSettings: () -> Void
        var openOnboarding: () -> Void
    }

    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let history: History
    private let actions: Actions
    var hasKey: () -> Bool = { false }
    var permissionsOK: () -> Bool = { true }
    var modelStatus: String?

    init(history: History, actions: Actions) {
        self.history = history
        self.actions = actions
        super.init()
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        set(.idle)
    }

    func set(_ icon: Icon) {
        let (name, tint): (String, NSColor?) = switch icon {
        case .idle: ("mic", nil)
        case .listening: ("mic.fill", .systemRed)
        case .working: ("ellipsis.circle", nil)
        case .warning: ("exclamationmark.triangle", nil)
        }
        item.button?.image = NSImage(systemSymbolName: name, accessibilityDescription: "Dictate")
        item.button?.contentTintColor = tint
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let recent = history.recent()

        if !permissionsOK() {
            menu.addItem(action("Finish setup (permissions needed)…", #selector(openOnboarding)))
            menu.addItem(.separator())
        }
        if let modelStatus {
            let status = NSMenuItem(title: modelStatus, action: nil, keyEquivalent: "")
            status.isEnabled = false
            menu.addItem(status)
            menu.addItem(.separator())
        }

        let copy = action("Copy last", #selector(copyLast))
        copy.isEnabled = !recent.isEmpty
        menu.addItem(copy)
        let raw = action("Paste raw instead", #selector(pasteRaw))
        raw.isEnabled = recent.first.map { $0.raw != $0.final } ?? false
        menu.addItem(raw)

        let historyItem = NSMenuItem(title: "History", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for entry in recent.prefix(10) {
            let title = entry.final.count > 60 ? String(entry.final.prefix(57)) + "…" : entry.final
            let row = action(title, #selector(copyEntry(_:)))
            row.representedObject = entry.final
            sub.addItem(row)
        }
        if recent.isEmpty { sub.addItem(NSMenuItem(title: "Nothing yet", action: nil, keyEquivalent: "")) }
        historyItem.submenu = sub
        menu.addItem(historyItem)
        menu.addItem(.separator())

        if !hasKey() {
            menu.addItem(action("Polish off — add OpenRouter key", #selector(openSettings)))
        }
        menu.addItem(action("Settings…", #selector(openSettings), key: ","))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Dictate", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    }

    private func action(_ title: String, _ selector: Selector, key: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: selector, keyEquivalent: key)
        item.target = self
        return item
    }

    @objc private func copyLast() { actions.copyLast() }
    @objc private func pasteRaw() { actions.pasteRawInstead() }
    @objc private func openSettings() { actions.openSettings() }
    @objc private func openOnboarding() { actions.openOnboarding() }
    @objc private func copyEntry(_ sender: NSMenuItem) {
        guard let text = sender.representedObject as? String,
              let entry = history.recent().first(where: { $0.final == text }) else { return }
        actions.copyEntry(entry)
    }
}
