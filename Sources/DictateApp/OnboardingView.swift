import AVFoundation
import AppKit
import ApplicationServices
import DictateCore
import SwiftUI

// `Permissions` moved to `Sources/DictateCore/Permissions.swift` (Dictate v2 Mac Preview, Task 5,
// controller ruling R7) so the v2 engine can use it too; behavior here is unchanged.

@MainActor
final class PermissionState: ObservableObject {
    @Published var microphone = Permissions.microphone
    @Published var accessibility = Permissions.accessibility

    func refresh() {
        microphone = Permissions.microphone
        accessibility = Permissions.accessibility
    }
}

struct OnboardingView: View {
    @ObservedObject var state: PermissionState
    @ObservedObject var settings: AppSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Set up Dictate").font(.title2.bold())
            Text("Hold \(settings.hotkey.shortName), talk, let go. Two one-time permissions make that work.")
                .foregroundStyle(.secondary)
            row(granted: state.microphone, title: "Microphone",
                detail: "Listens only while you're dictating. Audio never leaves your Mac.",
                button: "Allow Microphone", action: Permissions.requestMicrophone)
            row(granted: state.accessibility, title: "Accessibility",
                detail: "Lets Dictate notice the \(settings.hotkey.shortName) key and paste where your cursor is.",
                button: "Open Accessibility Settings", action: Permissions.requestAccessibility)
            if state.microphone && state.accessibility {
                Text("All set. You can close this window.").foregroundStyle(.green)
            }
        }
        .padding(24)
        .frame(width: 460)
    }

    private func row(granted: Bool, title: String, detail: String, button: String, action: @escaping () -> Void) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: granted ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(granted ? .green : .secondary)
                .font(.title3)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(detail).font(.callout).foregroundStyle(.secondary)
                if !granted { Button(button, action: action).padding(.top, 2) }
            }
        }
    }
}
