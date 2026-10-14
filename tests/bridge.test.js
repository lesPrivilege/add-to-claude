import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bundle } from '../scripts/build-webkit.js';
import { compile } from '../src/compile.js';

const body = JSON.stringify({
  conversation_id: 'one',
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
        content: { content_type: 'text', parts: ['Original **Markdown** 中文 ✓\n'] },
      },
    },
  },
});
const packet = {
  kind: 'response',
  pageUrl: 'https://chatgpt.com/c/one',
  responseUrl: 'https://chatgpt.com/backend-api/conversation/one',
  capturedAt: new Date().toISOString(),
  method: 'GET',
  body,
};

async function run() {
  const posted = [];
  let listener;
  const context = vm.createContext({ TextEncoder, URL });
  context.webkit = { messageHandlers: { handoff: { postMessage: (value) => posted.push(value) } } };
  context.addEventListener = (type, fn) => type === 'message' && (listener = fn);
  context.location = { origin: 'https://chatgpt.com' };
  vm.runInContext('globalThis.window = globalThis; globalThis.top = globalThis;', context);
  vm.runInContext(await bundle(), context);
  const self = vm.runInContext('window', context);
  const send = (data, source = self, origin = 'https://chatgpt.com') =>
    listener({ source, origin, data });
  return { posted, send };
}

test('the bundled bridge posts exactly what the compiler module produces', async () => {
  const { posted, send } = await run();
  send({ type: 'gpt-handoff/source', packet });
  assert.equal(posted.length, 1);
  const { kind, page, ...rest } = posted[0];
  assert.equal(kind, 'ready');
  assert.equal(page, packet.pageUrl);
  assert.deepEqual(JSON.parse(JSON.stringify(rest)), compile(packet));
  assert.ok(
    rest.markdown.indexOf('Synthetic question.') <
      rest.markdown.indexOf('Original **Markdown** 中文 ✓'),
  );
  assert.equal(rest.turns, 2);
  assert.equal(rest.verification, 'verified');
});

test('changes, failures and foreign messages are reported or ignored', async () => {
  const { posted, send } = await run();
  send({ type: 'gpt-handoff/source', packet: { kind: 'changed', pageUrl: packet.pageUrl } });
  send({ type: 'gpt-handoff/source', packet: { ...packet, body: '{' } });
  send({ type: 'gpt-handoff/source', packet }, {}); // another window
  send({ type: 'gpt-handoff/source', packet }, undefined, 'https://example.com');
  send({ type: 'other', packet });
  assert.deepEqual(
    posted.map((value) => value.kind),
    ['changed', 'invalid'],
  );
});
