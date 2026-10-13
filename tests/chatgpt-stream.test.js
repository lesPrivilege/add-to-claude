import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatGPTStream } from '../src/chatgpt-stream.js';
import { createEventStreamDecoder } from '../src/event-stream.js';

const initial = () => ({
  conversation_id: 'chat-1',
  message: {
    id: 'assistant-1',
    author: { role: 'assistant' },
    recipient: 'all',
    content: { content_type: 'text', parts: [''] },
    status: 'in_progress',
    end_turn: false,
    metadata: {},
  },
});
const send = (stream, packet, event = 'delta') =>
  stream.accept({ event, data: JSON.stringify(packet) });
const finish = (stream) => {
  send(stream, {
    p: '',
    o: 'patch',
    v: [
      { p: '/message/status', o: 'replace', v: 'finished_successfully' },
      { p: '/message/end_turn', o: 'replace', v: true },
      { p: '/message/metadata', o: 'append', v: { finish_details: { type: 'stop' } } },
    ],
  });
  stream.accept({ event: 'message', data: '[DONE]' });
};

test('v1 explicit and implicit append deltas retain exact original Markdown', () => {
  const stream = createChatGPTStream({ expectedConversationId: 'chat-1' });
  send(stream, 'v1', 'delta_encoding');
  send(stream, { p: '', o: 'add', v: initial() });
  send(stream, { p: '/message/content/parts/0', o: 'append', v: ' **中文**' });
  send(stream, { v: ' ✓\n\n```js\nconst n = 1;\n```\n' });
  finish(stream);
  const result = stream.result();
  assert.equal(result.complete, true);
  assert.equal(result.messages[0].content.parts[0], ' **中文** ✓\n\n```js\nconst n = 1;\n```\n');
});

test('classic full-message updates replace earlier versions without duplicating the turn', () => {
  const stream = createChatGPTStream();
  const packet = initial();
  send(stream, packet, 'message');
  packet.message.content.parts = ['Final original text.'];
  packet.message.status = 'finished_successfully';
  packet.message.end_turn = true;
  send(stream, packet, 'message');
  stream.accept({ event: 'message', data: '[DONE]' });
  assert.equal(stream.result().messages.length, 1);
  assert.equal(stream.result().complete, true);
  assert.equal(stream.result().messages[0].content.parts[0], 'Final original text.');
});

test('citation metadata and multiple message identities survive patching', () => {
  const stream = createChatGPTStream();
  send(stream, { v: initial() });
  send(stream, {
    p: '/message/metadata',
    o: 'append',
    v: { content_references: [{ url: 'https://example.com/' }] },
  });
  const second = initial();
  second.message.id = 'assistant-2';
  send(stream, { p: '', o: 'add', v: second });
  finish(stream);
  assert.deepEqual(
    stream.result().messages.map((message) => message.id),
    ['assistant-1', 'assistant-2'],
  );
  assert.equal(
    stream.result().messages[0].metadata.content_references[0].url,
    'https://example.com/',
  );
});

test('transport end, stream handoff, interruption and length limits cannot claim a complete answer', () => {
  for (const mode of ['in-progress', 'handoff', 'interrupted', 'max_tokens']) {
    const stream = createChatGPTStream();
    const packet = initial();
    if (mode !== 'in-progress') {
      packet.message.status = 'finished_successfully';
      packet.message.end_turn = true;
    }
    if (['interrupted', 'max_tokens'].includes(mode))
      packet.message.metadata.finish_details = { type: mode };
    send(stream, { v: packet });
    if (mode === 'handoff') send(stream, { type: 'stream_handoff', conversation_id: 'chat-1' });
    stream.accept({ event: 'message', data: '[DONE]' });
    assert.equal(stream.result().complete, false, mode);
  }
});

test('resume credentials and unrelated control fields are never retained in stream results', () => {
  const stream = createChatGPTStream();
  send(stream, {
    type: 'resume_conversation_token',
    conversation_id: 'chat-1',
    token: 'SYNTHETIC_SECRET_DO_NOT_RETAIN',
  });
  send(stream, { v: { ...initial(), token: 'SYNTHETIC_SECRET_DO_NOT_RETAIN' } });
  finish(stream);
  assert.equal(JSON.stringify(stream.result()).includes('SYNTHETIC_SECRET'), false);
});

test('unknown protocols, unsafe pointers, missing targets and changed identity fail closed', () => {
  for (const packet of [
    { p: '/message/__proto__/polluted', o: 'add', v: true },
    { p: '/message/missing/0', o: 'append', v: 'text' },
    { p: '/message/content/parts/0', o: 'unknown', v: 'text' },
    { p: '/conversation_id', o: 'replace', v: 'another' },
  ]) {
    const stream = createChatGPTStream({ expectedConversationId: 'chat-1' });
    send(stream, { v: initial() });
    assert.throws(() => send(stream, packet));
  }
  assert.throws(() => send(createChatGPTStream(), 'v2', 'delta_encoding'), /encoding/u);
  assert.equal({}.polluted, undefined);
});

test('wire decoder and message reducer handle split-byte stream completion together', () => {
  const stream = createChatGPTStream();
  const reader = createEventStreamDecoder({ onEvent: (event) => stream.accept(event) });
  const packet = initial();
  packet.message.content.parts = ['保留原文 ✓'];
  packet.message.status = 'finished_successfully';
  packet.message.end_turn = true;
  const bytes = new TextEncoder().encode(
    `data: ${JSON.stringify(packet)}\r\n\r\ndata: [DONE]\r\n\r\n`,
  );
  for (const value of bytes) reader.push(Uint8Array.of(value));
  reader.finish();
  assert.equal(stream.result().complete, true);
  assert.equal(stream.result().messages[0].content.parts[0], '保留原文 ✓');
});

test('internal zero-weight replies cannot establish a complete answer', () => {
  const stream = createChatGPTStream();
  const packet = initial();
  packet.message.weight = 0;
  send(stream, packet);
  finish(stream);
  assert.equal(stream.result().complete, false);
});

test('root envelopes validate explicit operations and paths', () => {
  for (const fields of [
    { p: '', o: 'remove' },
    { p: '', o: 'unknown' },
    { p: null, o: 'add' },
    { p: '', o: null },
  ]) {
    assert.throws(() => send(createChatGPTStream(), { ...fields, v: initial() }));
  }
});
