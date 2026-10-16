import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { bundle } from '../scripts/build-webkit.js';
import { compileModel, handoff } from '../src/compile.js';
import { describeTurns, projectMarkdown, scopeLine, validateConversation } from '../src/model.js';
import { sha256Hex } from '../src/sha256.js';

const node = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

// A synthetic six-turn conversation: references on turn 2, a file and its check on turn 4, a turn-level
// check on turn 6, a conversation-wide check, and a file that belongs to no turn.
const at = (id) => `synthetic.mapping[${JSON.stringify(id)}]`;
function conversation() {
  const turn = (id, role, markdown, extra = {}) => ({
    id,
    role,
    markdown,
    sourceLocator: `${at(id)}.message`,
    contentFidelity: 'original-markdown',
    ...extra,
  });
  return validateConversation({
    schemaVersion: 1,
    source: {
      type: 'synthetic',
      id: 'six',
      title: 'Six turns',
      url: 'https://chatgpt.com/c/six',
      locator: 'synthetic',
    },
    branches: {
      selectedLeaf: 't6',
      availableLeaves: [{ id: 't6', turnCount: 6 }],
      selection: 'single-path',
    },
    turns: [
      turn('t1', 'user', 'First question.'),
      turn('t2', 'assistant', 'An answer\nover two lines.', {
        citations: [
          { title: 'Ref two', url: 'https://example.com/two', sourceLocator: `${at('t2')}.cite` },
        ],
      }),
      turn('t3', 'user', 'Make a chart.'),
      turn('t4', 'assistant', 'Here it is.'),
      turn('t5', 'user', 'And a summary?'),
      turn('t6', 'assistant', 'A summary with ![x](y).', { contentFidelity: 'partial' }),
    ],
    attachments: [
      {
        id: '1:file-chart',
        name: 'chart.png',
        status: 'download-needed',
        sourceLocator: `${at('t4')}.message.metadata.attachments[0]`,
        turnId: 't4',
      },
      {
        id: '2:file-loose',
        name: 'loose.txt',
        status: 'download-needed',
        sourceLocator: 'synthetic.loose[0]',
      },
    ],
    verification: {
      status: 'partial',
      issues: [
        {
          code: 'attachment-download-needed',
          message: 'chart.png: download this file.',
          sourceLocator: `${at('t4')}.message.metadata.attachments[0]`,
        },
        {
          code: 'attachment-download-needed',
          message: 'loose.txt: download this file.',
          sourceLocator: 'synthetic.loose[0]',
        },
        {
          code: 'omitted-inline-content',
          message: 'Inline images are not included.',
          sourceLocator: `${at('t6')}.message.content`,
        },
        {
          code: 'earlier-turns-unloaded',
          message: 'Earlier turns were not loaded.',
          sourceLocator: 'response.page_info',
        },
      ],
    },
  });
}

test('the synchronous SHA-256 matches node:crypto, including multi-block and non-ASCII input', () => {
  for (const text of [
    '',
    'abc',
    'Original **Markdown** 中文 ✓\n',
    'x'.repeat(55),
    'y'.repeat(56),
    'z'.repeat(1000),
  ])
    assert.equal(sha256Hex(text), node(text));
});

test('every turn is the whole text, byte for byte, with no scope line', () => {
  const model = conversation();
  const whole = projectMarkdown(model);
  assert.equal(
    projectMarkdown(model, null, { turnIds: ['t6', 't1', 't2', 't3', 't4', 't5'], note: 'chosen' }),
    whole,
  );
  assert.doesNotMatch(whole, /^Turns? \d/mu);
});

