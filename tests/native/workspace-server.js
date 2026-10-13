import { startServer } from '../../src/server.js';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = await mkdtemp(path.join(tmpdir(), 'handoff-workspace-server-'));
await mkdir(path.join(root, 'web'));
await cp(new URL('../../src/', import.meta.url), path.join(root, 'src'), { recursive: true });
await cp(
  new URL('../../web/native-core.html', import.meta.url),
  path.join(root, 'web/native-core.html'),
);
const original = await readFile(new URL('../../web/native-core.js', import.meta.url), 'utf8');
// Keep the actual compiler; only delay one fixture result to exercise native callback ordering.
await writeFile(
  path.join(root, 'web/native-core.js'),
  original +
    `
const originalCompile = globalThis.handoffCore.compile;
globalThis.handoffCore = Object.freeze({ async compile(body, evidence) {
  if (evidence.pageUrl.endsWith('/slow-synthetic')) await new Promise(r => setTimeout(r, 500));
  return originalCompile(body, evidence);
} });
`,
);
const server = await startServer({ port: 0, root });
await writeFile(process.argv[2], server.origin);
process.once('SIGTERM', async () => {
  await server.close();
  await rm(root, { recursive: true });
});
