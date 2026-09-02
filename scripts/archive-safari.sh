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

# The privacy manifests, checked before anything is built.
#
# 2.1.0 (1) was rejected during processing with ITMS-91056 on both of them. Nothing local caught
# it: they were valid plists, plutil -lint accepted them, and the keys and types were right. The
# only fault was an XML comment inside, which Apple's validator rejects and no local tool minds.
#
# That cost a build number to discover, because this check runs server-side after delivery and
# build numbers are consumed on delivery. So it is worth a few milliseconds here.
echo "==> Checking the privacy manifests"
for manifest in "safari/$APP_NAME/$APP_NAME/PrivacyInfo.xcprivacy" \
                "safari/$APP_NAME/$APP_NAME Extension/PrivacyInfo.xcprivacy"; do
  if [ ! -f "$manifest" ]; then
    echo "error: missing $manifest" >&2
    exit 1
  fi
  if ! plutil -lint "$manifest" >/dev/null 2>&1; then
    echo "error: $manifest is not a valid plist" >&2
    exit 1
  fi
  if grep -q '<!--' "$manifest"; then
    echo >&2
    echo "error: $manifest contains an XML comment." >&2
    echo >&2
    echo "  Apple rejects this with ITMS-91056 even though the file is a valid plist and" >&2
    echo "  plutil -lint accepts it. Explanations belong in safari/PRIVACY-MANIFESTS.md." >&2
    exit 1
  fi
  # Only the four documented keys. Anything else is a typo or an invention, and both are rejected
  # the same way -- with a build number already spent.
  unexpected="$(plutil -convert json -o - "$manifest" 2>/dev/null \
    | tr ',{}' '\n' | sed -n 's/^"\([A-Za-z]*\)":.*/\1/p' \
    | grep -vxE "NSPrivacyTracking|NSPrivacyTrackingDomains|NSPrivacyCollectedDataTypes|NSPrivacyAccessedAPITypes" || true)"
  if [ -n "$unexpected" ]; then
    echo "error: $manifest has keys Apple does not document:" >&2
    echo "$unexpected" | sed 's/^/    /' >&2
    exit 1
  fi
  echo "    $(basename "$(dirname "$manifest")"): $(wc -c < "$manifest" | tr -d ' ') bytes, no comments, keys valid"
done

# A distribution certificate is what separates an archive that can be uploaded from one that
# cannot, and the failure without it is late and unhelpful: the archive builds, the export fails
# with a signing error that does not say what is missing. So it is checked first.
TEAM="$(security find-certificate -c "Apple Development" -p 2>/dev/null \
  | openssl x509 -noout -subject 2>/dev/null \
  | sed -n 's/.*OU=\([A-Z0-9]\{10\}\).*/\1/p')"

# A Mac App Store submission needs two different certificates, and missing either one fails the
# same way: the archive builds, then the export dies with a signing error. They are checked
# together because checking only the first is what let a run get all the way to the export before
# reporting that the second was missing.
#
#   Apple Distribution        signs the .app
#   Mac Installer Distribution  signs the .pkg that wraps it
#
# The installer certificate is not a codesigning identity, so find-identity never lists it however
# it is queried; it has to be looked for as a certificate.
HAVE_APP_CERT=0
HAVE_INSTALLER_CERT=0
security find-identity -v 2>/dev/null \
  | grep -qE "Apple Distribution|3rd Party Mac Developer Application" && HAVE_APP_CERT=1
for name in "Mac Installer Distribution" "3rd Party Mac Developer Installer"; do
  if security find-certificate -c "$name" >/dev/null 2>&1; then
    HAVE_INSTALLER_CERT=1
  fi
done

if [ "$ARCHIVE_ONLY" = "0" ] && { [ "$HAVE_APP_CERT" = "0" ] || [ "$HAVE_INSTALLER_CERT" = "0" ]; }; then
  echo >&2
  echo "error: the keychain is missing a certificate an App Store build needs." >&2
  echo >&2
  [ "$HAVE_APP_CERT" = "1" ] \
    && echo "  present: Apple Distribution          (signs the .app)" >&2 \
    || echo "  MISSING: Apple Distribution          (signs the .app)" >&2
  [ "$HAVE_INSTALLER_CERT" = "1" ] \
    && echo "  present: Mac Installer Distribution  (signs the .pkg)" >&2 \
    || echo "  MISSING: Mac Installer Distribution  (signs the .pkg)" >&2
  echo >&2
  echo "  Xcode creates either one for you:" >&2
  echo >&2
  echo "    Xcode > Settings > Accounts > select the team > Manage Certificates," >&2
  echo "    then the + button, and pick the missing certificate by that name." >&2
  echo >&2
  echo "  To check that the archive itself builds without them, run:" >&2
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
  -allowProvisioningUpdates \
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

# Archiving registers the archived app with LaunchServices under a virtual path inside the
# archive, which leaves a second "SF Inspector" known to the system next to the installed one.
# build-safari.sh already unregisters its build product for the same reason; this did not, and an
# archive run duplicated the entry. The record outlives the archive directory, and lsregister
# cannot remove one whose bundle is already gone, so it has to be undone here while it still can.
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister
if [ -x "$LSREGISTER" ]; then
  "$LSREGISTER" -u "$APP_IN_ARCHIVE" 2>/dev/null || true
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
  -allowProvisioningUpdates \
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

# What is in the package, rather than what the export claimed to do. Everything above this point
# describes the archive, which is signed for development and re-signed during the export -- so the
# archive's own authority and entitlements say nothing about what ships. This opens the package and
# looks.
if [ -n "$PKG" ]; then
  echo
  echo "==> Verifying the package"
  echo "    installer: $(pkgutil --check-signature "$PKG" 2>/dev/null | sed -n 's/^ *1\. //p' | head -1)"

  VERIFY="$OUT/verify"
  rm -rf "$VERIFY"
  if pkgutil --expand-full "$PKG" "$VERIFY" >/dev/null 2>&1; then
    SHIPPED="$(find "$VERIFY" -name "$APP_NAME.app" -maxdepth 5 -type d | head -1)"
    if [ -n "$SHIPPED" ]; then
      echo "    app:       $(codesign -dvv "$SHIPPED" 2>&1 | sed -n 's/^Authority=//p' | head -1)"
      echo "    profile:   $(security cms -D -i "$SHIPPED/Contents/embedded.provisionprofile" 2>/dev/null | plutil -extract Name raw -o - - 2>/dev/null)"
      for bundle in "$SHIPPED" "$SHIPPED/Contents/PlugIns/$APP_NAME Extension.appex"; do
        echo "    $(basename "$bundle") entitlements:"
        codesign -d --entitlements - --xml "$bundle" 2>/dev/null | plutil -p - \
          | grep -oE '"[a-z.-]+"' | sed 's/^/      /'
      done

      # An App Store build must not carry this. It means something signed it for development, and
      # the upload is rejected rather than the build.
      if codesign -d --entitlements - --xml "$SHIPPED" 2>/dev/null | grep -q "get-task-allow"; then
        echo
        echo "error: the shipped app carries get-task-allow and will be rejected on upload." >&2
        exit 1
      fi
    fi
    rm -rf "$VERIFY"
  else
    echo "    (could not expand the package to check it)"
  fi
fi
echo
echo "To upload, either:"
echo "  - open Transporter, sign in, and drop that .pkg on it, or"
echo "  - Xcode > Window > Organizer, select the archive, Distribute App."
echo
echo "Version $MARKETING_VERSION build $BUILD_NUMBER. Raise CURRENT_PROJECT_VERSION before the next"
echo "upload; App Store Connect refuses a build number it has already accepted."
