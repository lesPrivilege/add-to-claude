import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeConversationStream } from '../src/stream-conversation.js';
import { importConversation } from '../src/import.js';
import { importBrowserResponse } from '../src/chatgpt-response.js';
import { validateConversation } from '../src/model.js';

const message = (id, role, text) => ({
  id,
  author: { role },
  status: 'finished_successfully',
  end_turn: true,
  content: { content_type: 'text', parts: [text] },
});
const request = () => ({
  action: 'next',
  conversation_id: null,
  parent_message_id: 'root',
  messages: [message('u1', 'user', 'Original user **Markdown**.')],
});
const reply = () => ({
  conversationId: 'stream-chat',
  messages: [message('a1', 'assistant', 'Original answer.\n')],
  complete: true,
});

test('a new observed exchange preserves request and response text with explicit source coverage', () => {
  const result = mergeConversationStream(null, request(), reply());
  assert.equal(result.coverage, 'new-conversation');
  assert.deepEqual(result.requestMessageIds, ['u1']);
  const model = importConversation(result.conversation, 'stream-chat');
  assert.deepEqual(
    model.turns.map((turn) => turn.id),
    ['u1', 'a1'],
  );
  assert.equal(model.turns[0].markdown, request().messages[0].content.parts[0]);
  assert.equal(model.turns[1].markdown, reply().messages[0].content.parts[0]);
});

test('ongoing exchanges preserve earlier turns and update declared child links', () => {
  const first = mergeConversationStream(null, request(), reply());
  const next = mergeConversationStream(
    first,
    {
      ...request(),
      conversation_id: 'stream-chat',
      parent_message_id: 'a1',
      messages: [message('u2', 'user', 'Next turn.')],
    },
    { ...reply(), messages: [message('a2', 'assistant', 'Next answer.')] },
  );
  const model = importConversation(next.conversation, 'stream-chat');
  assert.deepEqual(
    model.turns.map((turn) => turn.id),
    ['u1', 'a1', 'u2', 'a2'],
  );
  assert.equal(model.verification.status, 'verified');
  assert.equal(first.conversation.current_node, 'a1');
  assert.equal(first.conversation.mapping.u2, undefined);
});

test('a regeneration retains the old variant without merging it into the selected branch', () => {
  const first = mergeConversationStream(null, request(), reply());
  const next = mergeConversationStream(
    first,
    { action: 'variant', conversation_id: 'stream-chat', parent_message_id: 'u1', messages: [] },
    { ...reply(), messages: [message('alternative', 'assistant', 'Another answer.')] },
  );
  const model = importConversation(next.conversation, 'stream-chat');
  assert.deepEqual(
    model.turns.map((turn) => turn.id),
    ['u1', 'alternative'],
  );
  assert.equal(model.branches.availableLeaves.length, 2);
  assert.equal(next.conversation.mapping.a1.message.content.parts[0], 'Original answer.\n');
});

test('continuation replaces the same unfinished message without duplicating its text', () => {
  const partial = reply();
  partial.complete = false;
  partial.messages[0].status = 'in_progress';
  const first = mergeConversationStream(null, request(), partial);
  const next = mergeConversationStream(
    first,
    { action: 'continue', conversation_id: 'stream-chat', parent_message_id: 'a1', messages: [] },
    { ...reply(), messages: [message('a1', 'assistant', 'Complete answer.')] },
  );
  assert.deepEqual(
    importConversation(next.conversation, 'stream-chat').turns.map((turn) => turn.id),
    ['u1', 'a1'],
  );
  assert.equal(next.conversation.mapping.a1.message.content.parts[0], 'Complete answer.');
});

test('an existing conversation without an observed base never receives full-history coverage', () => {
  const result = mergeConversationStream(
    null,
    { ...request(), conversation_id: 'stream-chat' },
    reply(),
  );
  assert.equal(result.coverage, 'partial-history');
  const model = importBrowserResponse(JSON.stringify(result), {
    pageUrl: 'https://chatgpt.com/c/stream-chat',
    responseUrl: 'https://chatgpt.com/backend-api/f/conversation',
    method: 'POST',
    capturedAt: '2026-10-13T05:00:00.000Z',
  });
  assert.equal(model.verification.status, 'partial');
  model.verification = { status: 'verified', issues: [] };
  assert.equal(validateConversation(model).verification.status, 'partial');
});

test('stream projection identifies its real POST provenance rather than inventing a GET response', () => {
  const result = mergeConversationStream(null, request(), reply());
  const model = importBrowserResponse(JSON.stringify(result), {
    pageUrl: 'https://chatgpt.com/c/stream-chat',
    responseUrl: 'https://chatgpt.com/backend-api/f/conversation',
    method: 'POST',
    capturedAt: '2026-10-13T05:00:00.000Z',
  });
  assert.equal(model.verification.status, 'verified');
  assert.equal(model.source.response.method, 'POST');
  assert.deepEqual(model.source.response.requestMessageIds, ['u1']);
  assert.equal(model.source.response.coverage, 'new-conversation');
  assert.match(model.turns[0].sourceLocators[0], /^observed-stream\.conversation/u);
});

