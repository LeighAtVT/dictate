# Dictate acceptance checklist

Hold **Right Option**, speak, release. Tick each line when it behaves as described.

| # | Where | What to do | Expected |
|---|---|---|---|
| 1 | Slack desktop | Dictate "um can you ask Priya if the Supabase migration finished" | Casual, clean sentence, "Priya" and "Supabase" spelled right |
| 2 | Gmail in Chrome | Dictate a two-sentence reply | Complete, lightly formal sentences |
| 3 | Jira in Chrome | Dictate a ticket comment | Clear, neutral text |
| 4 | Google Docs | Dictate a paragraph | Clear, neutral text |
| 5 | Terminal | Dictate "list the files" | Exact words, no polish |
| 6 | Apple Notes | Dictate anything | Text appears |
| 7 | Any password field | Hold Right Option | Bubble says "Password field — skipped"; nothing typed |
| 8 | Any text field | Type ⌥-characters (e.g. Right Option + 2 for ™) | Character typed, no dictation |
| 9 | Wi-Fi off | Dictate in Slack | Unpolished but cleaned text still pastes |
| 10 | Clipboard | Copy an image, dictate, then ⌘V | The image pastes, not the dictation |
| 11 | Click away | Start dictating, click another app before releasing | "Copied — press ⌘V"; text on clipboard |
| 12 | Silence | Hold the key 2 s without speaking | "Didn't catch that"; nothing typed |
| 13 | Menu bar | Paste raw instead / Copy last / History | Each works |
| 14 | Wispr Flow | Quit Wispr Flow (both use Fn) | Only Dictate responds to Fn |
| 15 | Rebuild | Run `scripts/build-app.sh` again | No new Microphone/Accessibility prompts (macOS may ask once to use the Keychain key: click Always Allow) |
| 16 | Speed | Console.app, filter "com.leigh.dictate" | total under 1.5 s raw / 3 s polished |
| 17 | Crash recovery | `kill -9` the Dictate process | Back within ~10 s; `~/Library/Logs/Dictate/dictate.log` says "previous run ended unexpectedly" |
| 18 | Quit | Menu → Quit | Stays closed; opening Dictate starts it again |
| 19 | Voice edit | Highlight a paragraph in Slack, hold Fn + Shift, say "make this friendlier" | Paragraph replaced with the rewrite |
| 20 | Voice edit, no selection | Hold Fn + Shift with nothing highlighted | "Highlight text first"; nothing changes |
| 21 | Note to self | Hold Fn + Control, say "call the dentist tomorrow" | "Saved to Tasks"; task appears in Yardmaster |
| 22 | Note without Yardmaster | Quit Yardmaster, repeat 21 | "Saved to Dictate Notes"; line added to ~/Documents/Dictate Notes.md |
| 23 | Shortcut | Add "my zoom link" in Settings → Shortcuts, then say it | The saved link pastes exactly |
| 24 | Translate | Settings → Language: I speak Spanish, Paste in English; say a Spanish sentence | English pastes |
