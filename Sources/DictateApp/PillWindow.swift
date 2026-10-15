import AppKit
import SwiftUI

/// Small floating "Listening…" bubble near the cursor. Never takes focus away from the app being typed into.
@MainActor
final class PillWindow {
    private final class Panel: NSPanel {
        override var canBecomeKey: Bool { false }
        override var canBecomeMain: Bool { false }
    }

    private let panel: Panel
    private let label = PillLabel()
    private var hideWork: DispatchWorkItem?

    init() {
        panel = Panel(contentRect: NSRect(x: 0, y: 0, width: 180, height: 32),
                      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.level = .statusBar
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.ignoresMouseEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.contentView = NSHostingView(rootView: PillView(model: label))
    }

    func show(_ text: String, listening: Bool, fadeAfter: TimeInterval? = nil) {
        hideWork?.cancel()
        hideWork = nil
        label.text = text
        label.listening = listening
        let size = panel.contentView?.fittingSize ?? NSSize(width: 180, height: 32)
        let mouse = NSEvent.mouseLocation
        panel.setFrame(NSRect(x: mouse.x - size.width / 2, y: mouse.y - 24 - size.height, width: size.width, height: size.height), display: true)
        panel.orderFrontRegardless()
        if let fadeAfter {
            let work = DispatchWorkItem { [weak self] in
                self?.panel.orderOut(nil)
                self?.hideWork = nil
            }
            hideWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + fadeAfter, execute: work)
        }
    }

    /// Hides immediately unless a notice is still fading out.
    func hide() {
        guard hideWork == nil else { return }
        panel.orderOut(nil)
    }
}

@MainActor
final class PillLabel: ObservableObject {
    @Published var text = ""
    @Published var listening = false
}

struct PillView: View {
    @ObservedObject var model: PillLabel

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(model.listening ? Color.red : Color.secondary).frame(width: 8, height: 8)
            Text(model.text).font(.system(size: 13, weight: .medium))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(.regularMaterial, in: Capsule())
        .fixedSize()
    }
}
