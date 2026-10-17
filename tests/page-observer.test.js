import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createPageObserverScript } from '../src/page-observer.js';
import { importBrowserResponse } from '../src/chatgpt-response.js';

const page = 'https://chatgpt.com/c/a';
const endpoint = (id) => `https://chatgpt.com/backend-api/conversation/${id}`;
const tick = () => new Promise((resolve) => setImmediate(resolve));
function harness(initialURL = page, { socketSupport = false, timers = globalThis } = {}) {
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
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
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
  // A failed reply is not a failed refetch: the app drops what it showed.
  assert.equal(h.messages.at(-1).refetch, false);
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
  // The page could not load the conversation again: what was read of it before still stands.
  assert.equal(h.messages.at(-1).refetch, true);
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

test('a reply sent after returning to a conversation keeps its history', async () => {
  const h = harness();
  const loading = h.request('a');
  h.reply(0, JSON.stringify(sourceRecord()));
  await loading;
  await tick();
  h.navigate('/c/b');
  h.navigate('/c/a');
  const sending = h.post({
    action: 'next',
    conversation_id: 'a',
    parent_message_id: 'a0',
    messages: [originalMessage('u1', 'user', 'New exact question.')],
  });
  h.reply(1, streamWire('a'), 'text/event-stream');
  await sending;
  await tick();
  const packet = h.messages.filter((item) => item.kind === 'response').at(-1);
  assert.equal(packet.method, 'POST');
  const model = importBrowserResponse(packet.body, packet);
  assert.deepEqual(
    model.turns.map((turn) => turn.id),
    ['u0', 'a0', 'u1', 'a1'],
  );
  assert.equal(model.verification.status, 'verified');
});

test('sending a message tells the app a reply is in progress, before any answer arrives', () => {
  const h = harness();
  void h.post({ action: 'next', messages: [] });
  assert.deepEqual(
    h.messages.map((message) => message.kind),
    ['changed', 'replying'],
  );
});

// A manual clock for the socket's inactivity timeout.
function manualClock() {
  let now = 0,
    next = 1;
  const pending = new Map();
  return {
    setTimeout: (callback, ms) => {
      pending.set(next, { at: now + ms, callback });
      return next++;
    },
    clearTimeout: (id) => pending.delete(id),
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...pending])
        if (timer.at <= now && pending.delete(id)) timer.callback();
    },
  };
}

const socketTopic = 'conversation-turn-synthetic';
const socketFrame = (encoded) => ({
  type: 'message',
  topic_id: socketTopic,
  payload: { payload: { encoded_item: encoded } },
});
const socketAnswer = (text) =>
  socketFrame(
    `data: ${JSON.stringify({ conversation_id: 'a', message: originalMessage('a1', 'assistant', text) })}`,
  );
const handoffWire = (id = 'a') =>
  `data: ${JSON.stringify({ type: 'stream_handoff', conversation_id: id, options: [{ type: 'subscribe_ws_topic', topic_id: socketTopic }] })}\n\ndata: [DONE]\n\n`;

// The conversation is loaded, a question is sent, and its POST stream hands the answer to the socket.
async function socketReply(options = {}) {
  const h = harness(page, { socketSupport: true, ...options });
  const loading = h.request('a');
  h.reply(0, JSON.stringify(sourceRecord()));
  await loading;
  await tick();
  const socket = h.socket();
  const sending = h.post({
    action: 'next',
    conversation_id: 'a',
    parent_message_id: 'a0',
    messages: [originalMessage('u1', 'user', 'Synthetic question.')],
  });
  socket.send(
    JSON.stringify([{ command: { type: 'subscribe', topic_id: socketTopic, offset: '0' } }]),
  );
  h.reply(1, handoffWire(), 'text/event-stream');
  await sending;
  await tick();
  return { h, socket };
}
const responses = (h) => h.messages.filter((packet) => packet.kind === 'response');

test('a socket handoff keeps the reply in progress until the socket part completes', async () => {
  const { h, socket } = await socketReply();
  assert.equal(
    responses(h).length,
    1,
    'only the earlier GET: the POST part alone is not published',
  );
  assert.equal(h.messages.at(-1).kind, 'replying');
  socket.emit(
    'message',
    JSON.stringify([socketAnswer('Socket answer.'), socketFrame('data: [DONE]')]),
  );
  await tick();
  const packet = responses(h).at(-1);
  assert.equal(packet.method, 'POST');
  const model = importBrowserResponse(packet.body, packet);
  assert.deepEqual(
    model.turns.map((turn) => turn.id),
    ['u0', 'a0', 'u1', 'a1'],
  );
  assert.equal(model.turns[3].markdown, 'Socket answer.');
  assert.equal(responses(h).length, 2);
});

