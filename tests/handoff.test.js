import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createHandoff, HOST } from '../src/handoff.js';

const conversation = (id, text) =>
  JSON.stringify({
    conversation_id: id,
    title: 'Synthetic chat',
    current_node: 'a',
    mapping: {
      root: { parent: null, children: ['u'], message: null },
      u: {
        parent: 'root',
        children: ['a'],
        message: {
          id: 'u',
          author: { role: 'user' },
          status: 'finished_successfully',
          content: { content_type: 'text', parts: ['Synthetic question.'] },
        },
      },
      a: {
        parent: 'u',
        children: [],
        message: {
          id: 'a',
          author: { role: 'assistant' },
          status: 'finished_successfully',
          end_turn: true,
          content: { content_type: 'text', parts: [text] },
        },
      },
    },
  });
const response = (id, text = 'Original **Markdown** 中文 ✓\n') => ({
  kind: 'response',
  pageUrl: `https://chatgpt.com/c/${id}`,
  responseUrl: `https://chatgpt.com/backend-api/conversation/${id}`,
  capturedAt: new Date().toISOString(),
  method: 'GET',
  body: conversation(id, text),
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const event = () => {
  const listeners = [];
  return {
    addListener: (fn) => listeners.push(fn),
    emit: (...args) => listeners.forEach((fn) => fn(...args)),
  };
};

function fakeChrome() {
  const tabs = new Map();
  const ports = [];
  const api = {
    runtime: {
      id: 'ext',
      onMessage: event(),
      lastError: undefined,
      connectNative(name) {
        assert.equal(name, HOST);
        const port = {
          sent: [],
          onMessage: event(),
          onDisconnect: event(),
          postMessage: (m) => port.sent.push(m),
        };
        ports.push(port);
        return port;
      },
    },
    windows: { onFocusChanged: event() },
    tabs: {
      onActivated: event(),
      onUpdated: event(),
      onRemoved: event(),
      async query() {
        return [...tabs.values()].filter((tab) => tab.active);
      },
      async sendMessage(id, message) {
        const tab = tabs.get(id);
        if (!tab?.bridge) throw new Error('Receiving end does not exist.');
        if (message.type === 'replay') return { packet: tab.latest ?? null, href: tab.url };
        if (message.type === 'where') return { href: tab.url };
      },
    },
  };
  const open = (id, url, { bridge = true, latest = null } = {}) => {
    for (const tab of tabs.values()) tab.active = false;
    tabs.set(id, { id, url, title: `Tab ${id}`, active: true, bridge, latest });
    api.tabs.onActivated.emit({ tabId: id });
  };
  const send = (id, packet) =>
    api.runtime.onMessage.emit(
      { type: 'source', packet },
      { id: 'ext', frameId: 0, url: tabs.get(id).url, tab: { id } },
    );
  return { api, tabs, ports, open, send };
}

async function connected(chrome) {
  const handoff = createHandoff(chrome.api, { retryMs: 10 });
  chrome.ports.at(-1).onMessage.emit({ event: 'app', connected: true });
  await settle();
  return handoff;
}
const lastState = (port) => port.sent.filter((m) => m.event === 'state').at(-1)?.state;
const ask = (chrome, packet) =>
  new Promise((resolve) => {
    const port = chrome.ports.at(-1);
    const before = port.sent.length;
    port.onMessage.emit(packet);
    const poll = () =>
      port.sent.slice(before).find((m) => m.id === packet.id)
        ? resolve(port.sent.slice(before).find((m) => m.id === packet.id))
        : setTimeout(poll, 5);
    poll();
  });

test('follows the viewed ChatGPT tab and serves exactly the prepared Markdown', async () => {
  const chrome = fakeChrome();
  chrome.open(1, 'https://chatgpt.com/c/one', { latest: response('one') });
  await connected(chrome);
  const state = lastState(chrome.ports[0]);
  assert.equal(state.status, 'ready');
  assert.equal(state.turns, 2);
  assert.equal(state.verification, 'verified');
  const reply = await ask(chrome, { id: 'r1', command: 'context' });
  assert.ok(reply.markdown.includes('Original **Markdown** 中文 ✓'));
  assert.ok(reply.markdown.indexOf('Synthetic question.') < reply.markdown.indexOf('Original'));
  assert.equal(reply.hash, createHash('sha256').update(reply.markdown).digest('hex'));
  assert.equal(reply.revision, state.revision);
  const check = await ask(chrome, {
    id: 'c1',
    command: 'check',
    revision: reply.revision,
    hash: reply.hash,
  });
  assert.equal(check.current, true);
});

test('a page change revokes the context and any pending check', async () => {
  const chrome = fakeChrome();
  chrome.open(1, 'https://chatgpt.com/c/one', { latest: response('one') });
  await connected(chrome);
  const before = await ask(chrome, { id: 'r1', command: 'context' });
  chrome.send(1, { kind: 'changed', pageUrl: 'https://chatgpt.com/c/one' });
  await settle();
  assert.equal(lastState(chrome.ports[0]).status, 'waiting');
  assert.equal((await ask(chrome, { id: 'r2', command: 'context' })).ok, false);
  const stale = await ask(chrome, {
    id: 'c1',
    command: 'check',
    revision: before.revision,
    hash: before.hash,
  });
  assert.equal(stale.current, false);
});

test('the tab URL moving elsewhere fails the final check', async () => {
  const chrome = fakeChrome();
  chrome.open(1, 'https://chatgpt.com/c/one', { latest: response('one') });
  await connected(chrome);
  const reply = await ask(chrome, { id: 'r1', command: 'context' });
  chrome.tabs.get(1).url = 'https://chatgpt.com/c/two';
  const check = await ask(chrome, {
    id: 'c1',
    command: 'check',
    revision: reply.revision,
    hash: reply.hash,
  });
  assert.equal(check.current, false);
});

test('a new conversation reported before Chrome updates the URL is adopted', async () => {
  const chrome = fakeChrome();
  chrome.open(1, 'https://chatgpt.com/');
  await connected(chrome);
  assert.equal(lastState(chrome.ports[0]).status, 'waiting');
  chrome.tabs.get(1).url = 'https://chatgpt.com/c/new';
  chrome.send(1, response('new'));
  await settle();
  chrome.api.tabs.onUpdated.emit(1, { url: 'https://chatgpt.com/c/new' }, { active: true });
  await settle();
  const state = lastState(chrome.ports[0]);
  assert.equal(state.status, 'ready');
  assert.equal(state.page, 'https://chatgpt.com/c/new');
});

test('other tabs, other sources and non-ChatGPT tabs never replace the selection', async () => {
  const chrome = fakeChrome();
  chrome.open(1, 'https://chatgpt.com/c/one', { latest: response('one') });
  await connected(chrome);
  const revision = lastState(chrome.ports[0]).revision;
  chrome.open(2, 'https://example.com/');
  await settle();
  chrome.tabs.get(2).url = 'https://chatgpt.com/c/two';
  chrome.send(2, response('two'));
  chrome.api.runtime.onMessage.emit(
    { type: 'source', packet: response('one', 'Injected') },
    { id: 'other-extension', frameId: 0, url: 'https://chatgpt.com/c/one', tab: { id: 1 } },
  );
  await settle();
  assert.equal(lastState(chrome.ports[0]).revision, revision);
  chrome.api.tabs.onRemoved.emit(1);
  assert.equal(lastState(chrome.ports[0]).status, 'none');
});

test('a tab opened before the extension asks for one reload', async () => {
  const chrome = fakeChrome();
  chrome.open(1, 'https://chatgpt.com/c/one', { bridge: false });
  await connected(chrome);
  assert.equal(lastState(chrome.ports[0]).status, 'reload');
});

test('nothing is published until the app connects, and a lost relay reconnects', async () => {
  const chrome = fakeChrome();
  chrome.open(1, 'https://chatgpt.com/c/one', { latest: response('one') });
  createHandoff(chrome.api, { retryMs: 10 });
  await settle();
  assert.equal(chrome.ports[0].sent.length, 0);
  chrome.ports[0].onDisconnect.emit();
  await settle();
  assert.equal(chrome.ports.length, 2);
  chrome.ports[1].onMessage.emit({ event: 'app', connected: true });
  assert.equal(lastState(chrome.ports[1]).status, 'ready');
});

test('a change during preparation discards the superseded response', async () => {
  const chrome = fakeChrome();
  chrome.open(1, 'https://chatgpt.com/c/one');
  await connected(chrome);
  chrome.send(1, response('one'));
  chrome.send(1, { kind: 'changed', pageUrl: 'https://chatgpt.com/c/one' });
  await settle();
  assert.equal(lastState(chrome.ports[0]).status, 'waiting');
  assert.equal((await ask(chrome, { id: 'r1', command: 'context' })).ok, false);
});

test('a replayed packet for another page is ignored', async () => {
  const chrome = fakeChrome();
  chrome.open(1, 'https://chatgpt.com/c/two', { latest: response('one') });
  await connected(chrome);
  assert.equal(lastState(chrome.ports[0]).status, 'waiting');
});
