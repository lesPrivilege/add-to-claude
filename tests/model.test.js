import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, safeUrl, validateConversation } from '../src/model.js';
import { projectMarkdown } from '../src/projection.js';
import { demoConversation } from './demo-conversation.js';
import { importConversation, listConversations } from '../src/import.js';

function node(id, parent, role, text, extra = {}) {
  return {
    id,
    parent,
    message: {
      author: { role },
      content: { content_type: 'text', parts: [text] },
      status: 'finished_successfully',
      ...extra,
    },
  };
}
function fixture() {
  return [
    {
      id: 'conversation-1',
      title: 'A synthetic branch',
      current_node: 'a2',
      mapping: {
        root: { parent: null, message: null },
        u1: node('u1', 'root', 'user', 'Start **here**.'),
        a1: node('a1', 'u1', 'assistant', 'First answer.'),
        u2: node('u2', 'a1', 'user', 'Then `continue`.'),
        a2: node(
          'a2',
          'u2',
          'assistant',
          '```js\nconst value = "<tag>";\n```\n\n[Source](https://example.com/)',
        ),
        alternate: node('alternate', 'u1', 'assistant', 'A different answer.'),
      },
    },
  ];
}

test('selection metadata contains no conversation content', () => {
  const list = listConversations(JSON.stringify(fixture()));
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].leafIds, ['a2', 'alternate']);
  assert.equal(list[0].turnCount, 5);
  assert.equal(list[0].branchCount, 2);
  assert.equal(JSON.stringify(list).includes('different answer'), false);
});

test('current-node path preserves parent order and original Markdown', () => {
  const input = fixture();
  // Deliberately rearrange storage order: ancestry, not object key order, determines order.
  input[0].mapping = Object.fromEntries(Object.entries(input[0].mapping).reverse());
  const model = importConversation(input, 'conversation-1');
  assert.deepEqual(
    model.turns.map((turn) => turn.id),
    ['u1', 'a1', 'u2', 'a2'],
  );
  assert.equal(model.turns[3].markdown, input[0].mapping.a2.message.content.parts[0]);
  assert.deepEqual(model.turns[3].sourceLocators, ['conversations[0].mapping["a2"].message']);
  assert.equal(model.verification.status, 'verified');
  assert.equal(model.branches.selection, 'current-node');
});

test('internal, hidden and non-user-facing messages never enter the handoff projection', () => {
  for (const extra of [
    { metadata: { is_visually_hidden_from_conversation: true } },
    { recipient: 'python' },
    { weight: 0 },
    { channel: 'analysis' },
  ]) {
    const input = fixture();
    input[0].mapping.internal = node(
      'internal',
      'u1',
      'assistant',
      'INTERNAL MATERIAL MUST NOT BE PROJECTED',
      extra,
    );
    input[0].mapping.a1.parent = 'internal';
    const model = importConversation(input, 'conversation-1');
    assert.deepEqual(
      model.turns.map((turn) => turn.id),
      ['u1', 'a1', 'u2', 'a2'],
    );
    assert.equal(listConversations(input)[0].turnCount, 5);
    assert.equal(model.source.excludedMessages, 1);
    assert.equal(JSON.stringify(model).includes('INTERNAL MATERIAL'), false);
    assert.equal(projectMarkdown(model).includes('INTERNAL MATERIAL'), false);
  }
});

test('interrupted and length-limited replies are partial even when other completion fields are true', () => {
  for (const finish of ['interrupted', 'max_tokens']) {
    const input = fixture();
    input[0].mapping.a2.message.end_turn = true;
    input[0].mapping.a2.message.metadata = { is_complete: true, finish_details: { type: finish } };
    const model = importConversation(input, 'conversation-1');
    assert.equal(model.verification.status, 'partial');
    assert.ok(model.verification.issues.some((issue) => issue.code === 'unfinished-turn'));
  }
});

test('an explicit alternative branch does not mix variants', () => {
  const model = importConversation(fixture(), 'conversation-1', 'alternate');
  assert.deepEqual(
    model.turns.map((turn) => turn.id),
    ['u1', 'alternate'],
  );
  assert.equal(model.branches.selection, 'explicit');
  assert.throws(() => importConversation(fixture(), 'conversation-1', 'u1'), /not a leaf/u);
  const input = fixture();
  delete input[0].current_node;
  assert.throws(() => importConversation(input, 'conversation-1'), /Choose a branch/u);
});

