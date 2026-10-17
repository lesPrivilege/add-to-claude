// Writes tests/fixtures/bridge-messages.json: the compiler's messages to the app for one synthetic
// packet. Run it when the compiler's output changes on purpose, then review the diff; both the JS and
// the WebKit suites read the fixture.
import { writeFileSync } from 'node:fs';
import { format } from 'prettier';
import { compile, compileModel, handoff } from '../src/compile.js';

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
const packet = {
  kind: 'response',
  pageUrl: 'https://chatgpt.com/c/synthetic-bridge',
  responseUrl: 'https://chatgpt.com/backend-api/conversation/synthetic-bridge',
  capturedAt: '2026-10-17T00:00:00.000Z',
  method: 'GET',
  body: JSON.stringify({
    conversation_id: 'synthetic-bridge',
    title: 'Synthetic bridge contract',
    current_node: 'a2',
    mapping: {
      root: { parent: null, children: ['u1'], message: null },
      u1: turn('u1', 'root', ['a1'], 'user', 'Make a chart.'),
      a1: turn(
        'a1',
        'u1',
        ['u2'],
        'assistant',
        'Here it is: [chart.png](sandbox:/mnt/data/chart.png)',
      ),
      u2: turn('u2', 'a1', ['a2'], 'user', 'And a summary.'),
      a2: turn('a2', 'u2', [], 'assistant', 'A **short** summary.'),
    },
  }),
};
const model = compileModel(packet);
const ready = { kind: 'ready', page: packet.pageUrl, ...compile(packet, model) };
const turns = ready.turnList.slice(1).map(({ id, sha256 }) => ({ id, sha256 }));
const note = 'new since last add';
const fixture = {
  about:
    'Synthetic. What the compiler sends the app for one packet, and for a choice of its turns. tests/bridge.test.js checks the compiler still produces exactly this; the WebKit suite checks the app accepts it and refuses broken variants.',
  packet,
  ready,
  project: {
    page: packet.pageUrl,
    turns,
    note,
    result: handoff(model, { turnIds: turns.map((t) => t.id), note }),
  },
};
writeFileSync(
  new URL('../tests/fixtures/bridge-messages.json', import.meta.url),
  await format(JSON.stringify(fixture), { parser: 'json' }),
);
