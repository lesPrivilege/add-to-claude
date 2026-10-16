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
  const listeners = new Set();
  const context = vm.createContext({ TextEncoder, URL });
  context.webkit = { messageHandlers: { handoff: { postMessage: (value) => posted.push(value) } } };
  context.addEventListener = (type, fn) => type === 'message' && listeners.add(fn);
  context.removeEventListener = (type, fn) => listeners.delete(fn);
  context.location = { origin: 'https://chatgpt.com' };
  vm.runInContext('globalThis.window = globalThis; globalThis.top = globalThis;', context);
  vm.runInContext(await bundle(), context);
  const self = vm.runInContext('window', context);
  const event = (data, ports = [], source = self, origin = 'https://chatgpt.com') =>
    [...listeners].forEach((fn) => fn({ source, origin, data, ports }));
  // What the observer does at document start: offer one private port.
  const port = {};
  const offer = (target = port) => event({ type: 'add-to-claude/port' }, [target]);
  const send = (packet, through = port) => through.onmessage?.({ data: packet });
  return { posted, event, offer, send };
}

test('the bundled bridge posts exactly what the compiler module produces', async () => {
  const { posted, offer, send } = await run();
  offer();
  send(packet);
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

test('only the first port is used; page-posted packets and foreign or later ports are ignored', async () => {
  const { posted, event, offer, send } = await run();
  event({ type: 'add-to-claude/source', packet }); // A page script posting a packet directly.
  event({ type: 'add-to-claude/port' }, [{}], {}); // A port from another window.
  event({ type: 'add-to-claude/port' }, [{}], undefined, 'https://example.com');
  offer(); // The observer's port, offered first at document start.
  const later = {};
  offer(later); // A page script offering its own port afterwards.
  send(packet, later);
  assert.equal(posted.length, 0);
  send({ kind: 'changed', pageUrl: packet.pageUrl });
  send({ ...packet, body: '{' });
  assert.deepEqual(
    posted.map((value) => value.kind),
    ['changed', 'invalid'],
  );
});