test('missing parent and cycles produce explicitly partial recoveries', () => {
  const input = fixture();
  input[0].mapping.u1.parent = 'missing';
  const result = importConversation(input, 'conversation-1');
  assert.equal(result.verification.status, 'partial');
  assert.ok(result.verification.issues.some((issue) => issue.code === 'missing-parent'));
  input[0].mapping.u1.parent = 'a2';
  const cycle = importConversation(input, 'conversation-1');
  assert.equal(cycle.verification.status, 'partial');
  assert.ok(cycle.verification.issues.some((issue) => issue.code === 'cycle'));
});

test('missing current node is reported and cannot be mislabeled complete', () => {
  const input = fixture();
  input[0].current_node = 'removed';
  const result = importConversation(input, 'conversation-1');
  assert.equal(result.turns.length, 0);
  assert.equal(result.verification.status, 'partial');
  assert.ok(result.verification.issues.some((issue) => issue.code === 'missing-parent'));
});

test('a listed but missing sibling makes the branch inventory explicitly partial', () => {
  const input = fixture();
  input[0].mapping.u1.children = ['a1', 'alternate', 'missing-sibling'];
  const summary = listConversations(input)[0];
  assert.equal(summary.branchInventory, 'partial');
  assert.ok(summary.inventoryIssues.some((issue) => issue.code === 'branch-missing-child'));
  const model = importConversation(input, 'conversation-1');
  assert.equal(model.verification.status, 'partial');
  assert.ok(model.verification.issues.some((issue) => issue.code === 'branch-missing-child'));
  assert.deepEqual(
    model.turns.map((turn) => turn.id),
    ['u1', 'a1', 'u2', 'a2'],
  );
});

test('contradictory and malformed children cannot imply a complete branch inventory', () => {
  for (const [children, expectedCode] of [
    [['a2'], 'branch-parent-mismatch'],
    [[], 'branch-child-omission'],
    [['a1', 'a1', 'alternate'], 'branch-duplicate-child'],
    [['a1', null], 'branch-invalid-child'],
    [{ child: 'a1' }, 'branch-invalid-children'],
  ]) {
    const input = fixture();
    input[0].mapping.u1.children = children;
    const model = importConversation(input, 'conversation-1');
    assert.equal(model.verification.status, 'partial');
    assert.ok(
      model.verification.issues.some((issue) => issue.code === expectedCode),
      expectedCode,
    );
  }
});

test('broken messages and cycles on unselected variants remain visible as inventory defects', () => {
  for (const mutate of [
    (mapping) => {
      mapping.alternate.message = null;
    },
    (mapping) => {
      delete mapping.alternate.message.author.role;
    },
    (mapping) => {
      mapping.alternate.parent = 'alternate';
    },
    (mapping) => {
      delete mapping.root.message;
    },
  ]) {
    const input = fixture();
    mutate(input[0].mapping);
    const model = importConversation(input, 'conversation-1');
    assert.equal(model.verification.status, 'partial');
    assert.ok(model.verification.issues.some((issue) => /^branch-/u.test(issue.code)));
  }
});

test('consistent declared children preserve verified branch counts', () => {
  const input = fixture();
  for (const entry of Object.values(input[0].mapping)) entry.children = [];
  for (const [id, entry] of Object.entries(input[0].mapping))
    if (entry.parent) input[0].mapping[entry.parent].children.push(id);
  const model = importConversation(input, 'conversation-1');
  assert.equal(model.verification.status, 'verified');
  assert.equal(listConversations(input)[0].branchInventory, 'complete');
  assert.deepEqual(model.branches.availableLeaves, [
    { id: 'a2', turnCount: 4 },
    { id: 'alternate', turnCount: 2 },
  ]);
});

