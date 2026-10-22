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
- **Polish:** your OpenRouter key, and a model for each job: **Cleanup and translation** (default GLM 5.3 Flash) and **Edit by voice** (default DeepSeek V4.1 Flash). Pick a recommended model or type any OpenRouter model ID, then click **Test**. Requests only go to providers that keep nothing.
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
   security delete-generic-password -s com.leigh.dictate -a openrouter   # your saved OpenRouter key
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
- With polish on, only the transcribed text is sent to OpenRouter and the model you picked, and only to providers with zero data retention that don't train on it.
- History (your last 50 messages, deleted after 7 days) is stored only on your Mac in `~/Library/Application Support/Dictate/`.

## Dictate Preview (v2)

Dictate Preview is the next version of Dictate, being tested next to the current one. It does the same job with the same keys and settings, but its menu-bar app and settings windows are rebuilt (in Electron), and the speech-to-text part runs as a small separate program inside the app. It's a preview: expect rough edges, and keep the current Dictate installed so you can switch back.

### Install from a clone

Builds from CI aren't signed with a stable certificate, and macOS forgets an unsigned app's permissions after every update, so for now build it on your own Mac. You need Apple's Command Line Tools (`xcode-select --install`) and Node.js (CI uses Node 26).

```sh
git clone https://github.com/LeighAtVT/dictate.git && cd dictate
scripts/make-signing-cert.sh   # one time, if you haven't already for Dictate
scripts/build-preview.sh       # build, sign, copy to /Applications/Dictate Preview.app, and open
```

On first launch Dictate Preview copies your current Dictate's settings, vocabulary, shortcuts and history, and reuses its downloaded speech model, so there's nothing to set up twice. Your current Dictate's files are only read, never changed. macOS asks once whether Dictate Preview can use the OpenRouter key saved by Dictate; click **Always Allow**.

### Switching between the two

Only one of them should listen at a time. In Dictate Preview's menu-bar menu:

- **Pause old Dictate while testing** quits the current Dictate and stops it starting at login.
- **Switch back to old Dictate** starts the current Dictate again (and at login), and quits Dictate Preview.

### Your OpenRouter key

Polish, Edit by voice and translation use OpenRouter with your own key. If Dictate Preview didn't pick up your key from the current Dictate, paste it under menu-bar icon → **Settings… → Polish**. It's stored in your Mac's Keychain, separately from the current Dictate's.

### Where things are

- Settings, history, vocabulary, shortcuts and the speech model: `~/Library/Application Support/Dictate Preview`
- Log: `~/Library/Logs/Dictate Preview/dictate.log`. Menu-bar icon → **Copy diagnostics** copies a summary to paste into a bug report. It never includes your key or anything you dictated.

### Build and test

```sh
npm --prefix app ci                       # one time: the app's dependencies
npm --prefix app test                     # the app's tests
npm --prefix app run typecheck
scripts/test.sh                           # the Swift tests (the speech-model tests skip if the model isn't downloaded)
scripts/build-preview.sh --no-open        # build and install, but don't open
scripts/build-preview.sh --no-install     # build and zip only, to app/dist/Dictate-Preview-mac.zip
```

`scripts/build-preview.sh` signs with the "Dictate Local Signing" certificate. Set `DICTATE_SIGN_IDENTITY` to use another identity, or to `-` for an ad hoc signature (the zip is then named `Dictate-Preview-mac-UNSIGNED.zip`). Every push runs the app's tests on macOS and Windows and the Swift tests and build on macOS, and keeps the built zip as a download on the run's page.
