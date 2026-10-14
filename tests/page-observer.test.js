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
  const location = {
    href: initialURL,
    get origin() {
      return new URL(this.href).origin;
    },
  };
  const window = {
    postMessage: (data) => messages.push(JSON.parse(JSON.stringify(data.packet))),
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
    structuredClone,
    setTimeout,
    clearTimeout,
    addEventListener() {},
  });
  vm.runInContext(createPageObserverScript(), context);
  return {
    messages,
    requests,
    socket: () => new window.WebSocket('wss://ws.chatgpt.com/p4/ws/user/synthetic'),
    navigate: (url) => history.pushState({}, '', url),
    request: (id) => window.fetch(endpoint(id)).then((response) => response.text()),
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
