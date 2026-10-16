import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createPageObserverScript } from '../src/page-observer.js';
import { importBrowserResponse } from '../src/chatgpt-response.js';

const page = 'https://chatgpt.com/c/a';
const endpoint = (id) => `https://chatgpt.com/backend-api/conversation/${id}`;
const tick = () => new Promise((resolve) => setImmediate(resolve));
function harness(initialURL = page, { socketSupport = false } = {}) {
  const messages = [],
    requests = [];
  let observerPort;
  const location = {
    href: initialURL,
    get origin() {
      return new URL(this.href).origin;
    },
  };
  const window = {
    postMessage: (data, _origin, ports) => {
      if (data.type === 'add-to-claude/port')
        ports[0].onmessage = ({ data: packet }) =>
          messages.push(JSON.parse(JSON.stringify(packet)));
    },
    fetch(url, init) {
      return new Promise((resolve) => requests.push({ url, init, resolve }));
    },
  };
  if (socketSupport)
    window.WebSocket = class {
      constructor(url) {
        this.url = url;
        this.listeners = new Map();
        this.sent = [];
      }
      send(value) {
        this.sent.push(value);
      }
      addEventListener(name, callback) {
        this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]);
      }
      emit(name, data) {
        for (const callback of this.listeners.get(name) ?? []) callback({ data });
      }
    };
  const history = {
    pushState(_data, _unused, url) {
      location.href = new URL(url, location.href).href;
    },
    replaceState(_data, _unused, url) {
      location.href = new URL(url, location.href).href;
    },
  };
  const context = vm.createContext({
    window,
    history,
    location,
    URL,
    TextDecoder,
    TextEncoder,
    Headers,
    Request,
    URLSearchParams,
    structuredClone,
    // Synchronous stand-in for the private port, so tests observe packets in posting order.
    MessageChannel: class {
      constructor() {
        const port2 = {};
        this.port2 = port2;
        this.port1 = { postMessage: (value) => port2.onmessage?.({ data: value }) };
        observerPort = this.port1;
      }
    },
    setTimeout,
    clearTimeout,
    addEventListener() {},
  });
  vm.runInContext(createPageObserverScript(), context);
  return {
    messages,
    requests,
    // What the app's bridge sends to the observer.
    ask: (data) => observerPort.onmessage({ data }),
    socket: () => new window.WebSocket('wss://ws.chatgpt.com/p4/ws/user/synthetic'),
    navigate: (url) => history.pushState({}, '', url),
    request: (id) => window.fetch(endpoint(id)).then((response) => response.text()),
    fetch: (url) => window.fetch(url).then((response) => response.text()),
    fetchWith: (url, init) => window.fetch(url, init),
    post: (request) =>
      window
        .fetch('https://chatgpt.com/backend-api/f/conversation', {
          method: 'POST',
          body: JSON.stringify(request),
        })
        .then((response) => response.text()),
    reply(index, body, contentType = 'application/json') {
      const response = new Response(body, {
        status: 200,
        headers: { 'content-type': contentType },
      });
      // A constructed Response has no fetched URL; model the browser's clone-preserved metadata.
      const identify = (value) => {
        Object.defineProperty(value, 'url', { value: requests[index].url });
        const clone = value.clone.bind(value);
        value.clone = () => identify(clone());
        return value;
      };
      identify(response);
      requests[index].resolve(response);
    },
  };
}

test('a late older GET cannot replace the newer selected-conversation snapshot', async () => {
  const h = harness();
  let oldStream;
  const older = h.request('a');
  h.reply(
    0,
    new ReadableStream({
      start(controller) {
        oldStream = controller;
      },
    }),
  );
  await tick();
  const newer = h.request('a');
  h.reply(1, 'new snapshot');
  assert.equal(await newer, 'new snapshot');
  await tick();
  oldStream.enqueue(new TextEncoder().encode('old snapshot'));
  oldStream.close();
  assert.equal(await older, 'old snapshot');
  await tick();
  assert.deepEqual(
    h.messages.filter((packet) => packet.kind === 'response').map((packet) => packet.body),
    ['new snapshot'],
  );
});

