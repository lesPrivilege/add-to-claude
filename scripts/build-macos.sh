#!/bin/bash
# Builds a local "Add to Claude.app": the menu-bar chat panel, its WebKit scripts and icons.
set -euo pipefail
[[ "$(uname -s)" == "Darwin" ]] || { echo 'macOS with the Xcode command-line tools is required.' >&2; exit 1; }
project_root="$(cd "$(dirname "$0")/.." && pwd)"
output="${1:-$project_root/dist/Add to Claude.app}"
[[ "$output" == /*.app ]] || { echo 'Usage: bash scripts/build-macos.sh [/absolute/output.app]' >&2; exit 1; }
[[ ! -e "$output" ]] || { echo "Move the existing $output aside first." >&2; exit 1; }

# Updates are verified with this key; a build without it could never update.
grep -A1 '<key>SUPublicEDKey</key>' "$project_root/native/Info.plist" | grep -q '<string>[A-Za-z0-9+/=]\{40,\}</string>' \
  || { echo 'native/Info.plist has no SUPublicEDKey. Run vendor/Sparkle/bin/generate_keys once and put its public key there.' >&2; exit 1; }
bash "$project_root/scripts/fetch-sparkle.sh"
sparkle="$project_root/vendor/Sparkle"

mkdir -p "$(dirname "$output")"
work="$(mktemp -d "$(dirname "$output")/.add-to-claude-build.XXXXXX")"
trap 'rm -r "$work"' EXIT
bundle="$work/Add to Claude.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources" "$bundle/Contents/Frameworks"
cp "$project_root/native/Info.plist" "$bundle/Contents/Info.plist"
cp -R "$project_root/native/icons" "$bundle/Contents/Resources/icons"
cp "$project_root/native/brand/AppIcon.icns" "$bundle/Contents/Resources/AppIcon.icns"
node "$project_root/scripts/build-webkit.js" "$bundle/Contents/Resources/webkit"
native="$project_root/native"
xcrun --sdk macosx swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos14.0" -parse-as-library \
  -F "$sparkle" -framework Sparkle -Xlinker -rpath -Xlinker @executable_path/../Frameworks \
  "$native"/*.swift -o "$bundle/Contents/MacOS/add-to-claude"
# The app is not sandboxed, so Sparkle's XPC services are not needed.
ditto "$sparkle/Sparkle.framework" "$bundle/Contents/Frameworks/Sparkle.framework"
rm -r "$bundle/Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices" "$bundle/Contents/Frameworks/Sparkle.framework/XPCServices"
cp "$sparkle/LICENSE" "$bundle/Contents/Resources/Sparkle-LICENSE"
plutil -lint "$bundle/Contents/Info.plist" >/dev/null
# A stable local identity keeps the Accessibility grant across rebuilds; ad-hoc builds lose it each time.
identity="${ADD_TO_CLAUDE_SIGNING_IDENTITY:-add-to-claude Local}"
if security find-identity -p codesigning 2>/dev/null | grep -q "\"$identity\""; then
  signer="$identity"
  signed="signed with \"$identity\""
else
  signer="-"
  signed="ad-hoc signed; Accessibility must be granted again after each rebuild"
fi
# Inside out, as Sparkle documents: its helpers, the framework, then the app.
framework="$bundle/Contents/Frameworks/Sparkle.framework"
codesign --force --sign "$signer" "$framework/Versions/B/Autoupdate"
codesign --force --sign "$signer" "$framework/Versions/B/Updater.app"
codesign --force --sign "$signer" "$framework"
codesign --force --sign "$signer" --identifier io.lesprivilege.add-to-claude "$bundle"
codesign --verify --deep --strict "$bundle"
mv "$bundle" "$output"
echo "Built $output ($signed)."
