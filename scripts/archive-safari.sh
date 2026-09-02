#!/usr/bin/env bash
# Archives the app and exports it for App Store Connect.
#
#   npm run safari-app-archive                  archive, then export a signed .pkg
#   npm run safari-app-archive -- --archive-only  stop after archiving, skip the export
#
# Separate from build-safari.sh because the two want different signing. That one builds something
# to run locally and falls back to ad-hoc signing when no certificate is around; this one produces
# something to upload, where falling back to anything is exactly wrong -- a build signed with the
# wrong identity is rejected after the upload, not before it.
#
# What this cannot do is upload. That needs credentials, so the last step is left to Transporter or
# to Xcode's Organizer, both of which can take the .pkg this writes.

set -euo pipefail

cd "$(dirname "$0")/.."

ARCHIVE_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --archive-only) ARCHIVE_ONLY=1 ;;
    *) echo "error: unknown argument '$arg'" >&2; exit 2 ;;
  esac
done

APP_NAME="SF Inspector"
PROJECT="safari/$APP_NAME/$APP_NAME.xcodeproj"
RESOURCES="safari/$APP_NAME/$APP_NAME Extension/Resources"
PAYLOAD="target/safari/dist"

# Same reason as build-safari.sh: xcode-select commonly points at the Command Line Tools, which
# have no xcodebuild.
if ! xcrun --find xcodebuild >/dev/null 2>&1; then
  if [ -x /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild ]; then
    export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
  else
    echo "error: no xcodebuild. Install Xcode, or point xcode-select at it." >&2
    exit 1
  fi
fi

# Outside the repository: this checkout can sit in an iCloud-synced folder, and the sync layer
# stamps com.apple.FinderInfo onto build output, which makes codesign refuse it.
OUT="${TMPDIR:-/tmp}/sf-inspector-archive"
ARCHIVE="$OUT/$APP_NAME.xcarchive"
EXPORT_DIR="$OUT/export"

echo "==> Building extension payload"
node scripts/release-build.js safari

MARKETING_VERSION="$(node -p "require('./addon/manifest.json').version")"
BUILD_NUMBER="$(grep -m1 -o 'CURRENT_PROJECT_VERSION = [^;]*' "$PROJECT/project.pbxproj" | sed 's/.*= //')"
echo "==> Version $MARKETING_VERSION build $BUILD_NUMBER"
echo "    App Store Connect rejects a build number it has already seen. Raise"
echo "    CURRENT_PROJECT_VERSION in the project before re-uploading."

echo "==> Syncing payload into the Xcode project"
mkdir -p "$RESOURCES"
rsync -a --delete "$PAYLOAD/" "$RESOURCES/"

# A distribution certificate is what separates an archive that can be uploaded from one that
# cannot, and the failure without it is late and unhelpful: the archive builds, the export fails
# with a signing error that does not say what is missing. So it is checked first.
TEAM="$(security find-certificate -c "Apple Development" -p 2>/dev/null \
  | openssl x509 -noout -subject 2>/dev/null \
  | sed -n 's/.*OU=\([A-Z0-9]\{10\}\).*/\1/p')"

if security find-identity -v 2>/dev/null | grep -qE "Apple Distribution|3rd Party Mac Developer Application"; then
  HAVE_DISTRIBUTION=1
else
  HAVE_DISTRIBUTION=0
fi

if [ "$HAVE_DISTRIBUTION" = "0" ] && [ "$ARCHIVE_ONLY" = "0" ]; then
  echo >&2
  echo "error: no distribution certificate in the keychain." >&2
  echo >&2
  echo "  The keychain has:" >&2
  security find-identity -v -p codesigning 2>/dev/null | sed 's/^/  /' >&2
  echo >&2
  echo "  An App Store build needs an Apple Distribution certificate, which Xcode creates for you" >&2
  echo "  once it is signed in:" >&2
  echo >&2
  echo "    1. Xcode > Settings > Accounts, add your Apple ID." >&2
  echo "    2. Select the team, then Manage Certificates, and add an Apple Distribution one." >&2
  echo >&2
  echo "  To check that the archive itself builds before doing any of that, run:" >&2
  echo "    npm run safari-app-archive -- --archive-only" >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT"