test('branch counts visit shared prefixes once rather than once per leaf', () => {
  const mapping = { root: { parent: null, message: null } };
  for (let index = 0; index < 100; index += 1)
    mapping[`n${index}`] = node(
      `n${index}`,
      index ? `n${index - 1}` : 'root',
      index % 2 ? 'assistant' : 'user',
      'Synthetic text.',
    );
  for (let index = 0; index < 500; index += 1)
    mapping[`leaf${index}`] = node(`leaf${index}`, 'n99', 'assistant', 'Synthetic variant.');
  let parentReads = 0;
  for (const entry of Object.values(mapping)) {
    const parent = entry.parent;
    Object.defineProperty(entry, 'parent', {
      enumerable: true,
      get() {
        parentReads += 1;
        return parent;
      },
    });
  }
  const model = importConversation(
    [{ id: 'wide-graph', title: 'Synthetic shared prefix', current_node: 'leaf0', mapping }],
    'wide-graph',
  );
  assert.equal(model.branches.availableLeaves.length, 500);
  assert.ok(model.branches.availableLeaves.every((leaf) => leaf.turnCount === 101));
  assert.ok(
    parentReads < Object.keys(mapping).length * 30,
    `Expected bounded graph visits; observed ${parentReads} parent reads.`,
  );
});

test('excessive declared edges stop at a bounded inventory limit with an explicit issue', () => {
  const input = fixture();
  input[0].mapping.u1.children = Array.from({ length: LIMITS.maxNodes * 2 + 1 }, () => 'a1');
  const model = importConversation(input, 'conversation-1');
  assert.equal(model.verification.status, 'partial');
  assert.ok(model.verification.issues.some((issue) => issue.code === 'branch-edge-limit'));
});

test('nontext content, pending attachment and streaming remain partial', () => {
  const input = fixture();
  input[0].mapping.a2.message.content = {
    content_type: 'multimodal_text',
    parts: [
      'Here is an image.',
      { content_type: 'image_asset_pointer', asset_pointer: 'file-service://synthetic-file' },
    ],
  };
  input[0].mapping.a2.message.status = 'in_progress';
  const model = importConversation(input, 'conversation-1');
  assert.equal(model.verification.status, 'partial');
  assert.equal(model.turns.at(-1).contentFidelity, 'partial');
  assert.equal(model.attachments[0].status, 'download-needed');
  assert.equal(model.attachments[0].url, undefined);
  assert.ok(model.verification.issues.some((issue) => issue.code === 'unfinished-turn'));
  assert.ok(model.verification.issues.some((issue) => issue.code === 'nontext-content'));
});

test('finished turns with empty supported text cannot be verified', () => {
  for (const parts of [[], [''], [' \n\t']]) {
    const input = fixture();
    input[0].mapping.a2.message.content.parts = parts;
    const model = importConversation(input, 'conversation-1');
    assert.equal(model.verification.status, 'partial');
    assert.equal(model.turns.at(-1).contentFidelity, 'partial');
    assert.ok(model.verification.issues.some((issue) => issue.code === 'empty-text'));
  }
});

test('structured code retains exact text and language and projects as explicitly converted fenced code', () => {
  const input = fixture();
  input[0].mapping.a2.message.content = {
    content_type: 'code',
    language: 'python',
    text: 'print(1)',
  };
  const model = importConversation(input, 'conversation-1');
  const turn = model.turns.at(-1);
  assert.deepEqual(turn.code, { language: 'python', sourceText: 'print(1)' });
  assert.equal(turn.markdown, 'print(1)');
  assert.equal(turn.contentFidelity, 'partial');
  assert.equal(model.verification.status, 'partial');
  assert.ok(model.verification.issues.some((issue) => issue.code === 'structured-code'));
  assert.ok(projectMarkdown(model).includes('```python\nprint(1)\n```'));
  assert.deepEqual(
    validateConversation(JSON.parse(JSON.stringify(model))).turns.at(-1).code,
    turn.code,
  );
});

test('structured code fences contain literal HTML and internal fence runs without consuming later turns', () => {
  const model = demoConversation();
  const sourceText = '```\n<script>literal code</script>\n````';
  model.turns[0] = {
    ...model.turns[0],
    markdown: sourceText,
    code: { language: 'html', sourceText },
  };
  const validated = validateConversation(model);
  assert.equal(validated.turns[0].contentFidelity, 'partial');
  assert.equal(validated.verification.status, 'partial');
  assert.ok(
    projectMarkdown(validated).includes(
      '`````html\n```\n<script>literal code</script>\n````\n`````\n\n## Turn 2 — Assistant',
    ),
  );
  assert.throws(
    () =>
      validateConversation({
        ...model,
        turns: [{ ...model.turns[0], code: { language: 'html', sourceText: 'different' } }],
      }),
    /must match/u,
  );
  assert.throws(
    () =>
      validateConversation({
        ...model,
        turns: [{ ...model.turns[0], code: { language: 'html\n<script>', sourceText } }],
      }),
    /single-line/u,
  );
});

