#!/bin/bash
# Native checks: the real relay against the app-side link, then real Accessibility against a synthetic app.
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/gh-native.XXXXXX")"
trap 'rm -r "$work"' EXIT
target="$(uname -m)-apple-macos14.0"
native="$project_root/native"
# Test builds read the socket path from GPT_HANDOFF_SOCKET; release builds cannot.
xcrun --sdk macosx swiftc -swift-version 5 -target "$target" -parse-as-library -D GPT_HANDOFF_TEST \
  "$native/Relay.swift" "$native/Link.swift" "$native/NativeHostOrigin.swift" -o "$work/gpt-handoff-host"
xcrun --sdk macosx swiftc -swift-version 5 -target "$target" -parse-as-library -D GPT_HANDOFF_TEST \
  "$project_root/tests/native/LinkTests.swift" "$native/Link.swift" "$native/NativeHostOrigin.swift" -o "$work/gpt-handoff"
"$work/gpt-handoff" "$work"
status=0
bash "$project_root/scripts/test-native-accessibility.sh" || status=$?
# Exit 2 means the runner lacks Accessibility access, so nothing was tested; report it as not run.
[[ $status -eq 2 ]] && { echo 'NOT RUN: Accessibility checks need this terminal to have Accessibility access.'; exit 0; }
exit $status
