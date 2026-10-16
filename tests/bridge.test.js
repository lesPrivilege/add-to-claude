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

test('each file gets its own line, even when two turns make files with the same name', () => {
  const turn = (id, parent, children, role, text) => ({
    parent,
    children,
    message: {
      id,
      author: { role },
      status: 'finished_successfully',
      end_turn: role === 'assistant',
      content: { content_type: 'text', parts: [text] },
    },
  });
  const twoCharts = JSON.stringify({
    conversation_id: 'two',
    title: 'Charts',
    current_node: 'a2',
    mapping: {
      root: { parent: null, children: ['u1'], message: null },
      u1: turn('u1', 'root', ['a1'], 'user', 'First chart.'),
      a1: turn('a1', 'u1', ['u2'], 'assistant', '[chart.png](sandbox:/mnt/data/chart.png)'),
      u2: turn('u2', 'a1', ['a2'], 'user', 'Second chart.'),
      a2: turn('a2', 'u2', [], 'assistant', '[chart.png](sandbox:/mnt/data/chart.png)'),
    },
  });
  const result = compile({
    ...packet,
    pageUrl: 'https://chatgpt.com/c/two',
    responseUrl: 'https://chatgpt.com/backend-api/conversation/two',
    body: twoCharts,
  });
  const lines = result.markdown.split('\n');
  assert.equal(result.attachments.length, 2);
  const [first, second] = result.attachments;
  assert.notEqual(first.key, second.key);
  assert.deepEqual([first.messageId, second.messageId], ['a1', 'a2']);
  assert.notEqual(first.line, second.line);
  for (const file of result.attachments)
    assert.match(lines[file.line], /^- chart\.png — download-needed/);
  // One check line for both, since the message is the same.
  assert.equal(first.check, second.check);
  assert.match(lines[first.check], /^- chart\.png: download this file/);
  assert.equal(result.verification, 'partial');
  assert.equal(result.verifiedWithFiles, true);
});
