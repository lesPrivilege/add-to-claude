import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../../src/compile.js';
import {
  MAX_MARKDOWN_BYTES,
  addReply,
  addRequest,
  fitsComposer,
  helperState,
  pinRequest,
  readyFrom,
} from '../shared/protocol.js';
import { chartsBody, packet, plainBody } from './fixtures.js';

const ready = (body, id, extra = {}) => ({
  kind: 'ready',
  page: `https://chatgpt.com/c/${id}`,
  ...compile(packet(body, id)),
  ...extra,
});

test('a ready packet for the page on screen is accepted with exactly the compiled text', () => {
  const body = ready(plainBody, 'one');
  const prepared = readyFrom(body, 'https://chatgpt.com/c/one?x=1');
  assert.equal(prepared.markdown, body.markdown);
  assert.equal(prepared.title, 'Synthetic chat');
  assert.equal(prepared.turns, 2);
  assert.equal(prepared.verification, 'verified');
  assert.deepEqual(prepared.attachments, []);
});

test('the chat root accepts the conversation it is about to become', () => {
  assert.ok(readyFrom(ready(plainBody, 'one'), 'https://chatgpt.com/'));
});

test('ready packets for another page, origin or an oversized text are refused', () => {
  assert.equal(readyFrom(ready(plainBody, 'one'), 'https://chatgpt.com/c/other'), null);
  assert.equal(
    readyFrom(
      ready(plainBody, 'one', { page: 'https://example.com/c/one' }),
      'https://chatgpt.com/c/one',
    ),
    null,
  );
  assert.equal(
    readyFrom(
      ready(plainBody, 'one', { markdown: 'x'.repeat(MAX_MARKDOWN_BYTES + 1) }),
      'https://chatgpt.com/c/one',
    ),
    null,
  );
  assert.equal(readyFrom({ kind: 'changed' }, 'https://chatgpt.com/c/one'), null);
  assert.equal(readyFrom(null, 'https://chatgpt.com/c/one'), null);
});

test('labels are cleaned and malformed attachments dropped', () => {
  const body = ready(chartsBody, 'two', {
    title: 'Evil\u0000‮ title',
    issues: ['a\nb', 7, 'c'],
    attachments: [
      ...compile(packet(chartsBody, 'two')).attachments,
      { key: 1, id: 'x', line: 2 },
      { key: 'k', id: 'x', line: 1.5 },
    ],
  });
  const prepared = readyFrom(body, 'https://chatgpt.com/c/two');
  assert.equal(prepared.title, 'Evil title');
  assert.deepEqual(prepared.issues, ['ab', 'c']);
  assert.equal(prepared.attachments.length, 2);
  assert.equal(prepared.verifiedWithFiles, true);
});

test('helper state is projected without anything the client should not get', () => {
  const state = helperState({
    type: 'state',
    visible: true,
    focused: true,
    pinned: 'yes',
    source: 'ready',
    conversation: {
      title: 'T\u0007',
      turns: 4,
      files: 2,
      saved: 1,
      verification: 'verified',
      issues: ['x'],
      markdown: 'secret',
    },
    message: 'm',
  });
  assert.deepEqual(state, {
    visible: true,
    focused: true,
    pinned: false,
    source: 'ready',
    conversation: {
      title: 'T',
      turns: 4,
      files: 2,
      saved: 1,
      verification: 'verified',
      verifiedWithFiles: false,
      issues: ['x'],
    },
    message: 'm',
  });
  assert.equal(helperState({ type: 'state', source: 'ready' }).source, 'waiting');
  assert.equal(helperState({ type: 'state', source: 'bogus' }).source, 'waiting');
  assert.equal(helperState({ type: 'reply' }), null);
});

test('Add replies are validated', () => {
  assert.deepEqual(addReply({ type: 'reply', id: 3, ok: true, markdown: '# T\n', note: 'n' }), {
    id: 3,
    ok: true,
    markdown: '# T\n',
    note: 'n',
  });
  assert.equal(addReply({ type: 'reply', id: '3', ok: true, markdown: '' }), null);
  assert.equal(addReply({ type: 'reply', id: 4, ok: true, markdown: 5 }).ok, false);
  assert.deepEqual(addReply({ type: 'reply', id: 5, ok: false, error: 'e' }), {
    id: 5,
    ok: false,
    error: 'e',
  });
});

test('request bodies are small JSON objects', () => {
  assert.deepEqual(addRequest('{"downloadFiles":false}'), { downloadFiles: false });
  assert.deepEqual(addRequest('{}'), { downloadFiles: true });
  assert.equal(addRequest('[]'), null);
  assert.equal(addRequest('nope'), null);
  assert.equal(addRequest(null), null);
  assert.equal(addRequest(`{"x":"${'a'.repeat(2000)}"}`), null);
  assert.deepEqual(pinRequest('{"on":true}'), { on: true });
  assert.equal(pinRequest('{"on":1}'), null);
});

test('the composer takes at most 2 MiB', () => {
  assert.equal(fitsComposer('x'.repeat(2 * 1024 * 1024)), true);
  assert.equal(fitsComposer('x'.repeat(2 * 1024 * 1024 + 1)), false);
  assert.equal(fitsComposer('中'.repeat(600_000)), true);
  assert.equal(fitsComposer('中'.repeat(600_000) + 'x'.repeat(400_000)), false);
});