const originalMessage = (id, role, text) => ({
  id,
  author: { role },
  status: 'finished_successfully',
  end_turn: true,
  content: { content_type: 'text', parts: [text] },
});
const streamWire = (id, answerId = 'a1') =>
  `event: delta_encoding\ndata: "v1"\n\nevent: delta\ndata: ${JSON.stringify({ p: '', o: 'add', v: { conversation_id: id, message: originalMessage(answerId, 'assistant', 'Original **answer** 中文 ✓\n') } })}\n\ndata: [DONE]\n\n`;
const sourceRecord = () => ({
  conversation_id: 'a',
  title: 'Synthetic original',
  current_node: 'a0',
  mapping: {
    root: { id: 'root', parent: null, children: ['u0'], message: null },
    u0: {
      id: 'u0',
      parent: 'root',
      children: ['a0'],
      message: originalMessage('u0', 'user', 'Earlier question.'),
    },
    a0: {
      id: 'a0',
      parent: 'u0',
      children: [],
      message: originalMessage('a0', 'assistant', 'Earlier answer.'),
    },
  },
});

test('the passive observer appends a normal stream to observed history without a refresh', async () => {
  const h = harness();
  const loading = h.request('a');
  h.reply(0, JSON.stringify(sourceRecord()));
  await loading;
  await tick();
  const request = {
    action: 'next',
    conversation_id: 'a',
    parent_message_id: 'a0',
    messages: [originalMessage('u1', 'user', 'New exact question.')],
    ignored_token: 'DO_NOT_RETAIN',
  };
  const sending = h.post(request);
  const wire = streamWire('a');
  h.reply(1, wire, 'text/event-stream');
  assert.equal(await sending, wire);
  await tick();
  const packet = h.messages.filter((item) => item.kind === 'response').at(-1);
  assert.equal(packet.method, 'POST');
  const model = importBrowserResponse(packet.body, packet);
  assert.deepEqual(
    model.turns.map((turn) => turn.id),
    ['u0', 'a0', 'u1', 'a1'],
  );
  assert.equal(model.turns[3].markdown, 'Original **answer** 中文 ✓\n');
  assert.equal(model.verification.status, 'verified');
  assert.equal(h.requests.length, 2);
  assert.equal(packet.body.includes('DO_NOT_RETAIN'), false);
});

test('new-chat URL assignment can occur before or after stream completion', async () => {
  for (const when of ['before', 'after']) {
    const h = harness('https://chatgpt.com/');
    const sending = h.post({
      action: 'next',
      parent_message_id: 'root',
      messages: [originalMessage('u1', 'user', 'New chat.')],
    });
    if (when === 'before') h.navigate('/c/new-chat');
    h.reply(0, streamWire('new-chat'), 'text/event-stream');
    await sending;
    await tick();
    if (when === 'after') h.navigate('/c/new-chat');
    await tick();
    const packet = h.messages.filter((item) => item.kind === 'response').at(-1);
    assert.ok(packet, when);
    const model = importBrowserResponse(packet.body, packet);
    assert.equal(model.source.id, 'new-chat');
    assert.equal(model.verification.status, 'verified');
    assert.equal(h.requests.length, 1);
  }
});

test('a website GET during generation supplies history without cancelling the live answer', async () => {
  const h = harness('https://chatgpt.com/');
  const sending = h.post({
    action: 'next',
    parent_message_id: 'root',
    messages: [originalMessage('u1', 'user', 'New chat.')],
  });
  h.navigate('/c/a');
  let stream;
  h.reply(
    0,
    new ReadableStream({
      start(controller) {
        stream = controller;
      },
    }),
    'text/event-stream',
  );
  await tick();
  const loading = h.request('a');
  const hydrated = {
    conversation_id: 'a',
    title: 'Hydrated chat',
    current_node: 'u1',
    mapping: {
      root: { parent: null, children: ['u1'], message: null },
      u1: {
        id: 'u1',
        parent: 'root',
        children: [],
        message: originalMessage('u1', 'user', 'New chat.'),
      },
    },
  };
  h.reply(1, JSON.stringify(hydrated));
  await loading;
  await tick();
  assert.equal(
    h.messages.some((item) => item.kind === 'response'),
    false,
  );
  stream.enqueue(new TextEncoder().encode(streamWire('a')));
  stream.close();
  await sending;
  await tick();
  const packet = h.messages.filter((item) => item.kind === 'response').at(-1);
  assert.equal(packet.method, 'POST');
  assert.equal(importBrowserResponse(packet.body, packet).verification.status, 'verified');
});

