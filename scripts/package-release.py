#!/usr/bin/env python3
"""Create one local source/history/evidence archive. Uses Python 3 + Git; no network."""
import hashlib
import io
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def git(*arguments):
    return subprocess.check_output(["git", "-C", str(ROOT), *arguments])


if Path(git("rev-parse", "--show-toplevel").decode().strip()).resolve() != ROOT:
    raise SystemExit("Run from the independent gpt-handoff repository.")
if git("status", "--porcelain").strip():
    raise SystemExit("Commit the reviewed source and evidence before packaging.")

version = json.loads((ROOT / "package.json").read_text())["version"]
if not isinstance(version, str) or not all(c in "0123456789.-abcdefghijklmnopqrstuvwxyz" for c in version):
    raise SystemExit("Use a plain version string.")
sha = git("rev-parse", "HEAD").decode().strip()
branch = git("branch", "--show-current").decode().strip()
output = ROOT / "artifacts" / "releases" / f"gpt-handoff-{version}.zip"
output.parent.mkdir(parents=True, exist_ok=True)
if output.exists():
    raise SystemExit("Preserve existing checkpoints. Bump the version before packaging again.")
files = {}
source = zipfile.ZipFile(io.BytesIO(git("archive", "--format=zip", "HEAD")))
for entry in source.infolist():
    if entry.is_dir():
        continue
    if entry.filename.startswith("/") or ".." in Path(entry.filename).parts:
        raise SystemExit("Unsafe tracked path in source archive.")
    files[f"source/gpt-handoff/{entry.filename}"] = source.read(entry)
# Include the ready-to-load extension, assembled only from this committed source.
for name, data in list(files.items()):
    prefix = "source/gpt-handoff/extension/"
    if name.startswith(prefix):
        files[f"chrome-extension/{name[len(prefix):]}"] = data
for module in ("capture.js", "model.js", "collect.js", "page-scroll.js", "import.js", "chatgpt-response.js", "original.js"):
    files[f"chrome-extension/{module}"] = files[f"source/gpt-handoff/src/{module}"]
with tempfile.TemporaryDirectory(prefix="gpt-handoff-package-") as temp:
    bundle = Path(temp) / "gpt-handoff.bundle"
    git("bundle", "create", str(bundle), "--all")
    files["gpt-handoff.bundle"] = bundle.read_bytes()
files["HANDOFF.txt"] = f"""gpt-handoff {version}
Local branch: {branch}
Local commit: {sha}
Remote: not created/pushed; see source/gpt-handoff/docs/release-checklist.md.

Run with installed Node 24 or newer:
  cd source/gpt-handoff
  node src/server.js
  Open http://127.0.0.1:43119/ on that machine.

Chrome extension (requires an authorized browser that permits unpacked extensions):
  Open chrome://extensions, enable Developer mode, Load unpacked -> chrome-extension.
  This VM's managed policy blocks extension loading; no policy was changed.

Restore full Git history:
  git clone gpt-handoff.bundle restored-gpt-handoff

Tests, native build recipe, screenshots and independent review are in the source tree.
Portable development handoff only. No macOS binary/signature or real-agent validation.
Selected-tab traversal, virtualized accumulation, cancellation and desk handoff have synthetic browser tests. Normal file downloads/file selection/controlled composer bytes are exercised separately from API-mocked download receipts. Installed-extension lifecycle is blocked by managed VM policy.
DOM collections remain unverified; observed start/end boundaries are not proof of server completeness. Live authenticated ChatGPT acceptance is outstanding.
See source/gpt-handoff/docs/claude-handoff.md for the requested final visual/maintenance handoff.
This is a private development checkpoint with full Git history and project provenance.
Do not publish it as an end-user binary distribution.
""".encode()
files["SHA256SUMS"] = "".join(
    f"{hashlib.sha256(data).hexdigest()}  {name}\n" for name, data in sorted(files.items())
).encode()
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name, data in sorted(files.items()):
        entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, data)
print(f"{output}\n{output.stat().st_size} bytes\nSHA-256 {hashlib.sha256(output.read_bytes()).hexdigest()}")
