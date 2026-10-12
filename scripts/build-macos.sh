#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '%s\n' 'macOS and the Xcode command-line tools are required. No native build was performed.' >&2
  exit 1
fi
if [[ $# -ne 1 || "$1" != /* || ! -x "$1" ]]; then
  printf '%s\n' 'Usage: bash scripts/build-macos.sh /absolute/path/to/installed/node' >&2
  exit 1
fi

project_root="$(cd "$(dirname "$0")/.." && pwd)"
node_executable="$1"
node_major="$(env -i PATH=/usr/bin:/bin "$node_executable" -p 'process.versions.node.split(".")[0]')"
if [[ ! "$node_major" =~ ^[0-9]+$ ]] || (( node_major < 24 )); then
  printf '%s\n' 'Use an installed Node.js 24 or newer executable.' >&2
  exit 1
fi
app_bundle="$project_root/dist/gpt-handoff.app"
if [[ -e "$app_bundle" ]]; then
  printf '%s\n' 'dist/gpt-handoff.app already exists. Move it aside before rebuilding.' >&2
  exit 1
fi

for required in src/server.js web package.json native/main.swift native/Info.plist; do
  if [[ ! -e "$project_root/$required" ]]; then
    printf 'Required project resource is missing: %s\n' "$required" >&2
    exit 1
  fi
done

mkdir -p "$app_bundle/Contents/MacOS" "$app_bundle/Contents/Resources/project"
cp "$project_root/native/Info.plist" "$app_bundle/Contents/Info.plist"
cp -R "$project_root/src" "$project_root/web" "$app_bundle/Contents/Resources/project/"
cp "$project_root/package.json" "$app_bundle/Contents/Resources/project/"
if [[ -f "$project_root/package-lock.json" ]]; then
  cp "$project_root/package-lock.json" "$app_bundle/Contents/Resources/project/"
fi
if [[ -f "$project_root/LICENSE" ]]; then
  cp "$project_root/LICENSE" "$app_bundle/Contents/Resources/project/"
fi

# PlistBuddy receives the path as one argument; it is never evaluated by a shell.
/usr/libexec/PlistBuddy -c 'Clear dict' "$app_bundle/Contents/Resources/Runtime.plist"
/usr/libexec/PlistBuddy -c "Add :NodeExecutable string $node_executable" "$app_bundle/Contents/Resources/Runtime.plist"
xcrun --sdk macosx swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
  -framework AppKit -framework ApplicationServices \
  "$project_root/native/main.swift" -o "$app_bundle/Contents/MacOS/gpt-handoff"
plutil -lint "$app_bundle/Contents/Info.plist" "$app_bundle/Contents/Resources/Runtime.plist"
printf 'Created unsigned local build: %s\n' "$app_bundle"
printf '%s\n' 'Run the native acceptance checks in native/README.md before using or distributing it.'
