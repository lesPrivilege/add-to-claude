#!/bin/bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/handoff-host.XXXXXX")"
trap 'rm -r "$fixture_root"' EXIT
xcrun --sdk macosx swiftc -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
 "$project_root/native/NativeHostProtocol.swift" "$project_root/tests/native/NativeHostTests.swift" -o "$fixture_root/host-tests"
"$fixture_root/host-tests"
