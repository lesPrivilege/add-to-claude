#!/bin/bash
# Prints what a running app's windows expose over Accessibility about their conversation: titles,
# AXDocument, each AXWebArea's AXURL, and the id Add to Claude would read. Read-only; nothing is
# clicked, typed or sent. Needs the terminal to have Accessibility access.
#   bash scripts/probe-target-ax.sh [bundle id]   (default: com.anthropic.claudefordesktop)
# Open two Claude conversations in two windows (or switch conversations in one) and run it after each
# change. The output can contain conversation titles; redact them before sharing.
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/target-ax.XXXXXX")"
trap 'rm -r "$work"' EXIT
xcrun --sdk macosx swiftc -swift-version 5 -target "$(uname -m)-apple-macos14.0" -parse-as-library \
  "$project_root/scripts/probe-target-ax.swift" "$project_root/native/Composer.swift" -o "$work/probe"
"$work/probe" "$@"