test('a socket that closes before its answer, and is not renewed, publishes the POST part as partial', async () => {
  const clock = manualClock();
  const { h, socket } = await socketReply({ timers: clock });
  socket.emit('close');
  await tick();
  assert.equal(responses(h).length, 1, 'the page may still reconnect');
  clock.advance(120000);
  await tick();
  const packet = responses(h).at(-1);
  assert.equal(packet.method, 'POST');
  const model = importBrowserResponse(packet.body, packet);
  assert.deepEqual(
    model.turns.map((turn) => turn.id),
    ['u0', 'a0', 'u1'],
  );
  assert.equal(model.verification.status, 'partial');
});

test('the socket times out only after two minutes with nothing for its turn', async () => {
  const clock = manualClock();
  const { h, socket } = await socketReply({ timers: clock });
  // Five minutes of a long answer, a frame every 90 s, never fails.
  for (let minute = 0; minute < 3; minute++) {
    clock.advance(90000);
    socket.emit('message', JSON.stringify(socketAnswer(`Part ${minute}.`)));
  }
  // Frames for another topic on the same socket do not keep this turn alive.
  clock.advance(90000);
  socket.emit('message', JSON.stringify({ type: 'message', topic_id: 'presence', payload: {} }));
  assert.equal(responses(h).length, 1, 'still in progress after 360 s');
  clock.advance(30000);
  await tick();
  const packet = responses(h).at(-1);
  assert.equal(packet.method, 'POST', 'silent for 120 s: the POST part, as partial');
  assert.equal(importBrowserResponse(packet.body, packet).verification.status, 'partial');
  socket.emit('message', JSON.stringify([socketAnswer('Too late.'), socketFrame('data: [DONE]')]));
  await tick();
  assert.equal(responses(h).length, 2, 'a late answer after the timeout is not published');
});

test('a socket handoff the page never subscribes to still ends in a partial result', async () => {
  const clock = manualClock();
  const h = harness(page, { socketSupport: true, timers: clock });
  const sending = h.post({
    action: 'next',
    conversation_id: 'a',
    parent_message_id: 'a0',
    messages: [originalMessage('u1', 'user', 'Synthetic question.')],
  });
  h.reply(0, handoffWire(), 'text/event-stream');
  await sending;
  await tick();
  assert.equal(responses(h).length, 0);
  clock.advance(120000);
  assert.equal(responses(h).at(-1)?.method, 'POST');
});

test('a new chat that gets its address while the socket streams publishes once, when it completes', async () => {
  const h = harness('https://chatgpt.com/', { socketSupport: true });
  const socket = h.socket();
  const sending = h.post({
    action: 'next',
    parent_message_id: 'root',
    messages: [originalMessage('u1', 'user', 'New chat.')],
  });
  socket.send(
    JSON.stringify([{ command: { type: 'subscribe', topic_id: socketTopic, offset: '0' } }]),
  );
  h.reply(0, handoffWire(), 'text/event-stream');
  await sending;
  await tick();
  h.navigate('/c/a');
  assert.equal(responses(h).length, 0, 'the address alone publishes nothing');
  assert.equal(h.messages.at(-1).kind, 'replying', 'and does not end the reply');
  socket.emit(
    'message',
    JSON.stringify([socketAnswer('Socket answer.'), socketFrame('data: [DONE]')]),
  );
  await tick();
  const packet = responses(h).at(-1);
  assert.equal(packet.pageUrl, page);
  const model = importBrowserResponse(packet.body, packet);
  assert.equal(model.source.id, 'a');
  assert.equal(model.turns.at(-1).markdown, 'Socket answer.');
});

test('a refetch while the answer arrives over the socket leaves the socket part to end the reply', async () => {
  const { h, socket } = await socketReply();
  const before = h.messages.length;
  // Shown again, the website refetches the conversation with its answer only partway.
  const partway = sourceRecord();
  partway.mapping.a0.children = ['u1'];
  partway.mapping.u1 = {
    id: 'u1',
    parent: 'a0',
    children: ['a1'],
    message: originalMessage('u1', 'user', 'Synthetic question.'),
  };
  partway.mapping.a1 = {
    id: 'a1',
    parent: 'u1',
    children: [],
    message: { ...originalMessage('a1', 'assistant', 'Socket'), status: 'in_progress' },
  };
  partway.current_node = 'a1';
  const loading = h.request('a');
  h.reply(2, JSON.stringify(partway));
  await loading;
  await tick();
  assert.equal(h.messages.length, before, 'no change notice and no partial result');
  socket.emit(
    'message',
    JSON.stringify([socketAnswer('Socket answer.'), socketFrame('data: [DONE]')]),
  );
  await tick();
  const packet = h.messages.at(-1);
  assert.equal(packet.kind, 'response');
  assert.equal(packet.method, 'POST');
  const model = importBrowserResponse(packet.body, packet);
  assert.deepEqual(
    model.turns.map((turn) => turn.id),
    ['u0', 'a0', 'u1', 'a1'],
  );
  assert.equal(model.turns[3].markdown, 'Socket answer.');
});

