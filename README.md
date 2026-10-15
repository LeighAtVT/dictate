# Dictate

Press a key, talk, and your words are typed into whatever app you're in: Slack, Gmail, Notes, Jira, a browser, anywhere you can type.

- **Private:** speech is turned into text on your Mac using Whisper, so audio never leaves your computer.
- **Polished (optional):** add an [OpenRouter](https://openrouter.ai) key and each message is tidied up in a style that fits the app you're in: casual for Slack, complete sentences for email, and left raw for terminals and code editors. Only the text is sent, never audio. Without a key, Dictate still removes "um"s and "uh"s on your Mac.
- **Your words:** add names and terms to the Vocabulary list so they're spelled right every time.
- **Edit by voice:** highlight text, hold **Fn + Shift**, and say "make this friendlier" or "shorten it".
- **Shortcuts:** say "my zoom link" (or any phrase you save) and the saved text is pasted exactly.
- **Notes to self:** hold **Fn + Control** to save a quick note without pasting anything.
- **Any language:** speak Spanish (or 17 other languages) and paste in English, or keep the language you spoke.
- **Always on:** if Dictate ever stops unexpectedly, it restarts by itself.

## Requirements

- A Mac with Apple Silicon (M1 or newer)
- macOS 14 Sonoma or newer
- About 600 MB free for the speech model, which downloads once on first launch

## Install

1. Download `Dictate.zip` from the [latest release](../../releases/latest) and double-click it to unzip.
2. Drag **Dictate** into your **Applications** folder.
3. Open Dictate. The app isn't notarized by Apple, so the first launch is blocked:
   - Open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to the Dictate message. Confirm with your password.
   - Or run this in Terminal: `xattr -dr com.apple.quarantine /Applications/Dictate.app`
4. A setup window asks for two permissions:
   - **Microphone**, so it can hear you.
   - **Accessibility**, so it can see which key you pressed and paste the text. Turn Dictate on in the list that opens.
5. Wait for the speech model to finish downloading. Click the menu-bar icon to see its progress.
6. (Optional) Click the menu-bar icon → **Settings… → Polish** and paste your OpenRouter key. It is stored in your Mac's Keychain.

Dictate starts automatically when you log in, and restarts itself if it ever stops for any reason other than **Quit**. If it does, the reason is written to `~/Library/Logs/Dictate/dictate.log`.

After you install a new version, macOS may ask once whether Dictate can use the key saved in your Keychain. Click **Always Allow**.

## Use it

| To | Do this |
|---|---|
| Dictate a message | Hold **Fn** (🌐), talk, then let go |
| Dictate hands-free | Double-tap **Fn**, talk, then tap **Fn** again to finish |
| Cancel | Press **Esc** |
| Rewrite highlighted text | Highlight it, hold **Fn + Shift**, and say how to change it (needs an OpenRouter key) |
| Save a note to self | Hold **Fn + Control** and talk. The note goes to Yardmaster Tasks if it's running, otherwise to `Dictate Notes.md` in your Documents folder |
| Paste saved text | Say a phrase you saved under **Settings… → Shortcuts** |
| Undo a polish | Menu-bar icon → **Paste raw instead** |
| Get back something you said | Menu-bar icon → **History** or **Copy last** |

**Fn already does something on your Mac?** Go to **System Settings → Keyboard**, set **Press 🌐 key to** to **Do Nothing**, and under **Dictation** set the shortcut to **Off**. You can also choose a different key under Dictate's **Settings… → Shortcut**.

In password fields Dictate doesn't record. If no text box is focused, the text is copied so you can paste it with ⌘V.

## Settings

- **Shortcut:** choose the key (Fn, Right Option, Right Command, and others).
- **Polish:** your OpenRouter key and model (default `anthropic/claude-haiku-5.5`).
- **Vocabulary:** names and terms to spell exactly.
- **Shortcuts:** phrases that paste saved text, such as links, addresses, or a sign-off.
- **Language:** what you speak (or Auto-detect) and what to paste in. Translating needs an OpenRouter key.
- **Apps:** choose the style for each app, or turn polish off for an app.

The first note saved to `Dictate Notes.md` makes macOS ask whether Dictate can use your Documents folder.

## Uninstall

1. Click the menu-bar icon → **Quit**.
2. In Terminal, stop Dictate starting at login:
   ```sh
   launchctl bootout gui/$(id -u)/com.leigh.dictate.keepalive
   rm ~/Library/LaunchAgents/com.leigh.dictate.keepalive.plist
   ```
3. Drag **Dictate** from Applications to the Trash. To remove its settings, history and speech model too, delete `~/Library/Application Support/Dictate`.

## Build from source

You only need Apple's Command Line Tools (`xcode-select --install`); full Xcode isn't required.

```sh
scripts/make-signing-cert.sh   # one time: a local signing certificate, so macOS keeps permissions across rebuilds
scripts/test.sh                # run the tests
scripts/build-app.sh           # build, sign, copy to /Applications, and launch
```

## Privacy

- Audio is kept in memory only while you're talking and is never saved or sent anywhere.
- With polish on, only the transcribed text is sent to OpenRouter and the model you picked.
- History (your last 50 messages, deleted after 7 days) is stored only on your Mac in `~/Library/Application Support/Dictate/`.
