import { mkdir, readdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist/gpt-handoff');
if (Number(process.versions.node.split('.')[0]) < 24)
  throw new Error('Build with Node.js 24 or newer.');
const files = [];
async function collect(relative) {
  for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const name = path.posix.join(relative, entry.name);
    // Project conversation provenance stays in the private repository, not the runnable build.
    if (name === 'docs/sources') continue;
    if (entry.isSymbolicLink()) throw new Error(`Do not package symlinks: ${name}`);
    if (entry.isDirectory()) await collect(name);
    else if (entry.isFile()) files.push(name);
  }
}
for (const dir of ['src', 'web', 'native', 'extension', 'scripts', 'tests', 'docs'])
  await collect(dir);
files.push(
  'package.json',
  'package-lock.json',
  'README.md',
  'AGENTS.md',
  'THIRD_PARTY_NOTICES.md',
  'playwright.config.js',
  'playwright.extension.config.js',
  '.nvmrc',
  '.prettierrc.json',
  '.prettierignore',
);
files.sort();
await rm(out, { recursive: true, force: true });
const manifest = [];
for (const name of files) {
  const bytes = await readFile(path.join(root, name));
  manifest.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
  await mkdir(path.dirname(path.join(out, name)), { recursive: true });
  await copyFile(path.join(root, name), path.join(out, name));
}
await writeFile(path.join(out, 'SHA256SUMS'), manifest.join('\n') + '\n');
process.stdout.write(
  `Built dist/gpt-handoff (${files.length} files). Run: node dist/gpt-handoff/src/server.js\n`,
);
