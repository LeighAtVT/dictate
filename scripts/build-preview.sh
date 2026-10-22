#!/bin/bash
# Build Dictate Preview.app (the v2 Electron shell) plus its signed Swift engine,
# sign everything with the same local identity v1 uses, install to /Applications
# and launch. Started in Task 1 of the Dictate v2 Mac Preview plan; later tasks
# extend this script rather than replacing it.
#
#   scripts/build-preview.sh          release build, installed and opened
#   scripts/build-preview.sh --e2e    adds the engine's test-audio hook (-D DICTATE_E2E, see
#                                     native/mac/EngineKit/Speech.swift) in its own build folder,
#                                     installs, and doesn't open: scripts/e2e-mac.sh launches it
#   scripts/build-preview.sh --no-open release build, installed but not opened (the first launch
#                                     copies v1's data and asks for the Keychain, so a person
#                                     should be there for it)
#   scripts/build-preview.sh --no-install
#                                     release build zipped to app/dist/Dictate-Preview-mac.zip
#                                     (Dictate-Preview-mac-UNSIGNED.zip when ad-hoc signed). Never
#                                     touches /Applications and never quits or opens anything. CI
#                                     uses this.
#
# DICTATE_SIGN_IDENTITY picks the codesign identity. Unset or empty means "Dictate Local Signing"
# (scripts/make-signing-cert.sh). "-" signs ad hoc, for CI builds without the certificate.
set -euo pipefail
cd "$(dirname "$0")/.."

E2E=0
OPEN=1
INSTALL=1
for arg in "$@"; do
  case "$arg" in
    --e2e) E2E=1; OPEN=0 ;;
    --no-open) OPEN=0 ;;
    --no-install) INSTALL=0; OPEN=0 ;;
    *) echo "usage: $0 [--e2e] [--no-open] [--no-install]" >&2; exit 2 ;;
  esac
done
if [ "$E2E" = 1 ] && [ "$INSTALL" = 0 ]; then
  # The e2e build carries the test-audio hook, so it's never zipped for anyone to install.
  echo "error: --e2e and --no-install can't be combined" >&2
  exit 2
fi

IDENTITY="${DICTATE_SIGN_IDENTITY:-Dictate Local Signing}"
APP_NAME="Dictate Preview.app"
INSTALLED="/Applications/$APP_NAME"
if [ "$IDENTITY" = "-" ]; then ZIP_NAME="Dictate-Preview-mac-UNSIGNED.zip"; else ZIP_NAME="Dictate-Preview-mac.zip"; fi

# --- Engine (Swift, release) --------------------------------------------
# The e2e build gets its own scratch folder so switching between the two never mixes objects
# built with and without -D DICTATE_E2E. Release builds never contain the test-audio code.
SWIFT_FLAGS=(-c release)
if [ "$E2E" = 1 ]; then SWIFT_FLAGS+=(--scratch-path .build/e2e -Xswiftc -DDICTATE_E2E); fi
swift build "${SWIFT_FLAGS[@]}" --product dictate-engine
BIN=$(swift build "${SWIFT_FLAGS[@]}" --show-bin-path)

# --- App shell (Electron, --dir packaging, unsigned by electron-builder) -
cd app
[ -d node_modules ] || npm install
rm -rf dist
npm run build
npx electron-builder --dir
cd ..

APP_OUT_DIR=$(find app/dist -maxdepth 1 -type d \( -name "mac" -o -name "mac-arm64" -o -name "mac-universal" \) | head -1)
if [ -z "$APP_OUT_DIR" ]; then
  echo "error: couldn't find electron-builder's mac output under app/dist" >&2
  exit 1
fi
APP="$APP_OUT_DIR/$APP_NAME"

# --- Assemble: engine binary + whisper.framework into the app bundle ----
cp "$BIN/dictate-engine" "$APP/Contents/MacOS/dictate-engine"
cp -R "$BIN/whisper.framework" "$APP/Contents/Frameworks/"
install_name_tool -add_rpath "@executable_path/../Frameworks" "$APP/Contents/MacOS/dictate-engine" 2>/dev/null || true

# --- Sign: every framework and nested app under Contents/Frameworks first,
# then the engine, then the app on top. No hardened runtime (as v1): its
# library validation rejects frameworks without an Apple Team ID.
for item in "$APP/Contents/Frameworks"/*.framework "$APP/Contents/Frameworks"/*.app; do
  [ -e "$item" ] || continue
  codesign --force --sign "$IDENTITY" "$item"
done
codesign --force --sign "$IDENTITY" --identifier com.leigh.dictate.preview.engine "$APP/Contents/MacOS/dictate-engine"
codesign --force --sign "$IDENTITY" --identifier com.leigh.dictate.preview "$APP"
codesign --verify --deep --strict "$APP"

# --- Zip only (--no-install) -------------------------------------------
# ditto keeps the framework symlinks and the signatures intact; plain zip doesn't.
if [ "$INSTALL" = 0 ]; then
  ZIP="app/dist/$ZIP_NAME"
  rm -f "$ZIP"
  ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
  echo "Built $ZIP (signed with: $IDENTITY; not installed)"
  exit 0
fi

# --- Install -------------------------------------------------------------
osascript -e 'tell application id "com.leigh.dictate.preview" to quit' 2>/dev/null || true
# Quitting waits for the engine to unload the speech model, so give it up to 10 s to be gone.
for _ in $(seq 20); do
  pgrep -f "$INSTALLED/Contents/MacOS/" >/dev/null || break
  sleep 0.5
done
rm -rf "$INSTALLED"
cp -R "$APP" "$INSTALLED"
if [ "$E2E" = 1 ]; then
  echo "Installed $INSTALLED (e2e build, not opened)"
elif [ "$OPEN" = 0 ]; then
  echo "Installed $INSTALLED (not opened)"
else
  open "$INSTALLED"
  echo "Installed $INSTALLED"
fi
