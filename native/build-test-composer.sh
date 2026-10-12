#!/bin/bash
set -euo pipefail
if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '%s\n' 'This synthetic AppKit fixture requires macOS.' >&2
  exit 1
fi
project_root="$(cd "$(dirname "$0")/.." && pwd)"
fixture_bundle="$project_root/dist/gpt-handoff test composer.app"
if [[ -e "$fixture_bundle" ]]; then
  printf '%s\n' 'The fixture app already exists. Move it aside before rebuilding.' >&2
  exit 1
fi
mkdir -p "$fixture_bundle/Contents/MacOS"
cat > "$fixture_bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>TestComposer</string>
<key>CFBundleIdentifier</key><string>io.lesprivilege.gpt-handoff-test-composer</string>
<key>CFBundleName</key><string>gpt-handoff test composer</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.2.0</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
</dict></plist>
PLIST
xcrun --sdk macosx swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.0" -framework AppKit \
  "$project_root/native/TestComposer.swift" -o "$fixture_bundle/Contents/MacOS/TestComposer"
printf 'Created unsigned synthetic test fixture: %s\n' "$fixture_bundle"
