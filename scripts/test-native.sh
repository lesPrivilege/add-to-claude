#!/bin/bash
# Native checks: the WebKit bridge in a real WKWebView, then real Accessibility against a synthetic app.
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/gh-native.XXXXXX")"
trap 'rm -r "$work"' EXIT
native="$project_root/native"
node "$project_root/scripts/build-webkit.js" "$work/webkit" >/dev/null
xcrun --sdk macosx swiftc -swift-version 5 -target "$(uname -m)-apple-macos14.0" -parse-as-library \
  "$project_root/tests/native/WebKitTests.swift" "$native/Chat.swift" "$native/Handoff.swift" "$native/Views.swift" \
  "$native/Composer.swift" -o "$work/webkit-tests"
"$work/webkit-tests" "$work/webkit"
status=0
bash "$project_root/scripts/test-native-accessibility.sh" || status=$?
# Exit 2 means the runner lacks Accessibility access, so nothing was tested; report it as not run.
[[ $status -eq 2 ]] && { echo 'NOT RUN: Accessibility checks need this terminal to have Accessibility access.'; exit 0; }
exit $status
