#!/bin/bash
# Swift Testing ships with the Command Line Tools but isn't on the default search paths there.
# With full Xcode selected (CI's macOS runners) swift test already finds it, and pointing at the
# Command Line Tools' copy could mix two Swift versions, so the extra paths are CLT-only.
set -euo pipefail
F=/Library/Developer/CommandLineTools/Library/Developer/Frameworks
L=/Library/Developer/CommandLineTools/Library/Developer/usr/lib
if [ "$(xcode-select -p 2>/dev/null)" = /Library/Developer/CommandLineTools ]; then
  exec swift test -Xswiftc -F -Xswiftc "$F" -Xlinker -F -Xlinker "$F" \
    -Xlinker -rpath -Xlinker "$F" -Xlinker -rpath -Xlinker "$L" "$@"
fi
exec swift test "$@"
