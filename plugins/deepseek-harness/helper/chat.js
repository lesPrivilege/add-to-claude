// ChatGPT in its own Electron window with a persistent session, the Electron counterpart of
// native/Chat.swift (ChatController) and native/Files.swift (FileFetcher). The page observer runs
// in the page's main world; the compiler and bridge run in the preload's isolated world and post
// compiled packets here over IPC.
import { BrowserWindow, app, ipcMain, shell, session as sessions } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHAT_HOSTS,
  START_URL,
  external,
  isFileLink,
  pageKey,
  popup,
  subframe,
  topLevel,
} from '../shared/navigation.js';
import { readyFrom, summary } from '../shared/protocol.js';
import { folderName, freeName, linkFiles, safeFileName, safeLabel } from '../shared/files.js';

/** The window's own persistent session; its ChatGPT login survives restarts. */
export const PARTITION = 'persist:add-to-claude';
const LINK_WAIT_MS = 10_000;
const LINK_FRESH_MS = 240_000;
const STALL_MS = 120_000;
const START_MS = 30_000;
const EXTERNAL_GAP_MS = 1000;
// window.open dispositions a link click produces; anything else (e.g. save-to-disk) is dropped.
const OPEN_DISPOSITIONS = new Set(['foreground-tab', 'background-tab', 'new-window']);
const DEVICE_PICKERS = ['select-hid-device', 'select-serial-port', 'select-usb-device'];

/** A URL in its canonical form, or null. */
const canonical = (url) => {
  try {
    return new URL(url).href;
  } catch {
    return null;
  }
};
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

