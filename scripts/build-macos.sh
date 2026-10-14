#!/bin/bash
# Builds an unsigned local gpt-handoff.app: the menu-bar chat panel, its WebKit scripts and icons.
set -euo pipefail
[[ "$(uname -s)" == "Darwin" ]] || { echo 'macOS with the Xcode command-line tools is required.' >&2; exit 1; }
project_root="$(cd "$(dirname "$0")/.." && pwd)"
output="${1:-$project_root/dist/gpt-handoff.app}"
[[ "$output" == /*.app ]] || { echo 'Usage: bash scripts/build-macos.sh [/absolute/output.app]' >&2; exit 1; }
[[ ! -e "$output" ]] || { echo "Move the existing $output aside first." >&2; exit 1; }

mkdir -p "$(dirname "$output")"
work="$(mktemp -d "$(dirname "$output")/.gpt-handoff-build.XXXXXX")"
trap 'rm -r "$work"' EXIT
bundle="$work/gpt-handoff.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
cp "$project_root/native/Info.plist" "$bundle/Contents/Info.plist"
cp -R "$project_root/native/icons" "$bundle/Contents/Resources/icons"
node "$project_root/scripts/build-webkit.js" "$bundle/Contents/Resources/webkit"
native="$project_root/native"
xcrun --sdk macosx swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos14.0" -parse-as-library \
  "$native/Main.swift" "$native/App.swift" "$native/Chat.swift" "$native/Handoff.swift" \
  "$native/Views.swift" "$native/Composer.swift" -o "$bundle/Contents/MacOS/gpt-handoff"
plutil -lint "$bundle/Contents/Info.plist" >/dev/null
# A stable local identity keeps the Accessibility grant across rebuilds; ad-hoc builds lose it each time.
identity="${GPT_HANDOFF_SIGNING_IDENTITY:-gpt-handoff Local}"
if security find-identity -p codesigning 2>/dev/null | grep -q "\"$identity\""; then
  codesign --force --sign "$identity" --identifier io.lesprivilege.gpt-handoff "$bundle"
  signed="signed with \"$identity\""
else
  signed="ad-hoc signed; Accessibility must be granted again after each rebuild"
fi
mv "$bundle" "$output"
echo "Built $output ($signed)."
