#!/bin/bash
# The release checklist's update proof: makes a throwaway next build (B+1) of a candidate and a feed for it
# under dist/staging, to serve from localhost. Run it on the owner's Mac: sign_update reads the EdDSA key
# from the login keychain, and the copy is signed with the candidate's identity.
# Usage: bash scripts/stage-update.sh "/absolute/Add to Claude.app"
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
candidate="${1:-}"
[[ "$candidate" == /*.app && -d "$candidate" ]] || { echo 'Usage: bash scripts/stage-update.sh "/absolute/Add to Claude.app"' >&2; exit 1; }
staging="$project_root/dist/staging"
[[ ! -e "$staging" ]] || { echo "Move the existing $staging aside first." >&2; exit 1; }
bash "$project_root/scripts/fetch-sparkle.sh"

build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$candidate/Contents/Info.plist")"
next=$((build + 1))
version="0.0.$next-staging"
mkdir -p "$staging"
app="$staging/Add to Claude.app"
ditto "$candidate" "$app"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $next" -c "Set :CFBundleShortVersionString $version" "$app/Contents/Info.plist"
# The same identity as the candidate, so the update keeps the Accessibility grant.
identity="${ADD_TO_CLAUDE_SIGNING_IDENTITY:-add-to-claude Local}"
security find-identity -p codesigning 2>/dev/null | grep -q "\"$identity\"" || { echo "No \"$identity\" identity in the keychain." >&2; exit 1; }
codesign --force --sign "$identity" --identifier io.lesprivilege.add-to-claude "$app"
codesign --verify --deep --strict "$app"

archive="$staging/add-to-claude-$version.zip"
ditto -c -k --keepParent "$app" "$archive"
rm -r "$app"
signature="$("$project_root/vendor/Sparkle/bin/sign_update" "$archive")"
[[ "$signature" =~ ^sparkle:edSignature=\"[A-Za-z0-9+/=]+\"\ length=\"[0-9]+\"$ ]] || { echo 'sign_update gave no signature.' >&2; exit 1; }
minimum="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$candidate/Contents/Info.plist")"
cat > "$staging/appcast.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Add to Claude (staging)</title>
    <item>
      <title>$version</title>
      <sparkle:version>$next</sparkle:version>
      <sparkle:shortVersionString>$version</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>$minimum</sparkle:minimumSystemVersion>
      <pubDate>$(LC_ALL=C date -u '+%a, %d %b %Y %H:%M:%S +0000')</pubDate>
      <enclosure url="http://localhost:8000/add-to-claude-$version.zip" $signature type="application/octet-stream"/>
    </item>
  </channel>
</rss>
XML
echo "Staged build $next as $version in $staging."
echo "Serve it:      python3 -m http.server 8000 --bind 127.0.0.1 --directory \"$staging\""
echo "Point at it:   defaults write io.lesprivilege.add-to-claude SUFeedURL http://localhost:8000/appcast.xml"
echo "Afterwards:    defaults delete io.lesprivilege.add-to-claude SUFeedURL"
