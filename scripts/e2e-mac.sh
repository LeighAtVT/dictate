#!/bin/bash
# Dictate v2 end-to-end test on this Mac (Task 11 of the Mac Preview plan). Builds Dictate Preview
# with the engine's test-audio hook (build-preview.sh --e2e), holds Fn with a synthetic key event,
# and checks what lands in a TextEdit document:
#   pass 1: Tests/DictateCoreTests/Fixtures/hello.wav is transcribed and pasted ("Hello…"), and the clipboard is restored
#   pass 2: a spoken shortcut pastes multi-line text with quotes, a dash, and an emoji, exactly
# It also checks, from dictate.log, that the hop v2 adds between the talk key going down and the
# engine being asked to start recording is under 50 ms (Review Focus 1; the microphone's own
# start-up time, the same AudioRecorder code as v1, is reported but not limited — see spec 2.3), and
# that no dictated text reaches the log.
#
# Needs: Accessibility and Microphone granted to Dictate Preview, and Accessibility for whatever
# runs this script (the terminal), so the synthetic Fn press can be posted. TextEdit is driven
# through System Events (the same Accessibility grant), so no Automation permission for TextEdit.
#
# It presses Fn only with the screen unlocked and its own scratch document as TextEdit's front
# window, and stops the app before it can paste if focus moves while Fn is held.
#
# While it runs, v1 Dictate is quit (both apps listen to Fn) and the clipboard is in use. On exit,
# pass or fail, it quits the preview, closes its TextEdit documents without saving, puts back the
# clipboard and the preview's shortcuts/history files, and reopens v1 if it was running.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD

APP="/Applications/Dictate Preview.app"
BUNDLE_ID=com.leigh.dictate.preview
V1_APP=/Applications/Dictate.app
DATA="$HOME/Library/Application Support/Dictate Preview"
LOG="$HOME/Library/Logs/Dictate Preview/dictate.log"
MODEL_NAME=ggml-large-v3-turbo-q5_0.bin
V1_MODEL="$HOME/Library/Application Support/Dictate/models/$MODEL_NAME"
FIXTURE="$ROOT/Tests/DictateCoreTests/Fixtures/hello.wav"
TOOLS="$ROOT/.build/e2e-tools"
SENTINEL="dictate-e2e-sentinel-$RANDOM$RANDOM"
SHORTCUT_TEXT=$'Line one\n\nLine two — “quoted” 🎙️'
GAP_LIMIT_MS=50

say() { echo "e2e: $*"; }
fail() {
  echo "e2e: FAIL: $*" >&2
  exit 1
}

log_lines() { if [ -f "$LOG" ]; then wc -l <"$LOG" | tr -d ' '; else echo 0; fi; }
# Log lines written since line $1.
log_since() { if [ -f "$LOG" ]; then tail -n +"$(($1 + 1))" "$LOG"; fi; }
# wait_for_log <pattern> <since-line> <seconds>
wait_for_log() {
  local tries=$(($3 * 4))
  for _ in $(seq "$tries"); do
    # Not `grep -q`: with pipefail, grep quitting early can fail the pipe on SIGPIPE.
    log_since "$2" | grep -- "$1" >/dev/null && return 0
    sleep 0.25
  done
  return 1
}

preview_running() { pgrep -f "$APP/Contents/MacOS/" >/dev/null; }
v1_running() { pgrep -f "$V1_APP/Contents/MacOS/Dictate" >/dev/null; }

quit_preview() {
  # Only when running: an AppleScript `tell` would otherwise launch it.
  preview_running || return 0
  osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
  for _ in $(seq 40); do
    preview_running || return 0
    sleep 0.25
  done
  pkill -f "$APP/Contents/MacOS/" || true
}

# A locked screen still lets a synthetic paste reach whatever app was in front, so never press Fn
# then: checked up front and again before each press.
assert_unlocked() {
  if ioreg -n Root -d1 | grep '"CGSSessionScreenIsLocked"=Yes' >/dev/null; then
    fail "BLOCKED: the screen is locked; unlock the Mac and run again"
  fi
}
assert_unlocked