test('unknown roles and absent completion status cannot be verified', () => {
  for (const mutate of [
    (message) => {
      delete message.author.role;
    },
    (message) => {
      delete message.status;
    },
    (message) => {
      message.status = null;
    },
    (message) => {
      message.end_turn = false;
    },
  ]) {
    const input = fixture();
    mutate(input[0].mapping.a2.message);
    const model = importConversation(input, 'conversation-1');
    assert.equal(model.verification.status, 'partial');
    assert.ok(
      model.verification.issues.some((issue) =>
        ['unknown-role', 'unknown-turn-status', 'unfinished-turn'].includes(issue.code),
      ),
    );
  }
  const input = fixture();
  input[0].mapping.a2.message.end_turn = false;
  input[0].mapping.toolResult = node('toolResult', 'a2', 'tool', 'Synthetic tool result.');
  input[0].current_node = 'toolResult';
  const model = importConversation(input, 'conversation-1');
  assert.equal(model.verification.status, 'partial');
  assert.ok(model.verification.issues.some((issue) => issue.code === 'unfinished-turn'));
});

test('attachment metadata preserves explicit expired and inaccessible state with safe names', () => {
  const input = fixture();
  input[0].mapping.u1.message.metadata = {
    attachments: [
      {
        id: 'file-1',
        name: '../../report.pdf',
        status: 'expired',
        url: 'https://example.com/report',
      },
      { id: 'file-2', name: 'notes.txt', status: 'inaccessible', url: 'file:///etc/passwd' },
    ],
  };
  const result = importConversation(input, 'conversation-1');
  assert.equal(result.verification.status, 'partial');
  assert.deepEqual(
    result.attachments.map((item) => item.status),
    ['expired', 'inaccessible'],
  );
  assert.equal(result.attachments[0].name.includes('/'), false);
  assert.equal(result.attachments[1].url, undefined);
});

test('citation links and original text-part boundaries survive', () => {
  const input = fixture();
  input[0].mapping.a2.message.content.parts = ['First text.', 'Second text.'];
  input[0].mapping.a2.message.metadata = {
    content_references: [{ type: 'webpage', title: 'Example', url: 'https://example.com/source' }],
  };
  const turn = importConversation(input, 'conversation-1').turns.at(-1);
  assert.deepEqual(turn.originalParts, ['First text.', 'Second text.']);
  assert.equal(turn.markdown, 'First text.\n\nSecond text.');
  assert.equal(turn.citations[0].url, 'https://example.com/source');
});

test('generated sandbox links are file references, never proof that attachments are present', () => {
  const input = fixture();
  input[0].mapping.a2.message.content.parts = ['[Download report](sandbox:/mnt/data/report.csv)'];
  const model = importConversation(input, 'conversation-1');
  assert.equal(model.attachments[0].name, 'report.csv');
  assert.equal(model.attachments[0].status, 'download-needed');
  assert.equal(model.attachments[0].url, undefined);
  assert.equal(model.verification.status, 'partial');
  assert.equal(model.turns.at(-1).markdown, '[Download report](sandbox:/mnt/data/report.csv)');
});

test('unresolved citation markers are partial, while safe_urls and nested citation metadata recover links', () => {
  const input = fixture();
  input[0].mapping.a2.message.content.parts = ['A statement. \ue200cite\ue202turn0search0\ue201'];
  assert.ok(
    importConversation(input, 'conversation-1').verification.issues.some(
      (issue) => issue.code === 'unresolved-citations',
    ),
  );
  input[0].mapping.a2.message.metadata = {
    citations: [{ metadata: { title: 'Source', url: 'https://example.com/article' } }],
    content_references: [{ safe_urls: ['https://example.com/second'] }],
  };
  const model = importConversation(input, 'conversation-1');
  assert.equal(model.verification.status, 'partial');
  assert.ok(model.verification.issues.some((issue) => issue.code === 'unresolved-citations'));
  assert.deepEqual(
    model.turns.at(-1).citations.map((item) => item.url),
    ['https://example.com/article', 'https://example.com/second'],
  );
});

