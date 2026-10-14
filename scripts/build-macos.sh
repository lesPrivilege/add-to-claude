#!/bin/bash
# Builds an unsigned local gpt-handoff.app: menu-bar app, Chrome relay, icons and the unpacked extension.
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
node "$project_root/scripts/build-extension.js"
cp -R "$project_root/dist/extension" "$bundle/Contents/Resources/extension"

target="$(uname -m)-apple-macos14.0"
native="$project_root/native"
xcrun --sdk macosx swiftc -O -swift-version 5 -target "$target" -parse-as-library \
  "$native/Main.swift" "$native/App.swift" "$native/Composer.swift" "$native/Link.swift" "$native/NativeHostOrigin.swift" \
  -o "$bundle/Contents/MacOS/gpt-handoff"
xcrun --sdk macosx swiftc -O -swift-version 5 -target "$target" -parse-as-library \
  "$native/Relay.swift" "$native/Link.swift" "$native/NativeHostOrigin.swift" \
  -o "$bundle/Contents/MacOS/gpt-handoff-host"
plutil -lint "$bundle/Contents/Info.plist" >/dev/null
mv "$bundle" "$output"
echo "Built $output (unsigned)."