# --- 1. Speech model (ruling R15): hard-link v1's, so the engine doesn't download 550 MB ----
mkdir -p "$DATA/models"
if [ ! -e "$DATA/models/$MODEL_NAME" ]; then
  [ -f "$V1_MODEL" ] || fail "no speech model at $V1_MODEL to link"
  ln "$V1_MODEL" "$DATA/models/$MODEL_NAME"
  say "linked v1's speech model (same file, no copy)"
fi

# --- 2. Build ---------------------------------------------------------------------------------
scripts/build-preview.sh --e2e
mkdir -p "$TOOLS"
swiftc -O native/mac/Tools/press-fn.swift -o "$TOOLS/press-fn"
swiftc -O native/mac/Tools/clipboard-snapshot.swift -o "$TOOLS/clipboard-snapshot"

# --- 3. Save what the run touches, and put it all back on exit (ruling R16) --------------------
WORK=$(mktemp -d /tmp/dictate-e2e.XXXXXX)
"$TOOLS/clipboard-snapshot" save "$WORK/clipboard.plist"
for f in shortcuts.json history.json; do
  if [ -e "$DATA/$f" ]; then cp -p "$DATA/$f" "$WORK/$f"; fi
done
TEXTEDIT_WAS_RUNNING=0
pgrep -x TextEdit >/dev/null && TEXTEDIT_WAS_RUNNING=1
V1_WAS_RUNNING=0
v1_running && V1_WAS_RUNNING=1
DOCS=()

# Runs AppleScript lines inside `tell process "TextEdit"` of System Events: UI scripting, which
# needs only Accessibility, rather than scripting TextEdit itself (an Automation permission).
textedit_ui() {
  local args=(-e 'with timeout of 10 seconds' -e 'tell application "System Events"' -e 'tell process "TextEdit"')
  for line in "$@"; do args+=(-e "$line"); done
  osascript "${args[@]}" -e 'end tell' -e 'end tell' -e 'end timeout' 2>&1
}
# The document's window. Its title can gain " — Edited", so match the start.
window_of() { echo "first window whose name starts with \"$1\""; }

# Closes a test document. It's a scratch file in $WORK (deleted on exit), so TextEdit's autosave
# writing to it on close is harmless; if a save sheet still appears, it's dismissed without saving.
close_document() {
  textedit_ui "if not (exists ($(window_of "$1"))) then return" \
    "set w to ($(window_of "$1"))" \
    'click (first button of w whose subrole is "AXCloseButton")' \
    'delay 0.5' \
    'if (exists w) and (exists sheet 1 of w) then' \
    '  repeat with b in {"Don’t Save", "Don'"'"'t Save", "Delete", "Revert Changes"}' \
    '    if exists button b of sheet 1 of w then' \
    '      click button b of sheet 1 of w' \
    '      exit repeat' \
    '    end if' \
    '  end repeat' \
    'end if' >/dev/null
}

cleanup() {
  local status=$?
  # A second Ctrl-C (or a TERM) must not cut the clean-up short.
  trap '' INT TERM HUP
  set +e
  quit_preview
  for doc in "${DOCS[@]+"${DOCS[@]}"}"; do close_document "$doc"; done
  if [ "$TEXTEDIT_WAS_RUNNING" = 0 ] && pgrep -x TextEdit >/dev/null; then
    textedit_ui 'click menu item "Quit TextEdit" of menu 1 of menu bar item "TextEdit" of menu bar 1' >/dev/null
  fi
  for f in shortcuts.json history.json; do
    if [ -e "$WORK/$f" ]; then cp -p "$WORK/$f" "$DATA/$f"; else rm -f "$DATA/$f"; fi
  done
  "$TOOLS/clipboard-snapshot" restore "$WORK/clipboard.plist"
  if [ "$V1_WAS_RUNNING" = 1 ] && ! v1_running; then open -a "$V1_APP"; fi
  rm -rf "$WORK"
  # PASS only when the whole script ran: after a signal, `$?` in this trap can still be 0.
  if [ "$status" = 0 ] && [ "$E2E_DONE" = 1 ]; then
    say PASS
  else
    [ "$status" = 0 ] && status=1
    say "FAILED (exit $status)"
  fi
  exit "$status"
}
E2E_DONE=0
trap cleanup EXIT
# Exit with the conventional status for the signal, so the EXIT trap never sees 0.
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# --- 4. Only one app may listen to Fn: quit v1 (ruling R16) ------------------------------------
if v1_running; then
  osascript -e 'quit app "Dictate"' >/dev/null 2>&1 || true
  for _ in $(seq 40); do
    v1_running || break
    sleep 0.25
  done
  v1_running && fail "v1 Dictate didn't quit"
  say "quit v1 Dictate for the run"