test('two internal source markers and one recovered URL cannot imply complete citation mapping', () => {
  const input = fixture();
  input[0].mapping.a2.message.content.parts = [
    'A. \ue200cite\ue202turn0search0\ue201 B. \ue200cite\ue202turn0search1\ue201',
  ];
  input[0].mapping.a2.message.metadata = { citations: [{ url: 'https://example.com/one' }] };
  const model = importConversation(input, 'conversation-1');
  assert.equal(model.verification.status, 'partial');
  assert.equal(model.turns.at(-1).contentFidelity, 'partial');
  assert.equal(model.turns.at(-1).citations.length, 1);
  assert.ok(model.verification.issues.some((issue) => issue.code === 'unresolved-citations'));
});

test('unknown citation wrappers and malformed source entries report incompleteness', () => {
  const examples = [
    [{ unfamiliarWrapper: { url: 'https://example.com/missing' } }],
    [
      {
        url: 'https://example.com/known',
        unfamiliarWrapper: { url: 'https://example.com/missing' },
      },
    ],
    [{ url: 'https://example.com/known', website: 'https://example.com/missing' }],
    [{ url: 'file:///unavailable' }],
    [null],
    [{ title: 'Unresolved source' }],
  ];
  for (const citations of examples) {
    const input = fixture();
    input[0].mapping.a2.message.metadata = { citations };
    const model = importConversation(input, 'conversation-1');
    assert.equal(model.verification.status, 'partial');
    assert.ok(model.verification.issues.some((issue) => issue.code === 'unrecognized-citation'));
  }
});

test('truncated citation arrays and excessive nesting report incompleteness', () => {
  let deep = { url: 'https://example.com/deep' };
  for (let index = 0; index < 8; index += 1) deep = { sources: deep };
  for (const citations of [
    Array.from({ length: 1001 }, () => ({ url: 'https://example.com/repeated' })),
    deep,
  ]) {
    const input = fixture();
    input[0].mapping.a2.message.metadata = { citations };
    const model = importConversation(input, 'conversation-1');
    assert.equal(model.verification.status, 'partial');
    assert.ok(model.verification.issues.some((issue) => issue.code === 'truncated-citations'));
  }
});

test('malformed exports, duplicate IDs and unknown structure fail clearly', () => {
  assert.throws(() => listConversations('{'), /not valid JSON/u);
  assert.throws(() => listConversations({}), /conversations.json/u);
  assert.throws(
    () => listConversations([...fixture(), ...fixture()]),
    /duplicate conversation IDs/u,
  );
  assert.throws(() => importConversation(fixture(), 'absent'), /not found/u);
});

test('native model boundary rejects bad URLs, path names, duplicate IDs and unsupported schemas', () => {
  const model = demoConversation();
  assert.throws(() => validateConversation({ ...model, schemaVersion: 2 }), /schemaVersion/u);
  assert.throws(
    () => validateConversation({ ...model, turns: [model.turns[0], model.turns[0]] }),
    /Duplicate turn/u,
  );
  assert.throws(
    () =>
      validateConversation({ ...model, source: { ...model.source, url: 'javascript:alert(1)' } }),
    /HTTP/u,
  );
  assert.throws(
    () =>
      validateConversation({
        ...model,
        attachments: [
          { id: 'file', name: '../escape', sourceLocator: 'test', status: 'download-needed' },
        ],
      }),
    /plain filenames/u,
  );
  assert.throws(
    () =>
      validateConversation({
        ...model,
        attachments: [
          { id: 'file', name: 'report.pdf', sourceLocator: 'test', status: 'available' },
        ],
      }),
    /SHA-256/u,
  );
  for (const url of [
    'file:///tmp/a',
    'javascript:alert(1)',
    'https://user:secret@example.com/',
    '//example.com/',
    'https://example.com/\n',
  ])
    assert.equal(safeUrl(url), null);
});

