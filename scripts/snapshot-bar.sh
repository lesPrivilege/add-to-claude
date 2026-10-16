#!/bin/bash
# Renders the real handoff bar in several source states to artifacts/bar-*.png.
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/gh-snapshot.XXXXXX")"
trap 'rm -r "$work"' EXIT
native="$project_root/native"
cp -R "$native/icons" "$work/icons"
xcrun --sdk macosx swiftc -swift-version 5 -target "$(uname -m)-apple-macos14.0" -parse-as-library \
  "$native/Handoff.swift" "$native/Views.swift" "$native/Composer.swift" "$native/Files.swift" "$native/Settings.swift" \
  "$native/Delivery.swift" "$native/TurnPicker.swift" \
  "$project_root/tests/native/Snapshot.swift" -o "$work/snapshot"
mkdir -p "$project_root/artifacts"
"$work/snapshot" "$project_root/artifacts"
ls "$project_root/artifacts"/*.png