test('a failed stream releases its job so a later normal GET can recover the source', async () => {
  const h = harness();
  const sending = h.post({
    action: 'next',
    conversation_id: 'a',
    parent_message_id: 'a0',
    messages: [originalMessage('u1', 'user', 'Question.')],
  });
  h.reply(0, 'data: {"error":"synthetic failure"}\n\n', 'text/event-stream');
  await sending;
  await tick();
  assert.equal(h.messages.at(-1).kind, 'unavailable');
  const loading = h.request('a');
  h.reply(1, JSON.stringify(sourceRecord()));
  await loading;
  await tick();
  assert.equal(h.messages.at(-1).kind, 'response');
  assert.equal(h.messages.at(-1).method, 'GET');
});

test('a failed old stream cannot invalidate the new conversation snapshot', async () => {
  const h = harness();
  let oldStream;
  const older = h.request('a').catch(() => 'website also sees the network error');
  h.reply(
    0,
    new ReadableStream({
      start(controller) {
        oldStream = controller;
      },
    }),
  );
  await tick();
  h.navigate('/c/b');
  const newer = h.request('b');
  h.reply(1, 'conversation B');
  await newer;
  await tick();
  oldStream.error(new Error('synthetic connection failed'));
  await older;
  await tick();
  assert.equal(h.messages.at(-1).kind, 'response');
  assert.equal(h.messages.at(-1).body, 'conversation B');
  assert.equal(
    h.messages.some((packet) => packet.kind === 'unavailable' && packet.pageUrl === page),
    false,
  );
});

test('GET decoding failure cancels only the observer branch before releasing it', async () => {
  const h = harness();
  let observerCancelled = 0;
  const loading = h.request('a');
  const response = new Response('website body remains readable');
  Object.defineProperty(response, 'url', { value: endpoint('a') });
  response.clone = () => ({
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.of(0xff));
      },
      cancel() {
        observerCancelled++;
      },
    }),
  });
  h.requests[0].resolve(response);
  assert.equal(await loading, 'website body remains readable');
  await tick();
  assert.equal(h.messages.at(-1).kind, 'unavailable');
  assert.equal(observerCancelled, 1);
  h.navigate('/c/b');
  await tick();
  assert.equal(observerCancelled, 1);
});

test('known early selected-topic frames reject later socket reconstruction instead of silently losing a turn', async () => {
  const h = harness(page, { socketSupport: true });
  const socket = h.socket();
  const topic = 'conversation-turn-early';
  const sending = h.post({
    action: 'next',
    conversation_id: 'a',
    parent_message_id: 'root',
    messages: [originalMessage('u1', 'user', 'Synthetic question.')],
  });
  socket.send(JSON.stringify([{ command: { type: 'subscribe', topic_id: topic, offset: '0' } }]));
  const frame = (encoded) => ({
    type: 'message',
    topic_id: topic,
    payload: { payload: { encoded_item: encoded } },
  });
  socket.emit(
    'message',
    JSON.stringify(
      frame(
        `data: ${JSON.stringify({ conversation_id: 'a', message: originalMessage('early', 'assistant', 'Early visible answer.') })}`,
      ),
    ),
  );
  h.reply(
    0,
    `data: ${JSON.stringify({ type: 'stream_handoff', conversation_id: 'a', options: [{ type: 'subscribe_ws_topic', topic_id: topic }] })}\n\ndata: [DONE]\n\n`,
    'text/event-stream',
  );
  await sending;
  await tick();
  socket.emit(
    'message',
    JSON.stringify([
      frame(
        `data: ${JSON.stringify({ conversation_id: 'a', message: originalMessage('late', 'assistant', 'Late visible answer.') })}`,
      ),
      frame('data: [DONE]'),
    ]),
  );
  await tick();
  assert.equal(
    h.messages.some((packet) => packet.body?.includes('Late visible answer.')),
    false,
  );
  assert.equal(socket.sent.length, 1);
});

