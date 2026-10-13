import test from 'node:test';
import assert from 'node:assert/strict';
import {
  importBrowserResponse,
  isSelectedResponse,
  originalSource,
} from '../src/chatgpt-response.js';
import { projectMarkdown, validateConversation } from '../src/model.js';

const pageUrl = 'https://chatgpt.com/c/synthetic-original';
const evidence = {
  pageUrl,
  responseUrl: 'https://chatgpt.com/backend-api/conversation/synthetic-original',
  capturedAt: '2026-10-12T14:00:00.000Z',
};
function fixture() {
  const node = (id, parent, role, text) => ({
    id,
    parent,
    message: {
      author: { role },
      status: 'finished_successfully',
      content: { content_type: 'text', parts: [text] },
    },
  });
  return {
    conversation_id: 'synthetic-original',
    title: 'Original Markdown test',
    current_node: 'a',
    mapping: {
      alternate: node('alternate', 'u', 'assistant', 'Do not merge this variant.'),
      a: node(
        'a',
        'u',
        'assistant',
        '  **Exact** 中文 ✓\n\n```mermaid\ngraph LR; A-->B\n```\n\n$E=mc^2$\n',
      ),
      u: node(
        'u',
        'root',
        'user',
        'Keep <https://example.com/> and [a](<https://example.com/a>)\n',
      ),
      root: { id: 'root', parent: null, message: null },
    },
  };
}
const read = (value = fixture(), options = evidence) =>
  importBrowserResponse(JSON.stringify(value), options);

test('original response preserves exact Markdown, parent order and selected variant', () => {
  const raw = fixture();
  const model = read(raw);
  assert.equal(model.source.type, 'chatgpt-response');
  assert.deepEqual(model.source.response, {
    url: evidence.responseUrl,
    capturedAt: evidence.capturedAt,
    observedNodes: 4,
  });
  assert.deepEqual(
    model.turns.map((turn) => turn.id),
    ['u', 'a'],
  );
  assert.equal(model.turns[1].markdown, raw.mapping.a.message.content.parts[0]);
  assert.equal(model.turns[1].sourceLocator, 'response.mapping["a"].message');
  assert.equal(model.verification.status, 'verified');
  const text = projectMarkdown(model);
  assert.ok(text.includes(raw.mapping.a.message.content.parts[0]));
  assert.ok(!text.includes('Do not merge this variant.'));
  assert.deepEqual(validateConversation(JSON.parse(JSON.stringify(model))), model);
});

test('source identity accepts GPT conversations but rejects other hosts and previews', () => {
  assert.equal(
    originalSource('https://chatgpt.com/g/g-example/c/synthetic-original?model=test').id,
    'synthetic-original',
  );
  for (const url of [
    'http://chatgpt.com/c/a',
    'https://chatgpt.com.evil.test/c/a',
    'https://chatgpt.com:444/c/a',
    'https://u@chatgpt.com/c/a',
    'https://chatgpt.com/share/a',
  ])
    assert.throws(() => originalSource(url), /conversation|shared/u);
  for (const response of [
    'https://chatgpt.com/backend-api/conversations',
    'https://chatgpt.com/backend-api/conversation/other',
    `${evidence.responseUrl}?cursor=2`,
    'https://chat.openai.com/backend-api/conversation/synthetic-original',
  ])
    assert.equal(isSelectedResponse(response, pageUrl), false, response);
  assert.equal(isSelectedResponse(evidence.responseUrl, pageUrl), true);
});

test('wrong response, mismatched IDs and absent current branch are rejected', () => {
  assert.throws(
    () => read(fixture(), { ...evidence, responseUrl: evidence.responseUrl + '/other' }),
    /does not belong/u,
  );
  assert.throws(() => read({ ...fixture(), conversation_id: 'other' }), /ID/u);
  assert.throws(() => read({ ...fixture(), id: 'other' }), /ID/u);
  assert.throws(() => read({ ...fixture(), current_node: undefined }), /selected branch/u);
  assert.throws(() => importBrowserResponse('<html>Sign in</html>', evidence), /JSON response/u);
  assert.throws(() => read({ conversation: fixture() }), /ID/u);
});

test('citations and file references retain provenance without claiming downloaded bytes', () => {
  const raw = fixture();
  raw.mapping.a.message.metadata = {
    citations: [{ url: 'https://example.com/source', title: 'Synthetic source' }],
    attachments: [
      { id: 'file-1', name: 'notes.txt', download_url: 'https://chatgpt.com/files/notes.txt' },
    ],
  };
  const model = read(raw);
  assert.equal(model.turns[1].citations[0].url, 'https://example.com/source');
  assert.match(model.turns[1].citations[0].sourceLocator, /^response\.mapping/u);
  assert.equal(model.attachments[0].status, 'download-needed');
  assert.match(model.attachments[0].sourceLocator, /^response\.mapping/u);
  assert.equal(model.verification.status, 'partial');
});

test('missing graph nodes, streaming and pagination remain visibly incomplete', () => {
  const missing = fixture();
  delete missing.mapping.u;
  assert.equal(read(missing).verification.status, 'partial');
  const streaming = fixture();
  streaming.mapping.a.message.status = 'in_progress';
  assert.equal(read(streaming).verification.status, 'partial');
  for (const flag of [{ has_more: true }, { is_truncated: true }, { next_cursor: 'next' }]) {
    const model = read({ ...fixture(), ...flag });
    assert.equal(model.verification.status, 'partial');
    assert.ok(model.verification.issues.some((issue) => issue.code === 'response-incomplete'));
  }
});

test('serialized browser evidence cannot silently change source identity or lose its timestamp', () => {
  for (const mutate of [
    (model) => {
      model.source.id = 'other';
    },
    (model) => {
      delete model.source.response;
    },
    (model) => {
      model.source.response.capturedAt = 'not a date';
    },
    (model) => {
      model.source.response.observedNodes = 0;
    },
    (model) => {
      model.source.response.url = 'https://example.com/';
    },
  ]) {
    const model = read();
    mutate(model);
    assert.throws(() => validateConversation(model), /response|Response/u);
  }
});
