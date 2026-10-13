import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installEmbeddedSourceObserver } from '../web/embedded-source.js';

const page = 'https://chatgpt.com/c/a';
const endpoint = (id) => `https://chatgpt.com/backend-api/conversation/${id}`;
const tick = () => new Promise((resolve) => setImmediate(resolve));
function harness() {
  const messages = [],
    requests = [];
  const location = {
    href: page,
    get origin() {
      return new URL(this.href).origin;
    },
  };
  const window = {
    webkit: {
      messageHandlers: {
        handoffSource: {
          postMessage: (packet) => messages.push(JSON.parse(JSON.stringify(packet))),
        },
      },
    },
    fetch(url) {
      return new Promise((resolve) => requests.push({ url, resolve }));
    },
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
    addEventListener() {},
  });
  vm.runInContext(`(${installEmbeddedSourceObserver.toString()})({})`, context);
  return {
    messages,
    navigate: (url) => history.pushState({}, '', url),
    request: (id) => window.fetch(endpoint(id)).then((response) => response.text()),
    reply(index, body) {
      const response = new Response(body, { status: 200 });
      Object.defineProperty(response, 'url', { value: requests[index].url });
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
