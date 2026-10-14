import { importBrowserResponse } from './chatgpt-response.js';
import { projectMarkdown } from './model.js';

export const HOST = 'io.lesprivilege.gpt_handoff';
const ORIGINS = ['https://chatgpt.com', 'https://chat.openai.com'];
const MAX_MARKDOWN = 16 * 1024 * 1024;
const MAX_FRAME = 60 * 1024 * 1024; // Below the relay's 64 MiB frame limit after JSON escaping.

function pageKey(text) {
  try {
    const url = new URL(text);
    return ORIGINS.includes(url.origin) && !url.username && !url.password
      ? url.origin + url.pathname
      : null;
  } catch {
    return null;
  }
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Follows the ChatGPT tab the user last looked at and serves its prepared context to the
 * menu-bar app over native messaging. Nothing is fetched, stored or sent anywhere else.
 */
export function createHandoff(api, { retryMs = 5000 } = {}) {
  let tab = null; // { id, title, page }
  let source = null; // { page, revision, hash, markdown, model }
  let status = 'none';
  let message = '';
  let sequence = 0;
  let port = null;
  let appConnected = false;
  let retry = null;

  function state() {
    const model = source?.model;
    return {
      status,
      message,
      title: tab?.title ?? '',
      page: tab?.page ?? '',
      revision: source?.revision ?? '',
      turns: model?.turns.length ?? 0,
      files: model?.attachments.length ?? 0,
      verification: model?.verification.status ?? '',
      issues: model?.verification.issues.slice(0, 5).map((issue) => issue.message) ?? [],
      bytes: source ? new TextEncoder().encode(source.markdown).byteLength : 0,
    };
  }
  function publish() {
    if (port && appConnected) port.postMessage({ event: 'state', state: state() });
  }
  function set(nextStatus, nextMessage = '') {
    status = nextStatus;
    message = nextMessage;
    if (nextStatus !== 'ready') source = null;
    publish();
  }

  async function accept(packet, from) {
    if (from !== tab?.id) return;
    const turn = ++sequence; // Each packet supersedes one still being prepared.
    if (packet.kind === 'changed') return set('waiting');
    if (packet.kind === 'unavailable')
      return set('unavailable', 'This page did not expose its original messages.');
    if (packet.kind !== 'response') return;
    // The page can report a new conversation before Chrome's URL update arrives.
    tab.page = pageKey(packet.pageUrl);
    try {
      const model = importBrowserResponse(packet.body, packet);
      const markdown = projectMarkdown(model);
      if (new TextEncoder().encode(markdown).byteLength > MAX_MARKDOWN)
        throw new Error('This conversation exceeds the 16 MiB context limit.');
      const hash = await sha256(markdown);
      if (turn !== sequence || from !== tab?.id) return;
      source = { page: tab.page, revision: crypto.randomUUID(), hash, markdown, model };
      status = 'ready';
      message = '';
      publish();
    } catch (error) {
      if (turn === sequence)
        set('invalid', error.message || 'This conversation could not be read.');
    }
  }

  async function follow() {
    const [active] = await api.tabs.query({ active: true, lastFocusedWindow: true });
    const page = active && pageKey(active.url ?? '');
    if (!page) return;
    if (active.id === tab?.id) {
      tab.title = active.title ?? tab.title;
      return publish();
    }
    const turn = ++sequence;
    tab = { id: active.id, title: active.title ?? '', page };
    set('waiting');
    try {
      const reply = await api.tabs.sendMessage(active.id, { type: 'replay' }, { frameId: 0 });
      if (turn !== sequence) return;
      if (reply?.packet && pageKey(reply.packet.pageUrl) === pageKey(reply.href ?? ''))
        await accept(reply.packet, active.id);
    } catch {
      // The tab was open before the extension loaded, so no observer is attached.
      if (turn === sequence) set('reload', 'Reload this ChatGPT tab once.');
    }
  }

  async function check(request) {
    const frozen = source;
    if (!frozen || frozen.revision !== request.revision || frozen.hash !== request.hash)
      return false;
    try {
      const where = await api.tabs.sendMessage(tab.id, { type: 'where' }, { frameId: 0 });
      return source === frozen && pageKey(where?.href) === frozen.page;
    } catch {
      return false;
    }
  }

  async function answer(request) {
    if (request.command === 'context') {
      if (!source) return { ok: false, error: 'No conversation is ready.' };
      const { markdown, revision, hash } = source;
      const reply = { ok: true, markdown, revision, hash };
      if (new TextEncoder().encode(JSON.stringify(reply)).byteLength > MAX_FRAME)
        return { ok: false, error: 'This conversation is too large to transfer.' };
      return reply;
    }
    if (request.command === 'check') return { ok: true, current: await check(request) };
    return { ok: false, error: 'Unsupported request.' };
  }

  function connect() {
    if (port) return;
    clearTimeout(retry);
    const opened = api.runtime.connectNative(HOST);
    port = opened;
    opened.onMessage.addListener((packet) => {
      if (port !== opened) return;
      if (packet?.event === 'app') {
        appConnected = packet.connected === true;
        return publish();
      }
      if (typeof packet?.id !== 'string') return;
      void answer(packet).then(
        (reply) => port === opened && opened.postMessage({ id: packet.id, ...reply }),
        () => port === opened && opened.postMessage({ id: packet.id, ok: false }),
      );
    });
    opened.onDisconnect.addListener(() => {
      void api.runtime.lastError; // Consume Chrome's message; it can name local paths.
      if (port !== opened) return;
      port = null;
      appConnected = false;
      retry = setTimeout(connect, retryMs);
    });
  }

  api.runtime.onMessage.addListener((request, sender) => {
    if (request?.type !== 'source' || sender.id !== api.runtime.id || sender.frameId !== 0)
      return false;
    if (pageKey(sender.url ?? '') && pageKey(request.packet?.pageUrl) === pageKey(sender.url))
      void accept(request.packet, sender.tab?.id);
    return false;
  });
  api.tabs.onActivated.addListener(() => void follow());
  api.windows.onFocusChanged.addListener(() => void follow());
  api.tabs.onUpdated.addListener((id, change, updated) => {
    if (id !== tab?.id) return void (change.status === 'complete' && follow());
    if (change.title) tab.title = change.title;
    if (change.status === 'loading' && !change.url) return set('waiting');
    if (change.url) {
      const page = pageKey(change.url);
      if (!page) {
        tab = null;
        return set('none');
      }
      if (page !== tab.page) {
        tab.page = page;
        sequence++;
        return set('waiting');
      }
    }
    if (updated.active) publish();
  });
  api.tabs.onRemoved.addListener((id) => {
    if (id !== tab?.id) return;
    tab = null;
    sequence++;
    set('none');
  });

  connect();
  void follow();
  return { state, follow, answer };
}
