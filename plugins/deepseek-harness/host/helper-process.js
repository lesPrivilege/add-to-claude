// The Electron helper that shows ChatGPT in its own window, run and supervised by the host half.
//
// Electron is not downloaded here. The helper uses the Electron that the dsh-pet plugin keeps at
// $DSH_HOME/electron (macOS: Electron.app/Contents/MacOS/Electron), or the executable named by
// DSH_CHATGPT_PANEL_ELECTRON. The host and helper talk over Node's IPC pipe on fd 3, inherited by
// this child only: no port, no socket path, nothing another process can connect to.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { addReply, helperState } from '../shared/protocol.js';

const RELATIVE = {
  darwin: join('Electron.app', 'Contents', 'MacOS', 'Electron'),
  win32: 'electron.exe',
  linux: 'electron',
};

/** Where to find Electron: an explicit path first, then dsh-pet's landing folder. */
export function electronCandidates({
  env = process.env,
  home = homedir(),
  platform = process.platform,
} = {}) {
  const list = [];
  if (env.DSH_CHATGPT_PANEL_ELECTRON) list.push(env.DSH_CHATGPT_PANEL_ELECTRON);
  const dshHome = env.DSH_HOME || join(home, '.dsh');
  if (RELATIVE[platform]) list.push(join(dshHome, 'electron', RELATIVE[platform]));
  return list;
}

export function locateElectron(options = {}, exists = existsSync) {
  return electronCandidates(options).find((path) => exists(path));
}

/** The child's environment: the host's own, without the flag that would make Electron plain Node. */
export function helperEnv(env = process.env) {
  const next = { ...env };
  delete next.ELECTRON_RUN_AS_NODE;
  return next;
}

const ADD_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * One helper process at a time. Started on the first Open, never automatically restarted: a helper
 * that exits leaves the panel "closed" until the user opens it again.
 */
export class HelperProcess {
  constructor({ helperDir, logger = console, launch = spawn, locate = locateElectron } = {}) {
    this.helperDir = helperDir;
    this.logger = logger;
    this.launch = launch;
    this.locate = locate;
    this.child = undefined;
    this.state = null;
    this.unavailable = '';
    this.pending = new Map();
    this.nextId = 1;
    this.disposed = false;
  }

  /** The panel state the client renders. */
  status() {
    if (this.child)
      return {
        helper: 'running',
        ...(this.state ?? {
          visible: false,
          pinned: false,
          source: 'waiting',
          conversation: null,
          message: '',
        }),
      };
    return this.unavailable
      ? { helper: 'unavailable', reason: this.unavailable }
      : { helper: 'stopped' };
  }

  /** Start the helper if needed and bring its window forward. */
  open() {
    if (this.disposed) throw new Error('The panel is shutting down.');
    if (!this.child) this.start();
    this.send({ type: 'show' });
  }

  pin(on) {
    if (!this.child) throw new Error('The ChatGPT window is closed.');
    this.send({ type: 'pin', on });
  }

  /** Ask the helper for the hand-off text, with files downloaded first when asked. */
  add(downloadFiles) {
    if (!this.child) return Promise.reject(new Error('The ChatGPT window is closed.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The ChatGPT window did not answer.'));
      }, ADD_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ type: 'add', id, downloadFiles });
    });
  }

  start() {
    const electron = this.locate();
    if (!electron) {
      this.unavailable =
        'Electron was not found. Install the dsh-pet plugin once (it keeps Electron in ~/.dsh/electron) or set DSH_CHATGPT_PANEL_ELECTRON.';
      throw new Error(this.unavailable);
    }
    this.unavailable = '';
    this.state = null;
    const child = this.launch(electron, [this.helperDir], {
      cwd: this.helperDir,
      env: helperEnv(),
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
    });
    this.child = child;
    // Electron's own diagnostics only; the helper never writes conversation text to stderr.
    child.stderr?.on('data', () => {});
    child.on('message', (message) => this.receive(child, message));
    child.once('error', (error) => {
      this.logger.warn?.(`[dsh-chatgpt-panel] helper failed to start: ${error.message}`);
      this.exited(child, error.message);
    });
    child.once('exit', (code, signal) => this.exited(child, signal ?? `exit ${code}`));
  }

  receive(child, message) {
    if (child !== this.child) return;
    if (message?.type === 'state') {
      const state = helperState(message);
      if (state) this.state = state;
      return;
    }
    if (message?.type === 'fatal') {
      this.unavailable = String(message.reason ?? 'The ChatGPT window stopped.').slice(0, 200);
      return;
    }
    const reply = addReply(message);
    const waiter = reply && this.pending.get(reply.id);
    if (!waiter) return;
    this.pending.delete(reply.id);
    clearTimeout(waiter.timer);
    if (reply.ok) waiter.resolve({ markdown: reply.markdown, note: reply.note });
    else waiter.reject(new Error(reply.error || 'The conversation could not be prepared.'));
  }

  exited(child, reason) {
    if (child !== this.child) return;
    this.child = undefined;
    this.state = null;
    for (const [id, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('The ChatGPT window closed.'));
      this.pending.delete(id);
    }
    if (!this.disposed && !this.unavailable)
      this.logger.debug?.(`[dsh-chatgpt-panel] helper ended (${reason})`);
  }

  send(message) {
    try {
      this.child?.send(message);
    } catch {
      /* A helper that is exiting reports through its exit event. */
    }
  }

  dispose() {
    this.disposed = true;
    const child = this.child;
    if (!child) return;
    this.send({ type: 'quit' });
    // The helper also quits on its own when this pipe closes with the host.
    setTimeout(() => child.exitCode === null && child.kill(), 3000).unref?.();
  }
}
