#!/bin/bash
# Native checks: the delivery log and scope rule, the WebKit bridge in a real WKWebView, the terminal
# adapter's logic, then real Accessibility against a synthetic app.
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/add-to-claude-native.XXXXXX")"
trap 'rm -r "$work"' EXIT
native="$project_root/native"
# The app's sources without its entry point, for the WebKit test's own main.
app=()
for file in "$native"/*.swift; do [[ $file == */Main.swift || $file == */App.swift ]] || app+=("$file"); done
xcrun --sdk macosx swiftc -swift-version 5 -target "$(uname -m)-apple-macos14.0" -parse-as-library \
  "$project_root/tests/native/DeliveryTests.swift" "$native/Delivery.swift" "$native/Composer.swift" -o "$work/delivery-tests"
"$work/delivery-tests"
node "$project_root/scripts/build-webkit.js" "$work/webkit" >/dev/null
xcrun --sdk macosx swiftc -swift-version 5 -target "$(uname -m)-apple-macos14.0" -parse-as-library \
  "$project_root/tests/native/WebKitTests.swift" "${app[@]}" -o "$work/webkit-tests"
"$work/webkit-tests" "$work/webkit" "$project_root/tests/fixtures/bridge-messages.json"
xcrun --sdk macosx swiftc -swift-version 5 -target "$(uname -m)-apple-macos14.0" -parse-as-library \
  "$project_root/tests/native/TerminalTests.swift" "${app[@]}" -o "$work/terminal-tests"
"$work/terminal-tests"
status=0
bash "$project_root/scripts/test-native-accessibility.sh" || status=$?
# Exit 2 means the runner lacks Accessibility access, so nothing was tested; report it as not run.
[[ $status -eq 2 ]] && { echo 'NOT RUN: Accessibility checks need this terminal to have Accessibility access.'; exit 0; }
exit $status