test('the paged conversation load (live site, 2026-10) becomes a classic tree before publishing', async () => {
  const h = harness();
  const url =
    'https://chatgpt.com/backend-api/conversations/a?num_turns=40&include_has_versions=true';
  const loaded = h.fetch(url);
  const page = {
    conversation_id: 'a',
    title: 'Paged',
    current_node: 'm2',
    page_info: { has_previous_page: false, has_next_page: false },
    messages: [
      {
        id: 'm1',
        author: { role: 'user' },
        status: 'finished_successfully',
        content: { content_type: 'text', parts: ['Question'] },
      },
      {
        id: 'm2',
        author: { role: 'assistant' },
        status: 'finished_successfully',
        end_turn: true,
        content: { content_type: 'text', parts: ['Answer **md**'] },
      },
    ],
  };
  h.reply(0, JSON.stringify(page));
  assert.equal(await loaded, JSON.stringify(page)); // The website's own response is untouched.
  await tick();
  await tick();
  const packet = h.messages.findLast((message) => message.kind === 'response');
  assert.equal(packet.responseUrl, url);
  const model = importBrowserResponse(packet.body, packet);
  assert.deepEqual(
    model.turns.map((turn) => [turn.role, turn.markdown]),
    [
      ['user', 'Question'],
      ['assistant', 'Answer **md**'],
    ],
  );
  assert.equal(model.verification.status, 'verified');
});

test('pages loaded while scrolling up are merged into one complete conversation', async () => {
  const h = harness();
  const url = 'https://chatgpt.com/backend-api/conversations/a?num_turns=2';
  const message = (id, role, text, time) => ({
    id,
    author: { role },
    create_time: time,
    status: 'finished_successfully',
    end_turn: role === 'assistant' ? true : undefined,
    content: { content_type: 'text', parts: [text] },
  });
  const latest = h.fetch(url);
  h.reply(
    0,
    JSON.stringify({
      conversation_id: 'a',
      title: 'Long',
      current_node: 'a2',
      page_info: { has_previous_page: true, has_next_page: false },
      messages: [
        message('u2', 'user', 'Second question', 3),
        message('a2', 'assistant', 'Second answer', 4),
      ],
    }),
  );
  await latest;
  await tick();
  await tick();
  const first = h.messages.findLast((value) => value.kind === 'response');
  assert.equal(importBrowserResponse(first.body, first).verification.status, 'partial');
  // The live site's older-page endpoint: messages and page_info only, no id or title.
  const earlier = h.fetch(
    'https://chatgpt.com/backend-api/conversations/a/messages?before=cursor&num_turns=2',
  );
  h.reply(
    1,
    JSON.stringify({
      page_info: { has_previous_page: false, has_next_page: true },
      messages: [
        message('u1', 'user', 'First question', 1),
        message('a1', 'assistant', 'First answer', 2),
      ],
    }),
  );
  await earlier;
  await tick();
  await tick();
  const merged = h.messages.findLast((value) => value.kind === 'response');
  assert.equal(merged.responseUrl, url); // Evidence stays the conversation load, not the older page.
  const model = importBrowserResponse(merged.body, merged);
  assert.deepEqual(
    model.turns.map((turn) => turn.markdown),
    ['First question', 'First answer', 'Second question', 'Second answer'],
  );
  assert.equal(model.verification.status, 'verified');
});

