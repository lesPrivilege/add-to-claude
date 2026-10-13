import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatGPTSocketTurn } from '../src/chatgpt-socket.js';
const topic = 'conversation-turn-exchange-1';
const message = {
  id: 'a1',
  author: { role: 'assistant' },
  status: 'finished_successfully',
  end_turn: true,
  content: { content_type: 'text', parts: ['Original **中文** ✓\n'] },
};
const item = (encoded) => ({
  type: 'message',
  topic_id: topic,
  payload: {
    type: 'conversation-turn-stream',
    turn_id: 'exchange-1',
    payload: { type: 'stream-item', conversation_id: 'chat', encoded_item: encoded },
  },
});
const full = () => item(`data: ${JSON.stringify({ conversation_id: 'chat', message })}\n\n`);
const done = () => item('data: [DONE]\n\n');
const reader = (options = {}) =>
  createChatGPTSocketTurn({ conversationId: 'chat', topic, ...options });

test('selected handoff topic preserves exact text without overstating completeness', () => {
  const stream = reader();
  assert.equal(stream.accept(JSON.stringify([full(), done()])), true);
  assert.equal(stream.result().messages[0].content.parts[0], 'Original **中文** ✓\n');
  assert.equal(stream.result().socketTerminalObserved, true);
  assert.equal(stream.result().complete, false);
});
test('catchups and subsequent live deltas retain source order', () => {
  const stream = reader();
  const initial = full();
  const value = {
    conversation_id: 'chat',
    message: {
      ...message,
      content: { content_type: 'text', parts: ['First'] },
      status: 'in_progress',
      end_turn: false,
    },
  };
  initial.payload.payload.encoded_item = `event: delta\ndata: ${JSON.stringify({ p: '', o: 'add', v: value })}`;
  stream.accept(JSON.stringify({ type: 'reply', reply: { topic_id: topic, catchups: [initial] } }));
  stream.accept(
    JSON.stringify(
      item(
        `data: ${JSON.stringify({ p: '/message/content/parts/0', o: 'append', v: ' and last.' })}`,
      ),
    ),
  );
  assert.equal(stream.result().messages[0].content.parts[0], 'First and last.');
});
test('other topics and control credentials are not retained', () => {
  const stream = reader();
  assert.equal(
    stream.accept(JSON.stringify({ ...full(), topic_id: 'conversation-turn-other' })),
    false,
  );
  assert.equal(
    stream.accept(
      JSON.stringify({
        type: 'reply',
        reply: { topic_id: 'unrelated', token: 'SYNTHETIC_SECRET' },
      }),
    ),
    false,
  );
  assert.deepEqual(stream.result().messages, []);
  assert.equal(JSON.stringify(stream.result()).includes('SYNTHETIC_SECRET'), false);
});
test('identity changes, replay, malformed selected payload and extra data after DONE reject', () => {
  for (const changed of [
    { ...full(), type: 'unsupported' },
    { ...full(), payload: { payload: { encoded_item: 'data: {broken}' } } },
    { ...full(), payload: { ...full().payload, conversation_id: 'other' } },
  ])
    assert.throws(() => reader().accept(JSON.stringify(changed)));
  const stream = reader();
  stream.accept(JSON.stringify(full()));
  assert.throws(() =>
    stream.accept(
      JSON.stringify({ type: 'reply', reply: { topic_id: topic, catchups: [full()] } }),
    ),
  );
  const ended = reader();
  ended.accept(JSON.stringify([full(), done()]));
  assert.throws(() => ended.accept(JSON.stringify(full())));
});
test('socket frame and cumulative selected data remain bounded', () => {
  assert.throws(() => reader({ maxBytes: 5 }).accept(JSON.stringify(full())));
  assert.throws(() => reader().accept(JSON.stringify(Array.from({ length: 1001 }, () => ({})))));
});

test('nested and outer turn identities cannot change or contradict one another', () => {
  const stream = reader();
  const first = full();
  delete first.payload.turn_id;
  first.payload.payload.turn_id = 'turn-one';
  stream.accept(JSON.stringify(first));
  const changed = item('data: {"p":"/message/content/parts/0","o":"append","v":"foreign text"}');
  delete changed.payload.turn_id;
  changed.payload.payload.turn_id = 'turn-two';
  assert.throws(() => stream.accept(JSON.stringify(changed)));
  const conflicting = full();
  conflicting.payload.payload.turn_id = 'different-from-outer';
  assert.throws(() => reader().accept(JSON.stringify(conflicting)));
});