echo "==> Archiving"
LOG="$(mktemp -t sf-inspector-archive)"
set +e
xcodebuild archive \
  -project "$PROJECT" \
  -scheme "$APP_NAME" \
  -configuration Release \
  -archivePath "$ARCHIVE" \
  -derivedDataPath "$OUT/DerivedData" \
  MARKETING_VERSION="$MARKETING_VERSION" \
  DEVELOPMENT_TEAM="$TEAM" \
  >"$LOG" 2>&1
STATUS=$?
set -e

if [ "$STATUS" -ne 0 ]; then
  echo >&2
  echo "Archive failed:" >&2
  grep -E "error:" "$LOG" >&2 || tail -30 "$LOG" >&2
  echo >&2
  echo "Full log: $LOG" >&2
  exit "$STATUS"
fi
rm -f "$LOG"

echo "Archived: $ARCHIVE"

# What actually ended up inside, rather than what the project says should have. The entitlements
# are the point: a distribution build must not carry get-task-allow, and a Development certificate
# injects it, so this is the only place the difference becomes visible.
APP_IN_ARCHIVE="$ARCHIVE/Products/Applications/$APP_NAME.app"
APPEX_IN_ARCHIVE="$APP_IN_ARCHIVE/Contents/PlugIns/$APP_NAME Extension.appex"

echo
echo "==> What was signed"
for bundle in "$APP_IN_ARCHIVE" "$APPEX_IN_ARCHIVE"; do
  echo "    $(basename "$bundle")"
  codesign -d --entitlements - --xml "$bundle" 2>/dev/null \
    | plutil -p - 2>/dev/null \
    | grep -oE '"[a-z.-]+"\s*=>' | sed 's/ *=>//' | sed 's/^/      /'
  echo "      authority: $(codesign -dvv "$bundle" 2>&1 | sed -n 's/^Authority=//p' | head -1)"
done

if codesign -d --entitlements - --xml "$APP_IN_ARCHIVE" 2>/dev/null | grep -q "get-task-allow"; then
  echo
  echo "    NOTE: get-task-allow is present, so this was signed for development and cannot be"
  echo "          uploaded. It is injected by a Development certificate and will be absent once"
  echo "          an Apple Distribution certificate is in the keychain."
fi

if [ "$ARCHIVE_ONLY" = "1" ]; then
  echo
  echo "Stopped after archiving, as asked. Export with:"
  echo "  npm run safari-app-archive"
  exit 0
fi

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>teamID</key>
  <string>$TEAM</string>
  <!-- Left to Xcode: it creates and downloads the distribution profile, which is the part that
       cannot be committed to a repository. -->
  <key>signingStyle</key>
  <string>automatic</string>
  <!-- Symbols go up with the build so crash reports come back symbolicated. -->
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
PLIST

echo
echo "==> Exporting for App Store Connect"
LOG="$(mktemp -t sf-inspector-export)"
set +e
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" \
  >"$LOG" 2>&1
STATUS=$?
set -e

if [ "$STATUS" -ne 0 ]; then
  echo >&2
  echo "Export failed:" >&2
  grep -E "error:|Error Domain" "$LOG" >&2 || tail -30 "$LOG" >&2
  echo >&2
  echo "Full log: $LOG" >&2
  exit "$STATUS"
fi
rm -f "$LOG"

PKG="$(find "$EXPORT_DIR" -name "*.pkg" -maxdepth 1 | head -1)"
echo
echo "Exported: ${PKG:-$EXPORT_DIR}"
echo
echo "To upload, either:"
echo "  - open Transporter, sign in, and drop that .pkg on it, or"
echo "  - Xcode > Window > Organizer, select the archive, Distribute App."
echo
echo "Version $MARKETING_VERSION build $BUILD_NUMBER. Raise CURRENT_PROJECT_VERSION before the next"
echo "upload; App Store Connect refuses a build number it has already accepted."