fi
quit_preview
rm -f "$DATA/shortcuts.json"
RUN_START=$(log_lines)

launch_preview() {
  local since
  since=$(log_lines)
  open --env "DICTATE_TEST_AUDIO=$FIXTURE" -a "$APP"
  # Without the hook the engine would record the room, so never press Fn unless it's on.
  wait_for_log "engine: e2e build: test audio replaces the microphone" "$since" 20 ||
    fail "the engine didn't report the test-audio hook; is this an --e2e build?"
  wait_for_log "speech model ready" "$since" 120 || fail "speech model never became ready: $(log_since "$since" | grep 'speech model' | tail -1)"
  wait_for_log "permissions accessibility=" "$since" 10 || fail "no permissions report from the app"
  log_since "$since" | grep "permissions accessibility=true microphone=granted" >/dev/null ||
    fail "Dictate Preview is missing a permission: $(log_since "$since" | grep 'permissions ' | tail -1)"
}

# Opens a new, empty TextEdit document and sets DOC to its name. It's an empty plain-text file in
# the run's temp folder rather than `make new document`: launching TextEdit with a document skips
# its Open panel, which would otherwise sit in front of the new document and take the paste.
new_document() {
  DOC="dictate-e2e-$1.txt"
  : >"$WORK/$DOC"
  DOCS+=("$DOC")
  open -a TextEdit "$WORK/$DOC"
  local answer
  for _ in $(seq 40); do
    answer=$(textedit_ui "exists ($(window_of "$DOC"))" || true)
    [ "$answer" = true ] && return 0
    case "$answer" in
      *-1743* | *-1719* | *-25211*)
        fail "BLOCKED: System Events can't drive TextEdit ($answer). The app running this script needs Accessibility (System Settings → Privacy & Security → Accessibility) and Automation → System Events." ;;
    esac
    sleep 0.25
  done
  fail "TextEdit didn't open $DOC"
}

# Succeeds only when TextEdit is the frontmost app AND its front window is this run's scratch
# document, so the paste can't land in another app or in one of the user's own TextEdit documents.
# On failure, sets FOCUS to what is in front instead.
doc_in_front() {
  local app win
  app=$(osascript -e 'tell application "System Events" to get bundle identifier of first process whose frontmost is true' 2>&1)
  if [ "$app" != com.apple.TextEdit ]; then
    FOCUS="app $app"
    return 1
  fi
  win=$(textedit_ui 'name of window 1')
  if [[ "$win" != "$DOC"* ]]; then
    FOCUS="TextEdit window \"$win\""
    return 1
  fi
}

