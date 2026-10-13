#!/usr/bin/env python3
"""Register this built helper for the one public extension identity. Never read browser profiles/cookies."""
import base64, hashlib, json, os, pathlib, struct, subprocess, sys
root = pathlib.Path(__file__).resolve().parent.parent
check_only = len(sys.argv) == 3 and sys.argv[1] == '--check'
if len(sys.argv) != 2 and not check_only:
    raise SystemExit('Usage: python3 scripts/install-native-host.py [--check] /absolute/path/to/gpt-handoff.app')
app = pathlib.Path(sys.argv[2] if check_only else sys.argv[1])
if not app.is_absolute() or app.suffix != '.app':
    raise SystemExit('Choose an absolute built .app path.')
host = app / 'Contents/MacOS/gpt-handoff-host'
if not host.is_file() or not os.access(host, os.X_OK):
    raise SystemExit('Build the app and its native host first.')
manifest_path = root / 'extension/manifest.json'
if not manifest_path.exists():
    manifest_path = pathlib.Path(__file__).resolve().parent / 'extension/manifest.json'
manifest = json.loads(manifest_path.read_text())
digest = hashlib.sha256(base64.b64decode(manifest['key'], validate=True)).hexdigest()[:32]
extension_id = ''.join(chr(97 + int(char, 16)) for char in digest)
payload = {'name': 'io.lesprivilege.gpt_handoff', 'description': 'Handoff selected-chat composer bridge',
           'path': str(host), 'type': 'stdio', 'allowed_origins': [f'chrome-extension://{extension_id}/']}
# Verify the actual built executable accepts this exact origin and speaks the expected framing.
ping = json.dumps({'id': 'setup-check', 'command': 'ping'}).encode()
try:
    probe = subprocess.run([str(host), payload['allowed_origins'][0]], input=struct.pack('<I', len(ping)) + ping,
                           capture_output=True, timeout=5, check=True)
    size = struct.unpack('<I', probe.stdout[:4])[0]
    response = json.loads(probe.stdout[4:])
    if size != len(probe.stdout) - 4 or response.get('protocol') != 1 or not response.get('ok'):
        raise ValueError('unexpected native protocol')
except (subprocess.SubprocessError, ValueError, struct.error):
    raise SystemExit('The native helper identity/protocol check failed; nothing was registered.')
if check_only:
    print(f'Native helper protocol/origin verified. Accessibility granted: {response.get("trusted") is True}. No registration changed.')
    raise SystemExit(0)
folder = pathlib.Path.home() / 'Library/Application Support/Google/Chrome/NativeMessagingHosts'
folder.mkdir(parents=True, exist_ok=True)
destination = folder / 'io.lesprivilege.gpt_handoff.json'
if destination.exists():
    if json.loads(destination.read_text()) != payload:
        raise SystemExit('A different Handoff registration exists. Preserve it before replacing it.')
else:
    with destination.open('x') as file:
        json.dump(payload, file, indent=2)
        file.write('\n')
    destination.chmod(0o600)
print(f'Registered one extension: {extension_id}')
print(destination)
