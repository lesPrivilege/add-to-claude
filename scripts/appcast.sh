#!/bin/bash
# Writes appcast.xml, the update feed Sparkle reads (SUFeedURL), for one release archive. Run it on the
# owner's Mac after building and zipping the release: sign_update reads the EdDSA private key from the
# login keychain. Usage: bash scripts/appcast.sh /absolute/add-to-claude-<version>.zip
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
archive="${1:-}"
[[ "$archive" == /*.zip && -f "$archive" ]] || { echo 'Usage: bash scripts/appcast.sh /absolute/add-to-claude-<version>.zip' >&2; exit 1; }
plist="$project_root/native/Info.plist"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")"
build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$plist")"
minimum="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$plist")"
[[ "$(basename "$archive")" == "add-to-claude-$version.zip" ]] || { echo "Expected add-to-claude-$version.zip for version $version." >&2; exit 1; }
bash "$project_root/scripts/fetch-sparkle.sh"
# The archive must hold this build, so the feed never offers a version the archive does not contain.
work="$(mktemp -d "${TMPDIR:-/tmp}/appcast.XXXXXX")"
trap 'rm -r "$work"' EXIT
ditto -x -k "$archive" "$work"
inside="$work/Add to Claude.app/Contents/Info.plist"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$inside")" == "$build" ]] || { echo "The archive does not hold build $build." >&2; exit 1; }
codesign --verify --deep --strict "$work/Add to Claude.app" || { echo 'The archived app does not pass codesign --verify --deep --strict.' >&2; exit 1; }
# Installed copies verify updates with the public key they carry. A key that does not match the private
# key signing here would strand every copy on this version, so all three must agree.
keychain="$("$project_root/vendor/Sparkle/bin/generate_keys" -p)"
source_key="$(/usr/libexec/PlistBuddy -c 'Print :SUPublicEDKey' "$plist")"
archived_key="$(/usr/libexec/PlistBuddy -c 'Print :SUPublicEDKey' "$inside")"
[[ -n "$keychain" && "$keychain" == "$source_key" && "$keychain" == "$archived_key" ]] \
  || { echo 'SUPublicEDKey in native/Info.plist, in the archive and in the keychain differ.' >&2; exit 1; }
signature="$("$project_root/vendor/Sparkle/bin/sign_update" "$archive")"
[[ "$signature" =~ ^sparkle:edSignature=\"[A-Za-z0-9+/=]+\"\ length=\"[0-9]+\"$ ]] || { echo 'sign_update gave no signature.' >&2; exit 1; }
repository="https://github.com/lesPrivilege/add-to-claude"
enclosure="$repository/releases/download/v$version/add-to-claude-$version.zip"
# The feed must never name an archive that cannot be downloaded, or one other than this.
curl -fsSL -o "$work/published.zip" "$enclosure" || { echo "The release asset is not downloadable yet: $enclosure" >&2; exit 1; }
[[ "$(shasum -a 256 < "$work/published.zip")" == "$(shasum -a 256 < "$archive")" ]] \
  || { echo "The published asset differs from $archive." >&2; exit 1; }
cat > "$project_root/appcast.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Add to Claude</title>
    <link>$repository</link>
    <item>
      <title>$version</title>
      <pubDate>$(LC_ALL=C date -u '+%a, %d %b %Y %H:%M:%S +0000')</pubDate>
      <sparkle:version>$build</sparkle:version>
      <sparkle:shortVersionString>$version</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>$minimum</sparkle:minimumSystemVersion>
      <link>$repository/releases/tag/v$version</link>
      <enclosure url="$enclosure" type="application/octet-stream" $signature />
    </item>
  </channel>
</rss>
XML
echo "Wrote appcast.xml for $version ($build). Commit and push it to publish the update."
