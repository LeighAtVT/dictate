#!/bin/bash
# CI only: import the signing identity (a base64 .p12) into a temporary keychain so
# build-preview.sh can sign with it. Never run this on your own Mac; locally the identity
# comes from scripts/make-signing-cert.sh.
#
#   MAC_SIGNING_P12        the .p12 file, base64-encoded
#   MAC_SIGNING_PASSWORD   the .p12's password
#
# Neither value is ever echoed: no `set -x`, and both reach `security` only as arguments.
# The temporary keychain lives under $RUNNER_TEMP (or $TMPDIR) and is added to the user's
# keychain search list so codesign can find the identity. The default keychain is not changed.
set -euo pipefail
set +x

if [ -z "${MAC_SIGNING_P12:-}" ] || [ -z "${MAC_SIGNING_PASSWORD:-}" ]; then
  echo "error: MAC_SIGNING_P12 and MAC_SIGNING_PASSWORD must both be set" >&2
  exit 1
fi

WORK="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
KEYCHAIN="$WORK/dictate-signing.keychain-db"
P12="$WORK/dictate-signing.p12"
# A random password for the throwaway keychain; it never leaves this script.
KEYCHAIN_PASSWORD="$(openssl rand -hex 24)"

cleanup() { rm -f "$P12"; }
trap cleanup EXIT

# Mask the values in GitHub Actions logs in case a tool ever prints them.
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  echo "::add-mask::$KEYCHAIN_PASSWORD"
fi

umask 077
printf '%s' "$MAC_SIGNING_P12" | base64 --decode > "$P12"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security import "$P12" -k "$KEYCHAIN" -P "$MAC_SIGNING_PASSWORD" -f pkcs12 -T /usr/bin/codesign >/dev/null
# Let codesign use the key without a GUI prompt.
security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null

# Add the temporary keychain to the search list, keeping the existing ones.
EXISTING=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%\"}"
  line="${line#\"}"
  [ -n "$line" ] && EXISTING+=("$line")
done < <(security list-keychains -d user)
security list-keychains -d user -s "$KEYCHAIN" "${EXISTING[@]}"

echo "Imported the signing identity into $KEYCHAIN:"
security find-identity -v -p codesigning "$KEYCHAIN"
