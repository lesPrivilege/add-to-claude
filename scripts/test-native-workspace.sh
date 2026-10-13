#!/bin/bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/handoff-workspace.XXXXXX")"
trap 'rm -r "$fixture_root"' EXIT
node "$project_root/scripts/build-embedded-source.js" "$fixture_root/observer.js"
xcrun --sdk macosx swiftc -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
  -framework AppKit -framework WebKit "$project_root/native/Workspace.swift" "$project_root/native/ContextExport.swift" \
  "$project_root/native/ContextDownloads.swift" "$project_root/tests/native/WorkspaceTests.swift" -o "$fixture_root/workspace-tests"
node "$project_root/tests/native/workspace-server.js" "$fixture_root/origin" > "$fixture_root/server.log" 2>&1 &
fixture_server_pid=$!
trap 'kill "$fixture_server_pid" 2>/dev/null || true; rm -r "$fixture_root"' EXIT
for attempt in {1..50}; do
  kill -0 "$fixture_server_pid" 2>/dev/null || { cat "$fixture_root/server.log"; exit 1; }
  [[ -s "$fixture_root/origin" ]] && break
  sleep 0.1
done
"$fixture_root/workspace-tests" "$(cat "$fixture_root/origin")/native-core.html" "$fixture_root/observer.js" "$project_root/tests/native/workspace-fixture.js"
