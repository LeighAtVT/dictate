import AppKit
import DictateCore
import SwiftUI

struct SettingsView: View {
    @ObservedObject var settings: AppSettings
    let knownApps: () -> [String]

    @State private var keyInput = ""
    @State private var vocabText = ""

    var body: some View {
        TabView {
            shortcut.tabItem { Label("Shortcut", systemImage: "keyboard") }
            polish.tabItem { Label("Polish", systemImage: "sparkles") }
            vocabulary.tabItem { Label("Vocabulary", systemImage: "text.book.closed") }
            apps.tabItem { Label("Apps", systemImage: "app.badge") }
        }
        .padding(20)
        .frame(width: 520, height: 420)
        .onAppear { vocabText = settings.vocabulary.joined(separator: "\n") }
    }

    private var shortcut: some View {
        Form {
            Section("Dictation key") {
                Picker("Key", selection: $settings.hotkey) {
                    ForEach(Hotkey.allCases, id: \.self) { Text($0.displayName).tag($0) }
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Hold \(settings.hotkey.shortName) to talk, let go to paste.")
                    Text("Double-tap \(settings.hotkey.shortName) to keep listening hands-free; tap once more to paste, or press Esc to cancel.")
                }
                .font(.callout)
            }
            if settings.hotkey == .fn {
                Section("Fn needs one macOS setting") {
                    Text("Set System Settings → Keyboard → \"Press 🌐 key to\" → Do Nothing, or macOS will open the emoji picker or its own dictation too. If Wispr Flow is still installed, quit it, since it also uses Fn.")
                        .font(.callout)
                    Button("Open Keyboard Settings") {
                        if let url = URL(string: "x-apple.systempreferences:com.apple.Keyboard-Settings.extension") {
                            NSWorkspace.shared.open(url)
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    private var polish: some View {
        Form {
            Section("OpenRouter key") {
                SecureField("Paste your OpenRouter key", text: $keyInput)
                HStack {
                    Button("Save key") { settings.saveKey(keyInput); keyInput = "" }
                        .disabled(keyInput.trimmingCharacters(in: .whitespaces).isEmpty)
                    if settings.hasKey {
                        Text("Key saved ✓").foregroundStyle(.green)
                        Spacer()
                        Button("Remove key", role: .destructive) { settings.saveKey("") }
                    } else {
                        Text("No key: text is cleaned locally only.").foregroundStyle(.secondary)
                    }
                }
            }
            Section("Model") {
                TextField("OpenRouter model", text: $settings.model)
                Text("Only the transcribed text is sent, never audio.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    private var vocabulary: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Names and terms to spell exactly, one per line.").foregroundStyle(.secondary)
            TextEditor(text: $vocabText)
                .font(.body.monospaced())
                .border(Color.secondary.opacity(0.3))
            Button("Save vocabulary") {
                settings.vocabulary = vocabText.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            }
        }
    }

    private var apps: some View {
        let ids = Array(Set(knownApps()).union(settings.overrides.keys)).filter { !$0.isEmpty }.sorted()
        return VStack(alignment: .leading, spacing: 8) {
            Text("Choose how text is handled in each app. \"Off\" never sends text off your Mac.").foregroundStyle(.secondary)
            List(ids, id: \.self) { id in
                HStack {
                    Text(id).lineLimit(1)
                    Spacer()
                    Picker("", selection: binding(for: id)) {
                        Text("Automatic").tag(Style?.none)
                        ForEach(Style.allCases, id: \.self) { Text($0.rawValue.capitalized).tag(Style?.some($0)) }
                    }
                    .frame(width: 140)
                }
            }
        }
    }

    private func binding(for id: String) -> Binding<Style?> {
        Binding(get: { settings.overrides[id] }, set: { settings.overrides[id] = $0 })
    }
}