test('a subset keeps source order, original numbers and only its own references and files', () => {
  const model = conversation();
  const text = projectMarkdown(model, null, { turnIds: ['t5', 't2'], note: 'chosen' });
  assert.match(text, /^Selected turns: 2, 5 of 6$/mu);
  assert.ok(text.indexOf('## Turn 2 — Assistant') < text.indexOf('## Turn 5 — User'));
  assert.doesNotMatch(text, /## Turn [1346]/u);
  assert.match(text, /Ref two/u);
  assert.doesNotMatch(text, /chart\.png/u);
  // A file of no turn goes with every choice, with its check; a check on turn 6 does not.
  assert.match(text, /^- loose\.txt — download-needed$/mu);
  assert.match(text, /loose\.txt: download this file/u);
  assert.doesNotMatch(text, /Inline images/u);
  // The conversation-wide check always goes.
  assert.match(text, /Earlier turns were not loaded/u);
  assert.match(text, /verification: partial/u);
});

test('a subset carries only the checks about its turns and files', () => {
  const model = conversation();
  const four = projectMarkdown(model, null, { turnIds: ['t3', 't4'], note: 'new since last add' });
  assert.match(four, /^Turns 3–4 of 6 · new since last add$/mu);
  assert.match(four, /chart\.png: download this file/u);
  assert.doesNotMatch(four, /Inline images/u);
  const six = projectMarkdown(model, null, { turnIds: ['t6'], note: 'new since last add' });
  assert.match(six, /^Turn 6 of 6 · new since last add$/mu);
  assert.match(six, /Inline images/u);
  assert.doesNotMatch(six, /chart\.png/u);
});

test('a subset with nothing to check reads verified even when the whole is partial', () => {
  const model = conversation();
  model.attachments.pop();
  model.verification.issues.splice(1);
  // Left: only the chart check, on turn 4.
  const lines = {};
  const text = projectMarkdown(model, lines, { turnIds: ['t1', 't2'], note: 'chosen' });
  assert.match(text, /verification: verified/u);
  assert.doesNotMatch(text, /Content checks/u);
  assert.equal(lines.selection.verification.status, 'verified');
  assert.match(projectMarkdown(model), /verification: partial/u);
});

test('file and check line numbers point at their own lines in the subset text', () => {
  const model = conversation();
  for (const turnIds of [null, ['t4'], ['t3', 't4', 't6'], ['t1']]) {
    const lines = {};
    const text = projectMarkdown(model, lines, turnIds ? { turnIds, note: 'chosen' } : {});
    const rows = text.split('\n');
    for (const [id, line] of lines.files) {
      const name = model.attachments.find((file) => file.id === id).name;
      assert.equal(rows[line], `- ${name} — download-needed`, `${id} in ${turnIds}`);
    }
    for (const [message, line] of lines.checks) assert.equal(rows[line], `- ${message}`);
  }
});

test('scope lines: one turn, a run, and separate runs', () => {
  assert.equal(scopeLine([15], 42, 'new since last add'), 'Turn 15 of 42 · new since last add');
  assert.equal(
    scopeLine([15, 16, 17, 18, 19, 20, 21], 42, 'new since last add'),
    'Turns 15–21 of 42 · new since last add',
  );
  assert.equal(scopeLine([3, 5, 6, 7, 8, 9], 42, 'chosen'), 'Selected turns: 3, 5–9 of 42');
  assert.equal(
    scopeLine([3, 5, 6], 42, 'added again'),
    'Selected turns: 3, 5–6 of 42 · added again',
  );
});

test('unknown notes, empty choices and foreign turn ids are refused', () => {
  const model = conversation();
  assert.throws(
    () => projectMarkdown(model, null, { turnIds: ['t1'], note: 'read by Claude' }),
    /Unknown scope note/u,
  );
  assert.throws(() => projectMarkdown(model, null, { turnIds: [] }), /at least one turn/u);
  assert.throws(
    () => projectMarkdown(model, null, { turnIds: ['nope'] }),
    /not in this conversation/u,
  );
});

test('turn metadata: role, position, short preview, files, and a hash of the body without its number', () => {
  const model = conversation();
  model.turns[0].markdown = `Long ${'word '.repeat(40)}end`;
  const turns = describeTurns(model, sha256Hex);
  assert.deepEqual(
    turns.map((turn) => [turn.id, turn.role, turn.position]),
    [
      ['t1', 'user', 1],
      ['t2', 'assistant', 2],
      ['t3', 'user', 3],
      ['t4', 'assistant', 4],
      ['t5', 'user', 5],
      ['t6', 'assistant', 6],
    ],
  );
  assert.ok([...turns[0].preview].length <= 80 && turns[0].preview.endsWith('…'));
  assert.equal(turns[1].preview, 'An answer over two lines.');
  assert.deepEqual(turns[3].files, ['1:file-chart']);
  assert.match(turns[0].sha256, /^[a-f0-9]{64}$/u);
  // Same text in another position: same hash. Edited text: another hash.
  const shifted = validateConversation({
    ...model,
    turns: model.turns.slice(1),
    attachments: [],
    verification: { status: 'partial', issues: [] },
  });
  const again = describeTurns(shifted, sha256Hex);
  assert.equal(again.find((turn) => turn.id === 't3').sha256, turns[2].sha256);
  model.turns[2].markdown = 'Make two charts.';
  assert.notEqual(describeTurns(model, sha256Hex)[2].sha256, turns[2].sha256);
});

// The bridge, run as the app loads it, answering the app's request for some turns.
const message = (id, parent, children, role, text) => ({
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
  pageUrl: 'https://chatgpt.com/c/four',
  responseUrl: 'https://chatgpt.com/backend-api/conversation/four',
  capturedAt: new Date().toISOString(),
  method: 'GET',
  body: JSON.stringify({
    conversation_id: 'four',
    title: 'Charts',
    current_node: 'a2',
    mapping: {
      root: { parent: null, children: ['u1'], message: null },
      u1: message('u1', 'root', ['a1'], 'user', 'First chart.'),
      a1: message('a1', 'u1', ['u2'], 'assistant', '[chart.png](sandbox:/mnt/data/chart.png)'),
      u2: message('u2', 'a1', ['a2'], 'user', 'Second chart.'),
      a2: message('a2', 'u2', [], 'assistant', '[chart.png](sandbox:/mnt/data/chart.png)'),
    },
  }),
};

async function bridge() {
  const posted = [];
  let listener;
  const context = vm.createContext({ TextEncoder, URL });
  context.webkit = { messageHandlers: { handoff: { postMessage: (value) => posted.push(value) } } };
  context.addEventListener = (type, fn) => (listener = fn);
  context.removeEventListener = () => {};
  context.location = { origin: 'https://chatgpt.com' };
  vm.runInContext('globalThis.window = globalThis; globalThis.top = globalThis;', context);
  vm.runInContext(await bundle(), context);
  const port = {};
  listener({
    source: vm.runInContext('window', context),
    origin: 'https://chatgpt.com',
    data: { type: 'add-to-claude/port' },
    ports: [port],
  });
  port.onmessage({ data: packet });
  const project = (...args) =>
    JSON.parse(JSON.stringify(vm.runInContext('addToClaudeProject', context)(...args)));
  return { posted, project };
}

test('the bridge projects the turns the app names, with their hashes, and nothing once they changed', async () => {
  const { posted, project } = await bridge();
  const ready = posted[0];
  assert.equal(ready.kind, 'ready');
  assert.equal(ready.turnList.length, 4);
  for (const turn of ready.turnList) assert.ok(turn.preview.length <= 80);
  const pick = (ids) =>
    ready.turnList
      .filter((turn) => ids.includes(turn.id))
      .map(({ id, sha256 }) => ({ id, sha256 }));
  const result = project(packet.pageUrl, pick(['u2', 'a2']), 'new since last add');
  assert.deepEqual(
    result,
    JSON.parse(
      JSON.stringify(
        handoff(compileModel(packet), { turnIds: ['u2', 'a2'], note: 'new since last add' }),
      ),
    ),
  );
  assert.match(result.markdown, /^Turns 3–4 of 4 · new since last add$/mu);
  assert.equal(result.attachments.length, 1);
  assert.equal(result.attachments[0].messageId, 'a2');
  assert.match(
    result.markdown.split('\n')[result.attachments[0].line],
    /^- chart\.png — download-needed/u,
  );
  assert.match(
    result.markdown.split('\n')[result.attachments[0].check],
    /^- chart\.png: download this file/u,
  );
  assert.equal(result.selectedTurns, 2);
  // A hash the page no longer has, another page, or malformed input: nothing.
  const stale = pick(['u2']);
  stale[0].sha256 = '0'.repeat(64);
  assert.ok(project(packet.pageUrl, stale, 'chosen').error);
  assert.ok(project('https://chatgpt.com/c/other', pick(['u2']), 'chosen').error);
  assert.ok(project(packet.pageUrl, [{ id: 'u2' }], 'chosen').error);
  assert.ok(project(packet.pageUrl, [], 'chosen').error);
  assert.ok(project(packet.pageUrl, pick(['u2']), 'something else').error);
});
