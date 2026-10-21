#!/bin/bash
# Build Dictate Preview.app (the v2 Electron shell) plus its signed Swift engine,
# sign everything with the same local identity v1 uses, install to /Applications
# and launch. Spike only (Task 1 of the Dictate v2 Mac Preview plan); later tasks
# extend this script rather than replacing it.
set -euo pipefail
cd "$(dirname "$0")/.."

IDENTITY="Dictate Local Signing"
APP_NAME="Dictate Preview.app"
INSTALLED="/Applications/$APP_NAME"

# --- Engine (Swift, release) --------------------------------------------
swift build -c release --product dictate-engine
BIN=$(swift build -c release --show-bin-path)

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

# --- Install -------------------------------------------------------------
osascript -e 'tell application id "com.leigh.dictate.preview" to quit' 2>/dev/null || true
sleep 1
rm -rf "$INSTALLED"
cp -R "$APP" "$INSTALLED"
open "$INSTALLED"
echo "Installed $INSTALLED"
