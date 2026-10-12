import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist/extension');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const name of (await readdir(path.join(root, 'extension'))).sort()) {
  await writeFile(path.join(out, name), await readFile(path.join(root, 'extension', name)));
}
for (const name of ['capture.js', 'collect.js', 'page-scroll.js', 'model.js']) {
  await writeFile(path.join(out, name), await readFile(path.join(root, 'src', name)));
}
process.stdout.write('Built dist/extension. Load this directory unpacked in Chrome.\n');
