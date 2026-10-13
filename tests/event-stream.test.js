import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventStreamDecoder } from '../src/event-stream.js';

const bytes = (value) => new TextEncoder().encode(value);
test('SSE survives arbitrary UTF-8 and CRLF boundaries without changing Markdown', () => {
  const events = [];
  const reader = createEventStreamDecoder({ onEvent: (event) => events.push(event) });
  const wire = bytes(
    '\ufeff: comment\r\nid: ignored\r\nevent: delta\r\ndata: **中文** ✓\r\ndata: second line\r\n\r\ndata: [DONE]\n\n',
  );
  for (const byte of wire) reader.push(Uint8Array.of(byte));
  reader.finish();
  assert.deepEqual(events, [
    { event: 'delta', data: '**中文** ✓\nsecond line' },
    { event: 'message', data: '[DONE]' },
  ]);
});

test('SSE preserves empty data, significant leading spaces and multiple events per chunk', () => {
  const events = [];
  const reader = createEventStreamDecoder({ onEvent: (event) => events.push(event) });
  reader.push(bytes('data:\ndata:  indented\n\nevent:\ndata: final\r\r'));
  reader.finish();
  assert.deepEqual(events, [
    { event: 'message', data: '\n indented' },
    { event: 'message', data: 'final' },
  ]);
});

test('oversized, invalid UTF-8 and truncated events fail visibly', () => {
  const oversized = createEventStreamDecoder({ onEvent() {}, maxEventBytes: 16 });
  assert.throws(() => oversized.push(bytes('data: ' + '界'.repeat(10))), /size/u);
  const invalid = createEventStreamDecoder({ onEvent() {} });
  assert.throws(() => invalid.push(Uint8Array.of(0xff)), /encoded data/u);
  const truncated = createEventStreamDecoder({ onEvent() {} });
  truncated.push(bytes('data: incomplete\n'));
  assert.throws(() => truncated.finish(), /incomplete event/u);
});

test('large streams are bounded per event rather than accumulating all previous events', () => {
  let count = 0;
  const reader = createEventStreamDecoder({
    onEvent() {
      count++;
    },
    maxEventBytes: 32,
  });
  for (let index = 0; index < 10000; index++) reader.push(bytes(`data: ${index}\n\n`));
  reader.finish();
  assert.equal(count, 10000);
});
