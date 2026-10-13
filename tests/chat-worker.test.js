import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const code = (await readFile(new URL('../extension/chat-worker.js', import.meta.url), 'utf8'))
  .replace(
    "'./chatgpt-response.js'",
    JSON.stringify(new URL('../src/chatgpt-response.js', import.meta.url).href),
  )
  .replace("'./model.js'", JSON.stringify(new URL('../src/model.js', import.meta.url).href))
  .replace(
    "'./chat-native.js'",
    JSON.stringify(new URL('../extension/chat-native.js', import.meta.url).href),
  );
const { installChatIntegration } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const event = () => {
  const listeners = [];
  return {
    addListener: (callback) => listeners.push(callback),
    emit: (...args) => listeners.forEach((callback) => callback(...args)),
  };
};
const endpoint = 'https://chatgpt.com/c/synthetic';
function packet(title = 'Synthetic source') {
  const message = (id, role, text) => ({
    id,
    author: { role },
    status: 'finished_successfully',
    end_turn: true,
    content: { content_type: 'text', parts: [text] },
  });
  return {
    kind: 'response',
    pageUrl: endpoint,
    responseUrl: 'https://chatgpt.com/backend-api/conversation/synthetic',
    capturedAt: new Date().toISOString(),
    method: 'GET',
    body: JSON.stringify({
      conversation_id: 'synthetic',
      title,
      current_node: 'a',
      mapping: {
        root: { parent: null, message: null },
        u: { parent: 'root', message: message('u', 'user', 'Question.') },
        a: { parent: 'u', message: message('a', 'assistant', 'Original **answer** ✓') },
      },
    }),
  };
}
function harness() {
  const listeners = [],
    sent = [],
    injections = [];
  const tab = { id: 1, windowId: 2, url: endpoint };
  let resolveAppend;
  const appended = new Promise((resolve) => {
    resolveAppend = resolve;
  });
  const port = {
    onMessage: event(),
    onDisconnect: event(),
    postMessage(value) {
      sent.push(value);
      if (value.command === 'append') resolveAppend(value);
      if (value.command === 'targets')
        queueMicrotask(() =>
          port.onMessage.emit({
            id: value.id,
            ok: true,
            trusted: true,
            targets: [{ id: 'window-one', app: 'Synthetic Agent', window: 'Composer' }],
          }),
        );
      if (value.command === 'select')
        queueMicrotask(() =>
          port.onMessage.emit({
            id: value.id,
            ok: true,
            targetToken: 'opaque-target',
            name: 'Synthetic Agent',
          }),
        );
      if (value.command === 'cancel')
        queueMicrotask(() => port.onMessage.emit({ id: value.id, ok: true }));
    },
    disconnect() {
      port.onDisconnect.emit();
    },
  };
  let activeTab = tab,
    documentId = 'document-one',
    hold,
    tabHold;
  const chrome = {
    runtime: {
      id: 'fixture-extension',
      getURL: (path) => `chrome-extension://fixture-extension/${path}`,
      onMessage: { addListener: (listener) => listeners.push(listener) },
      connectNative: () => port,
    },
    storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    tabs: {
      get: async () => {
        if (tabHold) {
          const pending = tabHold;
          tabHold = null;
          await pending;
        }
        return tab;
      },
      query: async () => [activeTab],
      sendMessage: async () => ({ packet: null }),
      onRemoved: event(),
      onUpdated: event(),
    },
    permissions: { contains: async () => true, onRemoved: event() },
    scripting: {
      getRegisteredContentScripts: async () => [],
      registerContentScripts: async (value) => injections.push(value),
      executeScript: async (value) => {
        injections.push(value);
        if (hold && value.func) {
          const result = hold;
          hold = null;
          await result;
        }
        return [{ documentId, result: tab.url }];
      },
    },
  };
  installChatIntegration(chrome);
  const popup = { id: chrome.runtime.id, url: chrome.runtime.getURL('chat.html') };
  const source = () => ({
    id: chrome.runtime.id,
    frameId: 0,
    documentId,
    tab: { ...tab },
    url: tab.url,
  });
  function call(type, values = {}, sender = popup) {
    return new Promise((resolve) => {
      const accepted = listeners.some(
        (listener) => listener({ type, ...values }, sender, resolve) === true,
      );
      if (!accepted) resolve(undefined);
    });
  }
  return {
    call,
    appended,
    sent,
    injections,
    port,
    source,
    tab,
    setActive(value) {
      activeTab = value;
    },
    setDocument(value) {
      documentId = value;
    },
    holdTabRead(promise) {
      tabHold = promise;
    },
    holdInspection(promise) {
      hold = promise;
    },
    async prepare() {
      assert.equal((await call('chatEnable')).ok, true);
      await call('chatSource', { packet: packet() }, source());
      await call('chatSelect', { targetId: 'window-one' });
    },
  };
}

