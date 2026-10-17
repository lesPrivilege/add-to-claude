#!/bin/bash
# Renders the real handoff bar in several source states to artifacts/bar-*.png.
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/add-to-claude-snapshot.XXXXXX")"
trap 'rm -r "$work"' EXIT
native="$project_root/native"
cp -R "$native/icons" "$work/icons"
# The app's sources without its entry point and the Sparkle updater, for the snapshot's own main.
app=()
for file in "$native"/*.swift; do [[ $file == */Main.swift || $file == */App.swift || $file == */Updates.swift ]] || app+=("$file"); done
xcrun --sdk macosx swiftc -swift-version 5 -target "$(uname -m)-apple-macos14.0" -parse-as-library \
  "${app[@]}" "$project_root/tests/native/Snapshot.swift" -o "$work/snapshot"
out="${SNAPSHOT_OUT:-$project_root/artifacts}"
mkdir -p "$out"
"$work/snapshot" "$out"
ls "$out"/*.png
