#!/bin/bash
# Fetches the pinned Sparkle release into vendor/Sparkle and checks its SHA-256. The build links
# vendor/Sparkle/Sparkle.framework; release scripts use its bin/ tools (generate_keys, sign_update).
set -euo pipefail
version="2.10.0"
sha256="c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c"
project_root="$(cd "$(dirname "$0")/.." && pwd)"
target="$project_root/vendor/Sparkle"
if [[ -f "$target/VERSION" && "$(cat "$target/VERSION")" == "$version" ]]; then exit 0; fi
archive="${1:-}"
work="$(mktemp -d "${TMPDIR:-/tmp}/sparkle.XXXXXX")"
trap 'rm -r "$work"' EXIT
if [[ -z "$archive" ]]; then
  archive="$work/Sparkle-$version.tar.xz"
  curl -fsSL -o "$archive" "https://github.com/sparkle-project/Sparkle/releases/download/$version/Sparkle-$version.tar.xz"
fi
echo "$sha256  $archive" | shasum -a 256 -c - >/dev/null || { echo "Sparkle $version does not match its pinned SHA-256." >&2; exit 1; }
mkdir -p "$work/x"
tar -xJf "$archive" -C "$work/x"
rm -rf "$target"
mkdir -p "$(dirname "$target")"
mv "$work/x" "$target"
echo "$version" > "$target/VERSION"
echo "Sparkle $version in vendor/Sparkle."