# Holds Fn for 1.5 s with the document in front; sets DOC_TEXT to the document's text afterwards.
dictate_into_document() {
  local since outcome
  textedit_ui 'set frontmost to true' "perform action \"AXRaise\" of ($(window_of "$DOC"))" >/dev/null
  sleep 0.5
  printf %s "$SENTINEL" | pbcopy
  since=$(log_lines)
  assert_unlocked
  doc_in_front || fail "$DOC isn't the front window ($FOCUS is), so the paste would land elsewhere"
  "$TOOLS/press-fn" 1.5
  # The paste comes after transcription (under a second); if focus moved while Fn was held,
  # kill the app at once so it can't paste into whatever is in front now.
  if ! doc_in_front; then
    pkill -9 -f "$APP/Contents/MacOS/" || true
    fail "focus moved to $FOCUS while Fn was held; stopped Dictate Preview before it could paste"
  fi
  if ! wait_for_log "recording started" "$since" 5; then
    fail "BLOCKED: the synthetic Fn press never started a recording (no 'recording started' in $LOG). The process running this script needs Accessibility to post key events."
  fi
  wait_for_log "dictation " "$since" 60 || fail "the dictation never finished"
  outcome=$(log_since "$since" | grep "dictation " | tail -1)
  say "log: ${outcome#* }"
  [[ "$outcome" == *"dictation skippedSecure"* ]] &&
    fail "the app saw secure input (a password field, or the screen is locked), so it skipped the dictation"
  [[ "$outcome" == *"dictation inserted"* ]] || fail "expected a paste, got: $outcome"
  sleep 1 # the engine restores the clipboard 0.25 s after pasting
  DOC_TEXT=$(textedit_ui "value of text area 1 of scroll area 1 of ($(window_of "$DOC"))")
  [ "$(pbpaste)" = "$SENTINEL" ] || fail "the clipboard wasn't restored after the paste"
}

# --- 5. Pass 1: hello.wav --------------------------------------------------------------------
new_document pass1
launch_preview
dictate_into_document
PASS1_TEXT=$DOC_TEXT
say "pass 1 pasted: $PASS1_TEXT"
grep -qi "hello" <<<"$PASS1_TEXT" || fail "pass 1: expected 'Hello' in the document"
say "pass 1 ok: contains 'Hello', clipboard restored"

# --- 6. Pass 2: a shortcut whose phrase is what pass 1 pasted (Review Focus 5) ----------------
quit_preview
node -e '
  const [file, phrase, text] = process.argv.slice(1)
  require("fs").writeFileSync(file, JSON.stringify([{ id: "e2e-shortcut", phrase, text }], null, 2))
' "$DATA/shortcuts.json" "$PASS1_TEXT" "$SHORTCUT_TEXT"
new_document pass2
launch_preview
dictate_into_document
if [ "$DOC_TEXT" != "$SHORTCUT_TEXT" ]; then
  echo "expected:" >&2; printf %s "$SHORTCUT_TEXT" | xxd >&2
  echo "got:" >&2; printf %s "$DOC_TEXT" | xxd >&2
  fail "pass 2: the document doesn't hold the shortcut text exactly"
fi
say "pass 2 ok: document text equals the shortcut text exactly, clipboard restored"

# --- 7. Key down → recording started (Review Focus 1) -----------------------------------------
# Each line reads "recording started T ms after key down (key down to request H ms, mic start M ms)":
# H is the hop through the brain that v2 adds, M the microphone's own start, as in v1.
STARTS=$(log_since "$RUN_START" | grep "recording started .* after key down" || true)
[ -n "$STARTS" ] || fail "no 'recording started … after key down' lines in $LOG"
sed 's/^/e2e: log: /' <<<"$STARTS"
HOPS=$(sed -n 's/.*key down to request \([0-9.]*\) ms.*/\1/p' <<<"$STARTS")
for hop in $HOPS; do
  awk -v h="$hop" -v limit="$GAP_LIMIT_MS" 'BEGIN { exit !(h < limit) }' ||
    fail "key down to the startRecording request took $hop ms (limit $GAP_LIMIT_MS ms)"
done
say "gap ok: key down → startRecording request under $GAP_LIMIT_MS ms every time ($(echo $HOPS | tr ' ' ',') ms)"

# --- 8. No dictated text in the log ------------------------------------------------------------
if log_since "$RUN_START" | grep -F -e "$PASS1_TEXT" -e "Line one" -e "Line two" >/dev/null; then
  fail "dictated text appeared in $LOG"
fi
say "log ok: no dictated text in dictate.log"

E2E_DONE=1
