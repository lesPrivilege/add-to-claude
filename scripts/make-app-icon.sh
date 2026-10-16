#!/bin/bash
# Regenerates native/brand/AppIcon.icns from native/brand/app-icon.svg.
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/app-icon.XXXXXX")"
trap 'rm -r "$work"' EXIT
xcrun swiftc -O "$project_root/scripts/make-app-icon.swift" -o "$work/render"
"$work/render" "$project_root/native/brand/app-icon.svg" "$work/AppIcon.iconset"
iconutil -c icns "$work/AppIcon.iconset" -o "$project_root/native/brand/AppIcon.icns"
cp "$work/AppIcon.iconset/icon_512x512@2x.png" "$project_root/artifacts/app-icon.png"
echo "Wrote native/brand/AppIcon.icns"
