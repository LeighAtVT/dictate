import AppKit
import DictateCore
import SwiftUI

struct SettingsView: View {
    @ObservedObject var settings: AppSettings
    let knownApps: () -> [String]
    let testModel: (ModelChoice) async -> Polisher.CheckResult

    @State private var keyInput = ""
    @State private var vocabText = ""
    @State private var shortcutDrafts: [Shortcut] = []

    var body: some View {
        TabView {
            shortcut.tabItem { Label("Shortcut", systemImage: "keyboard") }
            polish.tabItem { Label("Polish", systemImage: "sparkles") }
            vocabulary.tabItem { Label("Vocabulary", systemImage: "text.book.closed") }
            shortcuts.tabItem { Label("Shortcuts", systemImage: "text.bubble") }
            language.tabItem { Label("Language", systemImage: "globe") }
            apps.tabItem { Label("Apps", systemImage: "app.badge") }
        }
        .padding(20)
        .frame(width: 600, height: 460)
        .onAppear {
            vocabText = settings.vocabulary.joined(separator: "\n")
            shortcutDrafts = settings.shortcuts
        }
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
            Section("More with the same key") {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Highlight text, then hold \(settings.hotkey.shortName) + Shift and say how to change it (\"make this friendlier\", \"shorten it\").")
                    Text("Hold \(settings.hotkey.shortName) + Control for a note to self: it goes to Yardmaster Tasks, or to Dictate Notes.md in Documents.")
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
            Section("Cleanup and translation") {
                ModelPicker(presets: ModelCatalog.cleanup, choice: $settings.model, test: testModel)
            }
            Section("Edit by voice") {
                ModelPicker(presets: ModelCatalog.edit, choice: $settings.editModel, test: testModel)
            }
            Text("Only the transcribed text is sent, never audio, and only to servers that keep nothing.")
                .font(.caption).foregroundStyle(.secondary)
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

    private var shortcuts: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Say the phrase on its own and Dictate pastes the text exactly.").foregroundStyle(.secondary)
            List {
                ForEach($shortcutDrafts) { $shortcut in
                    HStack(alignment: .top) {
                        TextField("Phrase, e.g. my zoom link", text: $shortcut.phrase)
                            .frame(width: 170)
                        TextEditor(text: $shortcut.text)
                            .font(.body)
                            .frame(height: 54)
                            .border(Color.secondary.opacity(0.3))
                        Button(role: .destructive) {
                            shortcutDrafts.removeAll { $0.id == shortcut.id }
                        } label: { Image(systemName: "minus.circle") }
                            .buttonStyle(.borderless)
                    }
                }
            }
            HStack {
                Button("Add shortcut") { shortcutDrafts.append(Shortcut(phrase: "", text: "")) }
                Spacer()
                Button("Save shortcuts") {
                    settings.shortcuts = shortcutDrafts.filter { !$0.phrase.trimmingCharacters(in: .whitespaces).isEmpty }
                    shortcutDrafts = settings.shortcuts
                }
            }
        }
    }

    private var language: some View {
        Form {
            Section {
                Picker("I speak", selection: $settings.spokenLanguage) {
                    Text("English").tag("en")
                    Text("Auto-detect").tag("auto")
                    ForEach(Language.all.filter { $0.code != "en" }) { Text($0.name).tag($0.code) }
                }
                Picker("Paste in", selection: $settings.pasteLanguage) {
                    Text("Same as spoken").tag("same")
                    ForEach(Language.all) { Text($0.name).tag($0.code) }
                }
            }
            Text("Translating needs an OpenRouter key. Without one, Dictate pastes what you said.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .formStyle(.grouped)
    }

    private var apps: some View {
        let ids = Array(Set(knownApps()).union(settings.overrides.keys)).filter { !$0.isEmpty && $0 != "note" }.sorted()
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

/// A recommended OpenRouter model, or any model ID typed in by hand.
private struct ModelPicker: View {
    let presets: [ModelPreset]
    @Binding var choice: ModelChoice
    let test: (ModelChoice) async -> Polisher.CheckResult

    @State private var customID = ""
    @State private var custom = false
    @State private var status: String?
    @State private var testing = false

    private static let customTag = "custom"

    var body: some View {
        Picker("Model", selection: selection) {
            ForEach(presets) { Text($0.id == presets.first?.id ? "\($0.name) (recommended)" : $0.name).tag($0.id) }
            Text("Custom…").tag(Self.customTag)
        }
        if showingCustom {
            TextField("OpenRouter model ID, e.g. openai/gpt-6-sol", text: $customID)
                .onSubmit { useCustom() }
        }
        HStack(alignment: .firstTextBaseline) {
            Text(note).font(.caption).foregroundStyle(.secondary)
            Spacer()
            Button(testing ? "Testing…" : "Test") { runTest() }.disabled(testing || target == nil)
        }
        .onAppear { if preset == nil { customID = choice.id } }
        if let status { Text(status).font(.caption) }
    }

    private var preset: ModelPreset? { ModelCatalog.preset(for: choice, in: presets) }
    private var showingCustom: Bool { custom || preset == nil }
    private var trimmedCustomID: String { customID.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// What Test would check: the typed ID while editing a custom model, otherwise the current choice.
    private var target: ModelChoice? {
        guard showingCustom else { return choice }
        return trimmedCustomID.isEmpty ? nil : ModelChoice(id: trimmedCustomID)
    }

    private var note: String {
        if showingCustom { return "Any model on openrouter.ai/models. Press Return to use it, then Test." }
        return preset?.note ?? ""
    }

    private var selection: Binding<String> {
        Binding(
            get: { showingCustom ? Self.customTag : choice.id },
            set: { tag in
                status = nil
                if let picked = presets.first(where: { $0.id == tag }) {
                    custom = false
                    choice = picked.choice
                } else {
                    custom = true
                    customID = preset == nil ? choice.id : ""
                }
            }
        )
    }

    private func useCustom() {
        guard !trimmedCustomID.isEmpty else { return }
        choice = ModelChoice(id: trimmedCustomID)
    }

    private func runTest() {
        guard let target else { return }
        if showingCustom { useCustom() }
        testing = true
        status = nil
        Task {
            let result = await test(target)
            testing = false
            switch result {
            case .worked(let seconds): status = "✓ Worked in \(seconds.formatted(.number.precision(.fractionLength(1)))) s"
            case .failed(let reason): status = "✗ \(reason)"
            }
        }
    }
}
