#!/bin/bash
# Renders the real popover view controller in several extension states to artifacts/popover-*.png.
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/gh-snapshot.XXXXXX")"
trap 'rm -r "$work"' EXIT
native="$project_root/native"
cp -R "$native/icons" "$work/icons"
xcrun --sdk macosx swiftc -swift-version 5 -target "$(uname -m)-apple-macos14.0" -parse-as-library \
  "$native/App.swift" "$native/Composer.swift" "$native/Link.swift" "$native/NativeHostOrigin.swift" \
  "$project_root/tests/native/Snapshot.swift" -o "$work/snapshot"
mkdir -p "$project_root/artifacts"
"$work/snapshot" "$project_root/artifacts"
ls "$project_root/artifacts"/popover-*.png
