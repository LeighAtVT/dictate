#!/bin/bash
# Build Dictate.app, sign it with the local identity, install to /Applications and launch.
set -euo pipefail
cd "$(dirname "$0")/.."
IDENTITY="Dictate Local Signing"
APP=.build/Dictate.app

swift build -c release
BIN=$(swift build -c release --show-bin-path)

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Frameworks" "$APP/Contents/Library/LaunchAgents"
cp Resources/Info.plist "$APP/Contents/Info.plist"
# The LaunchAgent restarts Dictate if it ever exits for a reason other than Quit.
cp Resources/com.leigh.dictate.agent.plist "$APP/Contents/Library/LaunchAgents/"
cp "$BIN/Dictate" "$APP/Contents/MacOS/Dictate"
cp -R "$BIN/whisper.framework" "$APP/Contents/Frameworks/"
install_name_tool -add_rpath "@executable_path/../Frameworks" "$APP/Contents/MacOS/Dictate" 2>/dev/null || true

# No hardened runtime: its library validation rejects frameworks without an Apple Team ID.
codesign --force --sign "$IDENTITY" "$APP/Contents/Frameworks/whisper.framework"
codesign --force --sign "$IDENTITY" --identifier com.leigh.dictate "$APP"
codesign --verify --deep --strict "$APP"

osascript -e 'tell application id "com.leigh.dictate" to quit' 2>/dev/null || true
sleep 1
rm -rf /Applications/Dictate.app
cp -R "$APP" /Applications/Dictate.app
open /Applications/Dictate.app
echo "Installed /Applications/Dictate.app"
