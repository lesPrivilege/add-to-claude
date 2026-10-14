import { mkdir, copyFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPageObserverScript } from '../src/page-observer.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist/extension');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const name of await readdir(path.join(root, 'extension')))
  await copyFile(path.join(root, 'extension', name), path.join(out, name));
// The worker imports the shared model; the observer is one self-contained page script.
for (const name of [
  'handoff.js',
  'model.js',
  'import.js',
  'message-visibility.js',
  'chatgpt-response.js',
])
  await copyFile(path.join(root, 'src', name), path.join(out, name));
await writeFile(path.join(out, 'observer.js'), createPageObserverScript());
process.stdout.write('Built dist/extension.\n');