test('passive source activation is selected-tab-only and content scripts cannot issue native actions', async () => {
  const h = harness();
  assert.deepEqual(await h.call('chatHello', {}, h.source()), { allowed: false });
  assert.equal(h.injections.length, 0);
  assert.equal(await h.call('chatAdd', {}, h.source()), undefined);
  assert.equal(h.sent.length, 0);
  await h.prepare();
  const status = await h.call('chatStatus');
  assert.equal(status.canAdd, true);
  assert.equal(status.turns, 2);
  const other = { ...h.source(), tab: { ...h.tab, id: 3 } };
  assert.deepEqual(await h.call('chatSource', { packet: packet('Wrong source') }, other), {
    accepted: false,
  });
  assert.match((await h.call('chatPreview')).markdown, /Synthetic source/);
  h.port.disconnect();
});

test('an explicit Add freezes exact text and answers only its matching final source check', async () => {
  const h = harness();
  await h.prepare();
  const adding = h.call('chatAdd');
  const request = await h.appended;
  assert.ok(request.text.includes('Original **answer** ✓'));
  h.port.onMessage.emit({
    event: 'source-check',
    operationId: request.id,
    ticket: 'native-ticket',
    revision: request.revision,
    hash: request.hash,
  });
  await tick();
  assert.equal(h.sent.at(-1).command, 'source-permit');
  assert.equal(h.sent.at(-1).current, true);
  h.port.onMessage.emit({
    id: request.id,
    ok: true,
    inserted: true,
    message: 'Added and verified.',
  });
  assert.equal((await adding).inserted, true);
  const state = await h.call('chatStatus');
  assert.equal(state.target, null);
  assert.equal(state.outcome.inserted, true);
  h.port.disconnect();
});

test('new source data revokes a pending native Add and denies its late permit', async () => {
  const h = harness();
  await h.prepare();
  const adding = h.call('chatAdd');
  const request = await h.appended;
  await h.call('chatSource', { packet: { kind: 'changed', pageUrl: endpoint } }, h.source());
  h.port.onMessage.emit({
    event: 'source-check',
    operationId: request.id,
    ticket: 'old-ticket',
    revision: request.revision,
    hash: request.hash,
  });
  await tick();
  assert.ok(h.sent.some((item) => item.command === 'cancel'));
  assert.equal(h.sent.at(-1).current, false);
  h.port.onMessage.emit({ id: request.id, ok: false, inserted: false, message: 'Source changed.' });
  assert.equal((await adding).inserted, false);
  h.port.disconnect();
});

test('a popup in a different tab cannot add the previously selected source', async () => {
  const h = harness();
  await h.prepare();
  h.setActive({ ...h.tab, id: 9 });
  const result = await h.call('chatAdd');
  assert.equal(result.ok, false);
  assert.equal(
    h.sent.some((item) => item.command === 'append'),
    false,
  );
  h.port.disconnect();
});

test('late source validation cannot overwrite a newer snapshot', async () => {
  const h = harness();
  await h.prepare();
  let release;
  h.holdInspection(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const older = h.call('chatSource', { packet: packet('Old snapshot') }, h.source());
  await tick();
  await h.call('chatSource', { packet: packet('New snapshot') }, h.source());
  release();
  await older;
  assert.match((await h.call('chatPreview')).markdown, /New snapshot/);
  h.port.disconnect();
});

test('an older packet delayed at the first tab lookup cannot resurrect a newer invalidated source', async () => {
  const h = harness();
  await h.prepare();
  let release;
  h.holdTabRead(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const older = h.call('chatSource', { packet: packet('Old packet') }, h.source());
  await tick();
  await h.call('chatSource', { packet: { kind: 'changed', pageUrl: endpoint } }, h.source());
  release();
  await older;
  const state = await h.call('chatStatus');
  assert.equal(state.ready, false);
  assert.equal(state.canAdd, false);
  h.port.disconnect();
});