test('attachment references retain prior hash provenance and chosen filename without claiming bytes are present', () => {
  const model = demoConversation();
  const attachment = {
    id: 'report',
    name: 'source-report.pdf',
    localName: 'report (1).pdf',
    sourceLocator: 'synthetic:attachment',
    status: 'download-needed',
    sha256: 'a'.repeat(64),
  };
  const validated = validateConversation({ ...model, attachments: [attachment] });
  assert.equal(validated.attachments[0].sha256, attachment.sha256);
  assert.equal(validated.attachments[0].localName, 'report (1).pdf');
  assert.equal(validated.attachments[0].name, 'source-report.pdf');
  assert.equal(validated.attachments[0].localFileId, undefined);
  assert.equal(validated.verification.status, 'partial');
  assert.equal(
    validateConversation({
      ...model,
      attachments: [{ ...attachment, status: 'available', localFileId: 'selected-file-1' }],
    }).attachments[0].localName,
    'report (1).pdf',
  );
  assert.throws(
    () =>
      validateConversation({ ...model, attachments: [{ ...attachment, sha256: 'not-a-digest' }] }),
    /SHA-256/u,
  );
  for (const localName of ['../escape.pdf', '..', 'folder\\file.pdf', 'line\nbreak.pdf']) {
    assert.throws(
      () => validateConversation({ ...model, attachments: [{ ...attachment, localName }] }),
      /plain filenames/u,
    );
  }
});

test('claimed completeness is downgraded for DOM, missing files and incomplete fidelity', () => {
  const model = demoConversation();
  assert.equal(
    validateConversation({ ...model, source: { ...model.source, type: 'dom-snapshot' } })
      .verification.status,
    'unverified',
  );
  assert.equal(
    validateConversation({ ...model, turns: [{ ...model.turns[0], contentFidelity: 'partial' }] })
      .verification.status,
    'partial',
  );
  assert.equal(
    validateConversation({
      ...model,
      attachments: [
        { id: 'pending', name: 'file.txt', sourceLocator: 'test', status: 'download-needed' },
      ],
    }).verification.status,
    'partial',
  );
});

test('DOM capture evidence is retained, bounded and consistent with observed turns', () => {
  const model = demoConversation();
  model.source.type = 'dom-snapshot';
  model.source.capture = {
    capturedAt: '2026-10-12T09:00:00.000Z',
    observedTurns: 4,
    observedIndices: [2, 3, 5, 6],
    reportedTotal: 7,
    hiddenTurns: 1,
    streaming: true,
    branchControls: true,
    truncated: false,
  };
  const validated = validateConversation(model);
  assert.deepEqual(validated.source.capture, model.source.capture);
  assert.equal(validated.verification.status, 'unverified');
  for (const badEvidence of [
    { observedTurns: 3 },
    { observedIndices: [0, 1, 2, 3, 4] },
    { observedIndices: [-1] },
    { reportedTotal: 1000001 },
    { hiddenTurns: -1 },
    { streaming: 'yes' },
    { capturedAt: '2026-02-30T09:00:00.000Z' },
  ])
    assert.throws(() =>
      validateConversation({
        ...model,
        source: { ...model.source, capture: { ...model.source.capture, ...badEvidence } },
      }),
    );
  assert.throws(
    () => validateConversation({ ...model, source: { ...model.source, type: 'synthetic' } }),
    /requires a DOM snapshot/u,
  );
});

test('text bounds use bytes and reject oversized input', () => {
  const model = demoConversation();
  const big = '界'.repeat(Math.ceil(LIMITS.maxTextBytes / 3));
  assert.throws(
    () => validateConversation({ ...model, turns: [{ ...model.turns[0], markdown: big }] }),
    /8 MiB/u,
  );
  assert.throws(
    () =>
      validateConversation({
        ...model,
        turns: Array.from({ length: LIMITS.maxTurns + 1 }, (_, i) => ({
          ...model.turns[0],
          id: String(i),
        })),
      }),
    /at most 5000/u,
  );
});