test('a refetch with the body the app already shows posts nothing', async () => {
  const h = harness();
  const body = JSON.stringify(sourceRecord());
  const first = h.request('a');
  h.reply(0, body);
  await first;
  await tick();
  assert.deepEqual(
    h.messages.map((packet) => packet.kind),
    ['changed', 'response'],
  );
  const again = h.request('a');
  h.reply(1, body);
  await again;
  await tick();
  assert.equal(h.messages.length, 2, 'an identical refetch is a no-op');
  // A different body replaces the result directly; nothing was announced while it loaded.
  const edited = sourceRecord();
  edited.title = 'Edited title';
  const third = h.request('a');
  h.reply(2, JSON.stringify(edited));
  await third;
  await tick();
  assert.deepEqual(
    h.messages.map((packet) => packet.kind),
    ['changed', 'response', 'response'],
  );
  assert.match(h.messages.at(-1).body, /Edited title/u);
  // A refetch that publishes nothing still tells the app its result may be stale.
  const failed = h.fetchWith(endpoint('a'));
  h.requests[3].resolve(new Response('', { status: 503 }));
  await failed;
  await tick();
  assert.equal(h.messages.at(-1).kind, 'changed');
  // After that notice the same body is sent again.
  const after = h.request('a');
  h.reply(4, JSON.stringify(edited));
  await after;
  await tick();
  assert.deepEqual(
    h.messages.slice(-2).map((packet) => packet.kind),
    ['changed', 'response'],
  );
});

// The answer's frames: its first part, then the rest of its text.
const answerStart = () =>
  socketFrame(
    `data: ${JSON.stringify({ conversation_id: 'a', message: { ...originalMessage('a1', 'assistant', 'Socket'), status: 'in_progress' } })}`,
  );
const answerMore = (text) =>
  socketFrame(`data: ${JSON.stringify({ p: '/message/content/parts/0', o: 'append', v: text })}`);
const subscribe = (socket, offset = '0') =>
  socket.send(JSON.stringify([{ command: { type: 'subscribe', topic_id: socketTopic, offset } }]));
const replay = (...frames) =>
  JSON.stringify({ type: 'reply', reply: { topic_id: socketTopic, catchups: frames } });
const socketText = (h) => {
  const packet = responses(h).at(-1);
  assert.equal(packet.method, 'POST');
  return importBrowserResponse(packet.body, packet).turns.map((turn) => turn.markdown);
};

test('a page that reconnects mid-reply is followed to one complete answer', async () => {
  const { h, socket } = await socketReply();
  socket.emit('message', JSON.stringify([answerStart(), answerMore(' answer')]));
  // Reopened: the page opens a new socket, subscribes from the start and closes the old one.
  const renewed = h.socket();
  subscribe(renewed);
  socket.emit('close');
  socket.emit('message', JSON.stringify(answerMore(' stray')));
  await tick();
  assert.equal(responses(h).length, 1, 'still in progress');
  assert.equal(h.messages.at(-1).kind, 'replying');
  // The replay repeats what the old socket delivered; the reader is rebuilt from it.
  renewed.emit('message', replay(answerStart(), answerMore(' answer')));
  renewed.emit('message', JSON.stringify([answerMore(' continues.'), socketFrame('data: [DONE]')]));
  await tick();
  assert.equal(responses(h).length, 2);
  assert.deepEqual(socketText(h), [
    'Earlier question.',
    'Earlier answer.',
    'Synthetic question.',
    'Socket answer continues.',
  ]);
});

test('a subscription renewed on the same socket replays the turn without repeating text', async () => {
  const { h, socket } = await socketReply();
  socket.emit('message', JSON.stringify([answerStart(), answerMore(' answer')]));
  socket.send(JSON.stringify([{ command: { type: 'unsubscribe', topic_id: socketTopic } }]));
  subscribe(socket);
  socket.emit(
    'message',
    replay(answerStart(), answerMore(' answer'), answerMore('.'), socketFrame('data: [DONE]')),
  );
  await tick();
  assert.equal(socketText(h).at(-1), 'Socket answer.');
});

test('a renewal the reader cannot place ends the reply partial, never with repeated text', async () => {
  for (const renew of [
    // A catch-up from an offset the observer never saw.
    (socket) => subscribe(socket, '50'),
    // On the same socket, data before the replay may be the old subscription's: it is not trusted.
    (socket) => {
      subscribe(socket);
      socket.emit('message', JSON.stringify(answerMore(' answer')));
    },
  ]) {
    const { h, socket } = await socketReply();
    socket.emit('message', JSON.stringify([answerStart(), answerMore(' answer')]));
    renew(socket);
    socket.emit(
      'message',
      replay(answerStart(), answerMore(' answer'), socketFrame('data: [DONE]')),
    );
    await tick();
    const packet = responses(h).at(-1);
    const model = importBrowserResponse(packet.body, packet);
    assert.deepEqual(
      model.turns.map((turn) => turn.id),
      ['u0', 'a0', 'u1'],
    );
    assert.equal(model.verification.status, 'partial');
    assert.equal(responses(h).length, 2, 'published once');
  }
});