test('file links are requested with the page session only when the app asks, and never leave the page', async () => {
  const h = harness();
  h.ask({ kind: 'resolve', files: [{ id: 'file-abc', messageId: 'm1' }] });
  await tick();
  assert.equal(h.requests.length, 0, 'no request before the page has used its own session');
  assert.equal(h.messages.at(-1).kind, 'file-missing');
  assert.equal(h.messages.at(-1).status, 'no-session');

  void window_fetch(h, 'https://chatgpt.com/backend-api/me', {
    authorization: 'Bearer synthetic',
    'x-other': 'no',
  });
  h.ask({
    kind: 'resolve',
    files: [
      { id: 'sandbox:/mnt/data/report one.md', messageId: 'm2' },
      { id: 'https://example.com/x', messageId: 'm3' },
    ],
  });
  await tick();
  const resolve = h.requests.at(-1);
  assert.equal(
    resolve.url,
    '/backend-api/conversation/a/interpreter/download?message_id=m2&sandbox_path=%2Fmnt%2Fdata%2Freport+one.md',
  );
  assert.equal(resolve.init.headers.get('authorization'), 'Bearer synthetic');
  assert.equal(resolve.init.headers.has('x-other'), false);
  resolve.resolve(
    new Response(
      JSON.stringify({
        download_url: '/backend-api/estuary/content?id=f',
        file_name: 'report one.md',
      }),
      {
        status: 200,
      },
    ),
  );
  for (let i = 0; i < 5; i++) await tick();
  const file = h.messages.find((message) => message.kind === 'file');
  assert.equal(file.id, 'sandbox:/mnt/data/report one.md');
  assert.equal(file.url, 'https://chatgpt.com/backend-api/estuary/content?id=f');
  assert.equal(file.name, 'report one.md');
  assert.equal(
    JSON.stringify(h.messages).includes('synthetic'),
    false,
    'the session token is never posted',
  );
  // Links resolve in parallel, so the unsupported id answers without waiting for the others.
  assert.equal(
    h.messages.find(
      (message) => message.kind === 'file-missing' && message.id === 'https://example.com/x',
    )?.status,
    'unsupported',
  );
});

function window_fetch(h, url, headers) {
  return h.fetchWith(url, { headers });
}

test('returning to a conversation the website shows from memory publishes it again', async () => {
  const h = harness();
  const loaded = h.request('a');
  h.reply(0, 'conversation a');
  await loaded;
  await tick();
  h.navigate('/c/b');
  h.navigate('/c/a');
  const responses = h.messages.filter((packet) => packet.kind === 'response');
  assert.deepEqual(
    responses.map((packet) => [packet.pageUrl, packet.body]),
    [
      ['https://chatgpt.com/c/a', 'conversation a'],
      ['https://chatgpt.com/c/a', 'conversation a'],
    ],
  );
  assert.equal(h.messages.at(-1).kind, 'response', 'the replay follows the change notice');
});

test('Read Again reloads the open conversation through the page session, as the website would', async () => {
  const h = harness();
  h.ask({ kind: 'refresh' });
  assert.equal(
    h.messages.at(-1).kind,
    'unavailable',
    'nothing to read again before the page has a session',
  );
  void h.fetchWith('https://chatgpt.com/backend-api/me', {
    headers: { authorization: 'Bearer synthetic' },
  });
  h.ask({ kind: 'refresh' });
  const reload = h.requests.at(-1);
  assert.equal(reload.url, 'https://chatgpt.com/backend-api/conversations/a');
  assert.equal(reload.init.headers.get('authorization'), 'Bearer synthetic');
  const conversation = {
    conversation_id: 'a',
    title: 'Synthetic',
    current_node: 'm1',
    mapping: {
      root: { parent: null, children: ['m1'], message: null },
      m1: {
        parent: 'root',
        children: [],
        message: {
          id: 'm1',
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['Hello'] },
        },
      },
    },
  };
  h.reply(h.requests.length - 1, JSON.stringify(conversation));
  for (let i = 0; i < 6; i++) await tick();
  const published = h.messages.filter((message) => message.kind === 'response');
  assert.equal(published.length, 1, 'the reloaded conversation is published');
  assert.equal(
    JSON.stringify(h.messages).includes('synthetic'),
    false,
    'the token is never posted',
  );
});