test('collection evidence and structural DOM identity retain bounded provenance', () => {
  const model = demoConversation();
  model.source.type = 'dom-snapshot';
  model.turns.forEach((turn, index) => {
    turn.sourceMessageId = turn.id;
    turn.renderedIndex = index;
  });
  model.source.collection = {
    startedAt: '2026-10-12T09:00:00.000Z',
    finishedAt: '2026-10-12T09:00:01.000Z',
    durationMs: 1000,
    steps: 4,
    snapshots: 4,
    orderedTurns: model.turns.length,
    startObserved: true,
    endObserved: false,
    restoredScroll: true,
    indicesAvailable: true,
    gaps: [],
    stoppedReason: 'step-limit',
  };
  const result = validateConversation(model);
  assert.deepEqual(result.source.collection, model.source.collection);
  assert.equal(result.turns[0].sourceMessageId, model.turns[0].id);
  assert.equal(result.turns[3].renderedIndex, 3);
  assert.equal(result.verification.status, 'unverified');
  for (const invalid of [
    { orderedTurns: 1 },
    { steps: 201 },
    { durationMs: 120001 },
    { gaps: [{ from: 3, to: 2 }] },
    { stoppedReason: 'complete' },
    { endObserved: 'yes' },
  ]) {
    assert.throws(() =>
      validateConversation({
        ...model,
        source: { ...model.source, collection: { ...model.source.collection, ...invalid } },
      }),
    );
  }
  for (const invalid of [{ renderedIndex: -1 }, { sourceMessageId: '\u0000invalid' }]) {
    assert.throws(() =>
      validateConversation({
        ...model,
        turns: [{ ...model.turns[0], ...invalid }, ...model.turns.slice(1)],
      }),
    );
  }
});

test('plaintext projection preserves raw HTML and fenced code verbatim', () => {
  const model = demoConversation();
  model.turns = [
    {
      ...model.turns[0],
      markdown:
        '<script>alert(1)</script>\n\n```html\n<button>Example</button>\n```\n\nInline `<em>literal</em>`.',
    },
  ];
  const projection = projectMarkdown(model);
  assert.ok(projection.includes('<script>alert(1)</script>'));
  assert.ok(projection.includes('```html\n<button>Example</button>\n```'));
  assert.ok(projection.includes('Inline `<em>literal</em>`.'));
  assert.ok(projection.includes('<!-- source: synthetic:demo/1 -->'));
  assert.ok(projection.includes('verification: verified'));
});

test('plaintext projection preserves unfinished source fences without inventing source content', () => {
  const model = demoConversation();
  model.turns[0].markdown = '`unfinished <img src=x onerror=alert(1)>\n\n```js\nconst x = 1;';
  const projection = projectMarkdown(model);
  assert.ok(projection.includes(model.turns[0].markdown));
  assert.ok(projection.includes('const x = 1;\n\n## Turn 2 — Assistant'));
});

test('escaped inline markers and invalid fence info survive plaintext projection', () => {
  const model = demoConversation();
  model.turns[0].markdown = '\\`<img src=x>\\`\n\n```invalid`info\n<script>alert(1)</script>';
  const projection = projectMarkdown(model);
  assert.ok(projection.includes('<img src=x>'));
  assert.ok(projection.includes('<script>alert(1)</script>'));
});

test('Markdown link destinations, autolinks, blockquotes and literal entities retain exact semantics', () => {
  const model = demoConversation();
  const source =
    '[Source](<https://example.com/a?x=1&y=2>)\n\n<https://example.net/page>\n\n> A quotation\n> second line\n\nLiteral &lt;entity&gt; and 2 < 3.';
  model.turns[0].markdown = source;
  const output = projectMarkdown(model);
  assert.ok(output.includes(source));
  assert.ok(!output.includes(']( &lt;'));
  assert.ok(!output.includes('](&lt;'));
  assert.ok(!output.includes('&gt; A quotation'));
});

test('hand-off format: turns in order, original Markdown untouched, references and files under their turn', () => {
  const model = demoConversation();
  const projection = projectMarkdown(model);
  const headings = [...projection.matchAll(/^## Turn (\d+) — (User|Assistant)$/gmu)];
  assert.deepEqual(
    headings.map((match) => [Number(match[1]), match[2]]),
    model.turns.map((turn, index) => [index + 1, turn.role === 'user' ? 'User' : 'Assistant']),
  );
  for (const turn of model.turns)
    if (!turn.code) assert.ok(projection.includes(`\n\n${turn.markdown}`));
  assert.ok(!projection.includes('Source locator:'));
});