export class ChatWindow {
  /**
   * @param options.preload - the built preload (preload.cjs).
   * @param options.filesRoot - where each conversation's files folder goes.
   * @param options.onChange - called with the panel state after every change.
   * @param options.partition - the session partition; tests pass an in-memory one.
   * @param options.start - the first page.
   */
  constructor({
    preload,
    filesRoot,
    onChange = () => {},
    partition = PARTITION,
    start = START_URL,
  }) {
    this.filesRoot = filesRoot;
    this.onChange = onChange;
    this.prepared = null;
    this.source = 'waiting';
    this.message = '';
    this.pinned = false;
    this.quitting = false;
    this.fileLinks = new Map();
    this.requested = new Set();
    this.waiters = [];
    this.saved = new Map();
    this.expected = new Map();
    this.reserved = new Set();
    this.inflight = null;
    this.lastExternal = 0;
    this.lastCrash = 0;
    this.session = sessions.fromPartition(partition);
    this.window = new BrowserWindow({
      width: 480,
      height: 760,
      minWidth: 360,
      minHeight: 360,
      show: false,
      title: 'ChatGPT panel',
      webPreferences: {
        partition,
        preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true,
      },
    });
    this.web = this.window.webContents;
    this.guard(this.web);
    this.watchSession();
    this.window.on('close', (event) => {
      if (this.quitting) return;
      // Like the macOS panel, closing only hides: the page keeps its state and a reply keeps streaming.
      event.preventDefault();
      this.window.hide();
    });
    for (const name of ['show', 'hide', 'focus', 'blur', 'minimize', 'restore'])
      this.window.on(name, () => this.changed());
    this.web.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.set(null, 'waiting');
    });
    this.web.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      const page = pageKey(url);
      // The observer can report a new chat before the URL updates; keep a matching preparation.
      if (!page || this.prepared?.page !== page) this.set(null, 'waiting');
    });
    this.web.on('render-process-gone', () => {
      // Reload once; a page that keeps crashing waits for the user instead of looping.
      const now = Date.now();
      if (now - this.lastCrash > 60_000) {
        this.set(null, 'unavailable', 'The page stopped. It is reloading.');
        this.web.reload();
      } else this.set(null, 'unavailable', 'The page stopped again. Close and reopen the panel.');
      this.lastCrash = now;
    });
    this.onHandoff = (event, body) => this.handoff(event, body);
    ipcMain.on('add-to-claude:handoff', this.onHandoff);
    void this.web.loadURL(start);
  }

  show() {
    // A helper in the background must take activation first, or the window opens behind the harness.
    if (process.platform === 'darwin') app.focus({ steal: true });
    this.window.show();
    this.window.moveTop();
    this.window.focus();
    // The window events may land before the OS settles; report the state as it is a tick later too.
    setImmediate(() => this.changed());
  }

  pin(on) {
    this.pinned = on;
    this.window.setAlwaysOnTop(on, 'floating');
    this.changed();
  }

  close() {
    this.quitting = true;
    ipcMain.off('add-to-claude:handoff', this.onHandoff);
    for (const waiter of this.waiters) waiter.done();
    this.waiters = [];
    this.window.destroy();
  }

  /** What the DeepSeek Harness panel shows. Never the Markdown. */
  state() {
    return {
      visible: !this.window.isDestroyed() && this.window.isVisible() && !this.window.isMinimized(),
      focused: !this.window.isDestroyed() && this.window.isFocused(),
      pinned: this.pinned,
      source: this.source,
      conversation: this.prepared ? summary(this.prepared, this.savedCount(this.prepared)) : null,
      message: this.message,
    };
  }

  changed() {
    if (!this.quitting) this.onChange(this.state());
  }

  set(prepared, source, message = '') {
    this.prepared = prepared;
    this.source = source;
    this.message = message;
    this.changed();
  }

  // MARK: packets from the isolated world

  handoff(event, body) {
    // Only this window's main frame, on a ChatGPT origin, reporting a page on that same origin.
    const frame = event.senderFrame;
    if (event.sender !== this.web || !frame || frame !== this.web.mainFrame) return;
    let origin;
    try {
      origin = new URL(frame.url);
    } catch {
      return;
    }
    if (origin.protocol !== 'https:' || !CHAT_HOSTS.has(origin.hostname)) return;
    if (!body || typeof body !== 'object' || typeof body.kind !== 'string') return;
    const page = pageKey(body.page);
    if (!page || !page.startsWith(`https://${origin.hostname}/`)) return;
    switch (body.kind) {
      case 'ready': {
        const prepared = readyFrom(body, this.web.getURL());
        if (prepared) this.set({ ...prepared, revision: randomUUID() }, 'ready');
        return;
      }
      case 'file': {
        // A link the page itself requested for one of its files; only https on ChatGPT's own hosts.
        if (typeof body.id !== 'string' || !isFileLink(body.url)) return;
        const key = `${body.id}|${typeof body.messageId === 'string' ? body.messageId : ''}`;
        this.fileLinks.set(key, {
          url: new URL(body.url).href,
          name: typeof body.name === 'string' ? body.name : '',
          seen: Date.now(),
        });
        this.settle(key);
        return;
      }
      case 'file-missing':
        this.settle(`${String(body.id ?? '')}|${String(body.messageId ?? '')}`);
        return;
      case 'changed':
        this.set(null, 'waiting');
        return;
      case 'invalid':
        this.set(null, 'unavailable', safeLabel(String(body.message ?? ''), 160));
        return;
      case 'unavailable':
        this.set(null, 'unavailable', 'This page did not expose its original messages.');
        return;
    }
  }

  // MARK: Add

  /** The hand-off text for the conversation on screen, with its files saved first when asked. */
  handOff(downloadFiles) {
    // Overlapping Adds share the one in flight (even if their file option differs).
    this.inflight ??= this.prepareHandOff(downloadFiles).finally(() => (this.inflight = null));
    return this.inflight;
  }

  async prepareHandOff(downloadFiles) {
    const prepared = this.prepared;
    if (!prepared) throw new Error('No conversation is ready in the ChatGPT window.');
    let filesNote = '';
    if (downloadFiles) filesNote = await this.downloadMissing(prepared);
    // Right before handing over, the conversation must still be the one this Add started with.
    if (
      this.prepared?.revision !== prepared.revision ||
      pageKey(this.web.getURL()) !== prepared.page
    )
      throw new Error('The conversation changed while its files were saved. Add again.');
    const { markdown, note } = linkFiles(prepared, this.copies(prepared));
    return { markdown, note: [filesNote, note].filter(Boolean).join(' ') };
  }

  // MARK: files

  copies(prepared) {
    const copies = new Map();
    for (const file of prepared.attachments) {
      const copy = this.saved.get(`${prepared.page}|${file.key}`);
      if (copy) copies.set(file.key, copy);
    }
    return copies;
  }

  savedCount(prepared) {
    return this.copies(prepared).size;
  }

  folder(title) {
    return join(this.filesRoot, folderName(title));
  }

  /** The page's link for a file, as in Chat.swift: by id and message, by id, or by a unique name. */
  link(file, prepared) {
    const now = Date.now();
    const fresh = (key) => {
      const link = this.fileLinks.get(key);
      return link && now - link.seen < LINK_FRESH_MS ? link : null;
    };
    const direct = fresh(`${file.id}|${file.messageId}`) ?? fresh(`${file.id}|`);
    if (direct) return direct;
    if (prepared.attachments.filter((other) => other.name === file.name).length !== 1) return null;
    let best = null;
    for (const [key] of this.fileLinks) {
      const link = fresh(key);
      if (link?.name === file.name && (!best || link.seen > best.seen)) best = link;
    }
    return best;
  }

  /** Ask the page for fresh links, the way it asks when the user opens a file; 10 s at most. */
  resolveLinks(files, prepared) {
    const missing = files.filter((file) => !this.link(file, prepared));
    if (!missing.length) return Promise.resolve();
    const keys = new Set(missing.map((file) => `${file.id}|${file.messageId}`));
    const ask = missing.filter((file) => !this.requested.has(`${file.id}|${file.messageId}`));
    for (const key of keys) this.requested.add(key);
    return new Promise((resolve) => {
      const waiter = { keys, done: resolve };
      this.waiters.push(waiter);
      if (ask.length)
        this.web.send(
          'add-to-claude:resolve',
          ask.map((file) => ({ id: file.id, messageId: file.messageId })),
        );
      setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index < 0) return;
        this.waiters.splice(index, 1);
        for (const key of waiter.keys) this.requested.delete(key);
        resolve();
      }, LINK_WAIT_MS);
    });
  }

  settle(key) {
    this.requested.delete(key);
    for (const waiter of this.waiters) waiter.keys.delete(key);
    const ready = this.waiters.filter((waiter) => waiter.keys.size === 0);
    this.waiters = this.waiters.filter((waiter) => waiter.keys.size > 0);
    for (const waiter of ready) waiter.done();
  }

  /** Downloads the conversation's files that are not saved yet, one at a time. Returns a note. */
  async downloadMissing(prepared) {
    const wanted = prepared.attachments.filter(
      (file) => !this.saved.has(`${prepared.page}|${file.key}`),
    );
    if (!wanted.length) return '';
    await this.resolveLinks(wanted, prepared);
    const items = wanted.flatMap((file) => {
      const link = this.link(file, prepared);
      return link ? [{ file, url: link.url, name: file.name }] : [];
    });
    if (!items.length)
      return `No download link for ${wanted.length === 1 ? wanted[0].name : `${wanted.length} files`}. Open it once in the chat, then Add again.`;
    const problems = [];
    for (const item of items) {
      const problem = await this.fetch(item, prepared);
      if (problem) problems.push(problem);
    }
    this.changed();
    const unlinked = wanted.length - items.length;
    return (
      (problems.length
        ? `${items.length - problems.length} saved; ${problems.length} failed: ${problems[0]}.`
        : `${items.length} file${items.length === 1 ? '' : 's'} saved.`) +
      (unlinked > 0 ? ` ${unlinked} had no download link.` : '')
    );
  }

  /** One download through the window's own session; resolves with a problem or null. */
  fetch(item, prepared) {
    const url = canonical(item.url);
    if (!url) return Promise.resolve('the link was malformed');
    return new Promise((resolve) => {
      const older = this.expected.get(url);
      if (older) {
        clearTimeout(older.timer);
        older.resolve('superseded by a newer download');
      }
      // A download that never starts (no will-download) must not hang the Add.
      const timer = setTimeout(() => {
        if (this.expected.get(url)?.resolve !== resolve) return;
        this.expected.delete(url);
        resolve('the download did not start');
      }, START_MS);
      this.expected.set(url, { key: item.file.key, name: item.name, prepared, resolve, timer });
      this.web.downloadURL(url);
    });
  }

  watchSession() {
    this.session.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(ALLOWED_PERMISSIONS.has(permission)),
    );
    this.session.setPermissionCheckHandler((_contents, permission) =>
      ALLOWED_PERMISSIONS.has(permission),
    );
    // Devices are never offered: no picker is shown and the request is cancelled.
    this.session.setDevicePermissionHandler?.(() => false);
    for (const name of DEVICE_PICKERS)
      this.session.on(name, (event, _details, callback) => {
        event.preventDefault();
        callback('');
      });
    this.session.on('will-download', (_event, item, contents) => this.download(item, contents));
  }

  /** Every download, ours or the page's, lands in the conversation's folder with a safe, free name. */
  download(item, contents) {
    // Any URL in the chain (redirects) or the final one can be the link we asked for.
    const urls = [...item.getURLChain(), item.getURL()].map(canonical).filter(Boolean);
    const url = urls.find((candidate) => this.expected.has(candidate));
    const expected = url ? this.expected.get(url) : undefined;
    if (expected) {
      this.expected.delete(url);
      clearTimeout(expected.timer);
    }
    // Only a file link the page itself opened may become an attachment's copy. Electron does not say
    // which frame started a download, so this excludes popups and other windows, not subframes.
    const own = Boolean(expected) || (contents === this.web && isFileLink(urls[0]));
    const prepared = expected?.prepared ?? this.prepared;
    const folder = this.folder(prepared?.title ?? 'ChatGPT');
    try {
      mkdirSync(folder, { recursive: true });
    } catch {
      item.cancel();
      this.message = 'The files folder is not writable.';
      this.changed();
      return expected?.resolve('the files folder is not writable');
    }
    const suggested = expected?.name || item.getFilename();
    const name = freeName(
      safeFileName(suggested, 'download'),
      (candidate) =>
        existsSync(join(folder, candidate)) || this.reserved.has(join(folder, candidate)),
    );
    const path = join(folder, name);
    this.reserved.add(path);
    item.setSavePath(path);
    // Only a download that makes no progress for STALL_MS is cancelled, however long it takes overall.
    let stalled = false;
    let stall;
    const arm = () => {
      clearTimeout(stall);
      stall = setTimeout(() => {
        stalled = true;
        if (item.getState() === 'progressing') item.cancel();
      }, STALL_MS);
    };
    if (expected) {
      arm();
      item.on('updated', arm);
    }
    item.once('done', async (_event, state) => {
      clearTimeout(stall);
      this.reserved.delete(path);
      if (state !== 'completed') {
        if (!expected) this.message = 'The download failed. Try it again in the chat.';
        this.changed();
        return expected?.resolve(
          state === 'interrupted'
            ? 'the download was interrupted'
            : stalled
              ? 'the download stalled'
              : 'the download was cancelled',
        );
      }
      let sha256;
      try {
        sha256 = await sha256File(path);
      } catch {
        return expected?.resolve('the download could not be read');
      }
      const key = expected
        ? expected.key
        : own
          ? this.uniqueKey(prepared, item.getFilename())
          : null;
      if (prepared && key) this.saved.set(`${prepared.page}|${key}`, { path, sha256 });
      if (!expected) this.message = `Saved ${name} to the files folder.`;
      this.changed();
      expected?.resolve(null);
    });
  }

  /** The page's own download points at a file only when exactly one file has that name. */
  uniqueKey(prepared, name) {
    const matches = prepared?.attachments.filter((file) => file.name === name) ?? [];
    return matches.length === 1 ? matches[0].key : null;
  }

  // MARK: navigation

  /** Top-level pages stay on ChatGPT and its sign-in hosts; anything else is the user's browser's job. */
  guard(contents) {
    contents.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame) {
        if (!subframe(event.url)) event.preventDefault();
        return;
      }
      this.decide(event, event.url);
    });
    contents.on('will-redirect', (event) => {
      if (event.isMainFrame) this.decide(event, event.url);
    });
    contents.on('select-bluetooth-device', (event, _devices, callback) => {
      event.preventDefault();
      callback('');
    });
    contents.setWindowOpenHandler(({ url, disposition, frame }) => {
      // Only a link click in the page's own main frame may open a window or the user's browser.
      if (!OPEN_DISPOSITIONS.has(disposition) || (frame && frame !== contents.mainFrame))
        return { action: 'deny' };
      const decision = popup(url);
      if (decision === 'popup')
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520,
            height: 680,
            title: 'Sign in',
            alwaysOnTop: true,
            webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
          },
        };
      if (decision === 'external') this.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('did-create-window', (child) => this.guard(child.webContents));
  }

  decide(event, url) {
    const decision = topLevel(url);
    if (decision === 'allow') return;
    event.preventDefault();
    if (decision === 'external') this.openExternal(url);
  }

  /** The user's browser, at most once a second: a page cannot flood it. Callers pass main-frame events only. */
  openExternal(url) {
    const now = Date.now();
    if (now - this.lastExternal < EXTERNAL_GAP_MS) return;
    this.lastExternal = now;
    void shell.openExternal(external(url));
  }
}
