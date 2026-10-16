#!/bin/bash
# Builds an unsigned local add-to-claude.app: the menu-bar chat panel, its WebKit scripts and icons.
set -euo pipefail
[[ "$(uname -s)" == "Darwin" ]] || { echo 'macOS with the Xcode command-line tools is required.' >&2; exit 1; }
project_root="$(cd "$(dirname "$0")/.." && pwd)"
output="${1:-$project_root/dist/add-to-claude.app}"
[[ "$output" == /*.app ]] || { echo 'Usage: bash scripts/build-macos.sh [/absolute/output.app]' >&2; exit 1; }
[[ ! -e "$output" ]] || { echo "Move the existing $output aside first." >&2; exit 1; }

mkdir -p "$(dirname "$output")"
work="$(mktemp -d "$(dirname "$output")/.add-to-claude-build.XXXXXX")"
trap 'rm -r "$work"' EXIT
bundle="$work/add-to-claude.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
cp "$project_root/native/Info.plist" "$bundle/Contents/Info.plist"
cp -R "$project_root/native/icons" "$bundle/Contents/Resources/icons"
cp "$project_root/native/brand/AppIcon.icns" "$bundle/Contents/Resources/AppIcon.icns"
node "$project_root/scripts/build-webkit.js" "$bundle/Contents/Resources/webkit"
native="$project_root/native"
xcrun --sdk macosx swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos14.0" -parse-as-library \
  "$native/Main.swift" "$native/App.swift" "$native/Chat.swift" "$native/Handoff.swift" \
  "$native/Views.swift" "$native/Composer.swift" "$native/Files.swift" "$native/Settings.swift" "$native/Delivery.swift" "$native/TurnPicker.swift" -o "$bundle/Contents/MacOS/add-to-claude"
plutil -lint "$bundle/Contents/Info.plist" >/dev/null
# A stable local identity keeps the Accessibility grant across rebuilds; ad-hoc builds lose it each time.
identity="${ADD_TO_CLAUDE_SIGNING_IDENTITY:-add-to-claude Local}"
if security find-identity -p codesigning 2>/dev/null | grep -q "\"$identity\""; then
  codesign --force --sign "$identity" --identifier io.lesprivilege.add-to-claude "$bundle"
  signed="signed with \"$identity\""
else
  signed="ad-hoc signed; Accessibility must be granted again after each rebuild"
fi
mv "$bundle" "$output"
echo "Built $output ($signed)."
