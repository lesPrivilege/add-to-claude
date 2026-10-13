#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '%s\n' 'macOS and the Xcode command-line tools are required. No native build was performed.' >&2
  exit 1
fi
if [[ $# -lt 1 || $# -gt 2 || "$1" != /* || ! -x "$1" ]]; then
  printf '%s\n' 'Usage: bash scripts/build-macos.sh /absolute/path/to/installed/node [/absolute/output.app]' >&2
  exit 1
fi

project_root="$(cd "$(dirname "$0")/.." && pwd)"
node_executable="$1"
node_major="$(env -i PATH=/usr/bin:/bin "$node_executable" -p 'process.versions.node.split(".")[0]')"
if [[ ! "$node_major" =~ ^[0-9]+$ ]] || (( node_major < 24 )); then
  printf '%s\n' 'Use an installed Node.js 24 or newer executable.' >&2
  exit 1
fi
"$node_executable" "$project_root/scripts/verify-native-identity.js"
output_bundle="${2:-$project_root/dist/gpt-handoff.app}"
if [[ "$output_bundle" != /* || "$output_bundle" != *.app ]]; then
  printf '%s\n' 'The output must be an absolute .app path.' >&2
  exit 1
fi
output_parent="$(dirname "$output_bundle")"
if [[ -e "$output_bundle" ]]; then
  printf '%s\n' 'The output app already exists. Choose another output or move it aside before rebuilding.' >&2
  exit 1
fi

for required in src/server.js web package.json native/main.swift native/Info.plist; do
  if [[ ! -e "$project_root/$required" ]]; then
    printf 'Required project resource is missing: %s\n' "$required" >&2
    exit 1
  fi
done

mkdir -p "$output_parent"
build_root="$(mktemp -d "$output_parent/.gpt-handoff-build.XXXXXX")"
trap 'rm -r "$build_root"' EXIT
app_bundle="$build_root/gpt-handoff.app"
mkdir -p "$app_bundle/Contents/MacOS" "$app_bundle/Contents/Resources/project"
cp "$project_root/native/Info.plist" "$app_bundle/Contents/Info.plist"
cp -R "$project_root/src" "$project_root/web" "$app_bundle/Contents/Resources/project/"
cp "$project_root/package.json" "$app_bundle/Contents/Resources/project/"
"$node_executable" "$project_root/scripts/build-extension.js"
cp -R "$project_root/dist/extension" "$app_bundle/Contents/Resources/extension"
cp "$project_root/scripts/install-native-host.py" "$app_bundle/Contents/Resources/install-native-host.py"
if [[ -f "$project_root/package-lock.json" ]]; then
  cp "$project_root/package-lock.json" "$app_bundle/Contents/Resources/project/"
fi
if [[ -f "$project_root/LICENSE" ]]; then
  cp "$project_root/LICENSE" "$app_bundle/Contents/Resources/project/"
fi

# PlistBuddy receives the path as one argument; it is never evaluated by a shell.
/usr/libexec/PlistBuddy -c 'Clear dict' "$app_bundle/Contents/Resources/Runtime.plist"
/usr/libexec/PlistBuddy -c "Add :NodeExecutable string $node_executable" "$app_bundle/Contents/Resources/Runtime.plist"
"$node_executable" "$project_root/scripts/build-embedded-source.js" "$app_bundle/Contents/Resources/embedded-source.js"
xcrun --sdk macosx swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
  -framework AppKit -framework ApplicationServices -framework WebKit \
  "$project_root/native/main.swift" "$project_root/native/ComposerAccess.swift" "$project_root/native/Workspace.swift" "$project_root/native/ContextExport.swift" "$project_root/native/ContextDownloads.swift" -o "$app_bundle/Contents/MacOS/gpt-handoff"
xcrun --sdk macosx swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
  -framework AppKit -framework ApplicationServices \
  "$project_root/native/ComposerAccess.swift" "$project_root/native/NativeHostProtocol.swift" \
  "$project_root/native/NativeHostOrigin.swift" "$project_root/native/NativeHost.swift" -o "$app_bundle/Contents/MacOS/gpt-handoff-host"
plutil -lint "$app_bundle/Contents/Info.plist" "$app_bundle/Contents/Resources/Runtime.plist"
mv "$app_bundle" "$output_bundle"
printf 'Created unsigned local build: %s\n' "$output_bundle"
printf '%s\n' 'Run the native acceptance checks in native/README.md before using or distributing it.'
