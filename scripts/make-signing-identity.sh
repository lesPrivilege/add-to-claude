#!/bin/bash
# Creates a local code-signing identity, "add-to-claude Local", in your login keychain.
# Builds signed with it keep the same designated requirement, so macOS keeps the Accessibility
# grant across updates instead of asking again. It is self-signed and only for this Mac: it does
# not notarize anything and is not trusted by other Macs. Run it once, yourself.
set -euo pipefail
name="add-to-claude Local"
if security find-identity -p codesigning 2>/dev/null | grep -q "\"$name\""; then
  echo "\"$name\" already exists."; exit 0
fi
work="$(mktemp -d "${TMPDIR:-/tmp}/signing.XXXXXX")"
trap 'rm -r "$work"' EXIT
cat > "$work/cert.conf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $name
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$work/cert.conf" \
  -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null
password="$(openssl rand -hex 16)"
openssl pkcs12 -export -inkey "$work/key.pem" -in "$work/cert.pem" -name "$name" \
  -passout "pass:$password" -out "$work/identity.p12" 2>/dev/null
# Only codesign may use the key without asking.
security import "$work/identity.p12" -k "$HOME/Library/Keychains/login.keychain-db" \
  -P "$password" -T /usr/bin/codesign >/dev/null
echo "Created \"$name\". Rebuild with: bash scripts/build-macos.sh"
echo "Grant Accessibility once more to that signed build; later builds keep it."
