#!/usr/bin/env bash
# Builds the Safari app that wraps the extension.
#
# The Xcode project under safari/ is generated once with safari-web-extension-converter and then
# committed, because the converter overwrites hand-made changes (notably the bundle identifiers,
# which it generates inconsistently between the app and its extension). This script only refreshes
# the extension's resources from addon/ and rebuilds, so the generated project stays untouched.
#
# Usage: npm run safari-app-build [Debug|Release]

set -euo pipefail

CONFIGURATION="${1:-Debug}"
PROJECT="safari/Inspector Reloaded/Inspector Reloaded.xcodeproj"
RESOURCES="safari/Inspector Reloaded/Inspector Reloaded Extension/Resources"

cd "$(dirname "$0")/.."

# xcode-select often points at the Command Line Tools, which have no xcodebuild. Prefer a full
# Xcode when one is installed rather than requiring "sudo xcode-select -s".
if ! xcrun --find xcodebuild >/dev/null 2>&1; then
  if [ -d /Applications/Xcode.app ]; then
    export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
  else
    echo "error: Xcode is required to build the Safari app, but it was not found." >&2
    exit 1
  fi
fi

# Derived data must live outside the repository: this checkout can sit in an iCloud-synced folder,
# and the sync layer stamps com.apple.FinderInfo onto build output, which makes codesign fail with
# "resource fork, Finder information, or similar detritus not allowed".
DERIVED_DATA="${TMPDIR:-/tmp}/inspector-reloaded-safari"

echo "==> Building extension payload"
node scripts/release-build.js safari

echo "==> Syncing payload into the Xcode project"
mkdir -p "$RESOURCES"
rsync -a --delete target/safari/dist/ "$RESOURCES/"

echo "==> Building $CONFIGURATION"
xcodebuild -project "$PROJECT" \
  -scheme "Inspector Reloaded" \
  -configuration "$CONFIGURATION" \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGN_STYLE=Manual \
  DEVELOPMENT_TEAM="" \
  | grep -E "^\*\*|error:|warning: The following keys" || true

APP="$DERIVED_DATA/Build/Products/$CONFIGURATION/Inspector Reloaded.app"
if [ -d "$APP" ]; then
  echo
  echo "Built: $APP"
  echo
  echo "To load it in Safari:"
  echo "  1. open \"$APP\""
  echo "  2. Safari > Settings > Advanced > enable \"Show features for web developers\""
  echo "  3. Safari > Developer > check \"Allow unsigned extensions\" (resets on each Safari restart)"
  echo "  4. Safari > Settings > Extensions > enable Inspector Reloaded"
else
  echo "error: build did not produce an app bundle" >&2
  exit 1
fi
