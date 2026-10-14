#!/bin/bash
set -euo pipefail
if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '%s\n' 'This real Accessibility fixture requires macOS.' >&2
  exit 2
fi
project_root="$(cd "$(dirname "$0")/.." && pwd)"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/handoff-accessibility.XXXXXX")"
trap 'rm -r "$fixture_root"' EXIT
fixture_bundle="$fixture_root/Synthetic composer.app"
mkdir -p "$fixture_bundle/Contents/MacOS"
cat > "$fixture_bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Fixture</string>
<key>CFBundleIdentifier</key><string>io.lesprivilege.gpt-handoff-ax-fixture</string>
<key>CFBundleName</key><string>Synthetic composer</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
</dict></plist>
PLIST
xcrun --sdk macosx swiftc -swift-version 5 -target "$(uname -m)-apple-macos14.0" -parse-as-library -framework AppKit \
  "$project_root/native/Link.swift" "$project_root/tests/native/AccessibilityFixture.swift" \
  -o "$fixture_bundle/Contents/MacOS/Fixture"
xcrun --sdk macosx swiftc -swift-version 5 -target "$(uname -m)-apple-macos14.0" -parse-as-library -framework AppKit -framework ApplicationServices \
  "$project_root/native/Composer.swift" "$project_root/tests/native/AccessibilityTests.swift" "$project_root/native/Link.swift" \
  -o "$fixture_root/accessibility-tests"
mkfifo -m 600 "$fixture_root/requests" "$fixture_root/responses"
"$fixture_root/accessibility-tests" "$fixture_bundle" "$fixture_root"
