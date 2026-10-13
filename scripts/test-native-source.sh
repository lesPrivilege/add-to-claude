#!/bin/bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/handoff-webkit.XXXXXX")"
trap 'rm -r "$fixture_root"' EXIT
node "$project_root/scripts/build-embedded-source.js" "$fixture_root/observer.js"
xcrun --sdk macosx swiftc -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
  -framework AppKit -framework WebKit "$project_root/tests/native/EmbeddedSource.swift" -o "$fixture_root/fixture"
"$fixture_root/fixture" "$project_root/tests/native/embedded-fixture.js" "$fixture_root/observer.js"