test('wrong conversation, absent parents, conflicting IDs and response replays cannot overwrite saved history', () => {
  const first = mergeConversationStream(null, request(), reply());
  const saved = JSON.stringify(first);
  for (const [input, output] of [
    [{ ...request(), conversation_id: 'another' }, reply()],
    [{ ...request(), parent_message_id: 'unknown' }, reply()],
    [{ ...request(), messages: [message('u1', 'user', 'Conflicting draft')] }, reply()],
    [{ ...request(), parent_message_id: 'a1', messages: [] }, reply()],
  ])
    assert.throws(() => mergeConversationStream(first, input, output));
  assert.equal(JSON.stringify(first), saved);
});

test('later successful answers retain unresolved uncertainty on the selected history', () => {
  const first = mergeConversationStream(null, request(), { ...reply(), complete: false });
  const next = mergeConversationStream(
    first,
    {
      action: 'next',
      conversation_id: 'stream-chat',
      parent_message_id: 'a1',
      messages: [message('u2', 'user', 'Next question.')],
    },
    { ...reply(), messages: [message('a2', 'assistant', 'Next answer.')] },
  );
  assert.equal(next.streamCompleted, false);
  const model = importBrowserResponse(JSON.stringify(next), {
    pageUrl: 'https://chatgpt.com/c/stream-chat',
    responseUrl: 'https://chatgpt.com/backend-api/f/conversation',
    method: 'POST',
    capturedAt: '2026-10-13T05:00:00.000Z',
  });
  assert.equal(model.verification.status, 'partial');
});

test('continuation can resolve its own uncertainty and regeneration can select a clean branch', () => {
  const first = mergeConversationStream(null, request(), { ...reply(), complete: false });
  const continued = mergeConversationStream(
    first,
    {
      action: 'continue',
      conversation_id: 'stream-chat',
      parent_message_id: 'a1',
      messages: [],
    },
    reply(),
  );
  assert.equal(continued.streamCompleted, true);
  const regenerated = mergeConversationStream(
    first,
    {
      action: 'variant',
      conversation_id: 'stream-chat',
      parent_message_id: 'u1',
      messages: [],
    },
    { ...reply(), messages: [message('alternative', 'assistant', 'New complete answer.')] },
  );
  assert.equal(regenerated.streamCompleted, true);
  const returnsToUncertainBranch = mergeConversationStream(
    regenerated,
    {
      action: 'next',
      conversation_id: 'stream-chat',
      parent_message_id: 'a1',
      messages: [message('u2', 'user', 'Return to earlier branch.')],
    },
    { ...reply(), messages: [message('a2', 'assistant', 'New reply.')] },
  );
  assert.equal(returnsToUncertainBranch.streamCompleted, false);
});

test('a trailing internal node cannot hide uncertainty in a visible answer', () => {
  const internal = { ...message('internal', 'assistant', 'Synthetic hidden routing.'), weight: 0 };
  const first = mergeConversationStream(null, request(), {
    ...reply(),
    complete: false,
    messages: [...reply().messages, internal],
  });
  const next = mergeConversationStream(
    first,
    {
      action: 'next',
      conversation_id: 'stream-chat',
      parent_message_id: 'a1',
      messages: [message('u2', 'user', 'Continue from the visible answer.')],
    },
    { ...reply(), messages: [message('a2', 'assistant', 'Successful next answer.')] },
  );
  assert.equal(next.streamCompleted, false);
});

test('socket replay provenance cannot be upgraded by terminal flags or serialized verification claims', () => {
  const observed = mergeConversationStream(null, request(), reply());
  observed.socket = {
    origin: 'wss://ws.chatgpt.com',
    topic: 'conversation-turn-topic',
    coverage: 'unverified-replay',
    terminalObserved: true,
  };
  const evidence = {
    pageUrl: 'https://chatgpt.com/c/stream-chat',
    responseUrl: 'https://chatgpt.com/backend-api/f/conversation',
    method: 'POST',
    capturedAt: '2026-10-13T05:00:00.000Z',
  };
  const model = importBrowserResponse(JSON.stringify(observed), evidence);
  assert.equal(model.verification.status, 'partial');
  model.verification = { status: 'verified', issues: [] };
  assert.equal(validateConversation(model).verification.status, 'partial');
  observed.socket.origin = 'wss://elsewhere.example';
  assert.throws(() => importBrowserResponse(JSON.stringify(observed), evidence));
});
