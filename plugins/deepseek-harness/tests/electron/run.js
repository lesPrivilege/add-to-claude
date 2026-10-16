// Runs the Electron smoke test against a fresh build, with a throwaway profile and files folder.
//   node plugins/deepseek-harness/tests/electron/run.js [work-folder]
// Electron is located as the plugin locates it (DSH_CHATGPT_PANEL_ELECTRON or $DSH_HOME/electron);
// nothing is downloaded. The work folder defaults to dist/dsh-electron-smoke and is replaced.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { helperEnv, locateElectron } from '../../host/helper-process.js';

const here = fileURLToPath(new URL('./', import.meta.url));
const root = path.resolve(here, '../../../..');
const work = path.resolve(process.argv[2] ?? path.join(root, 'dist/dsh-electron-smoke'));
const electron = locateElectron();
if (!electron) {
  console.log('NOT RUN: Electron not found (set DSH_CHATGPT_PANEL_ELECTRON).');
  process.exit(0);
}
await rm(work, { recursive: true, force: true });
const packageDir = path.join(work, 'package');
const filesRoot = path.join(work, 'files');
await mkdir(filesRoot, { recursive: true });
execFileSync(process.execPath, [path.join(root, 'plugins/deepseek-harness/build.js'), packageDir], {
  stdio: 'inherit',
});

const child = spawn(
  electron,
  [
    path.join(here, 'smoke-main.js'),
    `--user-data-dir=${path.join(work, 'user-data')}`,
    packageDir,
    filesRoot,
  ],
  { stdio: ['ignore', 'inherit', 'pipe', 'ipc'], env: helperEnv() },
);
let result = null;
child.stderr.on('data', () => {});
child.on('message', (message) => (result = message));
const timer = setTimeout(() => child.kill(), 60_000);
child.on('exit', (code) => {
  clearTimeout(timer);
  for (const item of result?.checks ?? [])
    console.log(`${item.ok ? 'ok    ' : 'FAILED'} ${item.what}`);
  if (result?.error) console.log(result.error);
  console.log(
    result?.ok ? 'Electron smoke test passed.' : `Electron smoke test FAILED (exit ${code}).`,
  );
  process.exit(result?.ok ? 0 : 1);
});
