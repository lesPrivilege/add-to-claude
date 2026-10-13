#!/bin/bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/handoff-files.XXXXXX")"
trap 'rm -r "$fixture_root"' EXIT
xcrun --sdk macosx swiftc -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
  "$project_root/native/ContextExport.swift" "$project_root/tests/native/ContextExportTests.swift" -o "$fixture_root/export-tests"
"$fixture_root/export-tests"
xcrun --sdk macosx swiftc -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
  -framework AppKit -framework WebKit "$project_root/native/ContextExport.swift" "$project_root/native/ContextDownloads.swift" \
  "$project_root/tests/native/ContextDownloadTests.swift" -o "$fixture_root/download-tests"
node "$project_root/tests/native/download-server.js" "$fixture_root/port" &
fixture_server_pid=$!
trap 'kill "$fixture_server_pid" 2>/dev/null || true; rm -r "$fixture_root"' EXIT
for attempt in {1..50}; do
  [[ -s "$fixture_root/port" ]] && break
  sleep 0.1
done
"$fixture_root/download-tests" "$(cat "$fixture_root/port")"
