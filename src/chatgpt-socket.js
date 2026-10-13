import { createEventStreamDecoder } from './event-stream.js';
import { createChatGPTStream } from './chatgpt-stream.js';

/** Decode only the turn topic explicitly named by the selected POST's handoff. No socket/network access. */
export function createChatGPTSocketTurn({ conversationId, topic, maxBytes = 64 * 1024 * 1024 }) {
  const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/u.test(value);
  if (
    !identifier(conversationId) ||
    typeof topic !== 'string' ||
    !/^conversation-turn-[A-Za-z0-9_-]{1,200}$/u.test(topic)
  )
    throw new TypeError('The handoff has no supported conversation/topic identity.');
  const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const encoder = new TextEncoder();
  const stream = createChatGPTStream({ expectedConversationId: conversationId });
  let total = 0,
    ended = false,
    catchup = false,
    live = false,
    boundTurnId = null;
  const acceptItem = (item) => {
    if (!record(item)) throw new Error('Unsupported selected-topic message.');
    if (item.topic_id !== undefined && item.topic_id !== topic)
      throw new Error('A catchup changed the selected topic.');
    const outer = item.payload;
    const payload = outer?.payload;
    if (
      !record(outer) ||
      !record(payload) ||
      typeof payload.encoded_item !== 'string' ||
      (outer.type !== undefined && outer.type !== 'conversation-turn-stream') ||
      (payload.type !== undefined && payload.type !== 'stream-item')
    )
      throw new Error('Unsupported selected-topic payload.');
    if (
      (outer.conversation_id !== undefined && outer.conversation_id !== conversationId) ||
      (payload.conversation_id !== undefined && payload.conversation_id !== conversationId)
    )
      throw new Error('The socket message changed source identity.');
    for (const turn of [outer.turn_id, payload.turn_id]) {
      if (turn === undefined) continue;
      if (!identifier(turn) || (boundTurnId && boundTurnId !== turn))
        throw new Error('The socket message changed turn identity.');
      boundTurnId = turn;
    }
    if (ended) throw new Error('A selected-topic message arrived after completion.');
    // encoded_item is a complete SSE item in the public examples, not an arbitrary text chunk.
    const decoder = createEventStreamDecoder({
      onEvent(event) {
        stream.accept(event);
        if (event.data === '[DONE]') ended = true;
      },
    });
    decoder.push(encoder.encode(payload.encoded_item + '\n\n'));
    decoder.finish();
  };
  return {
    accept(text) {
      if (
        typeof text !== 'string' ||
        text.length > Math.min(maxBytes, 8 * 1024 * 1024) ||
        encoder.encode(text).byteLength > Math.min(maxBytes, 8 * 1024 * 1024)
      )
        throw new RangeError('Unsupported or oversized socket frame.');
      const value = JSON.parse(text);
      const frames = Array.isArray(value) ? value : [value];
      if (frames.length > 1000) throw new RangeError('Too many socket messages.');
      let selected = false;
      for (const frame of frames) {
        if (!record(frame)) continue;
        if (frame.type === 'reply' && frame.reply?.topic_id === topic) {
          if (
            catchup ||
            live ||
            !Array.isArray(frame.reply.catchups) ||
            frame.reply.catchups.length > 20000
          )
            throw new Error('The selected stream was replayed or its catchup is unsupported.');
          catchup = true;
          selected = true;
          const bytes = encoder.encode(JSON.stringify(frame.reply.catchups)).byteLength;
          total += bytes;
          if (total > maxBytes)
            throw new RangeError('The selected socket stream exceeds its byte limit.');
          for (const item of frame.reply.catchups) acceptItem(item);
        } else if (frame.topic_id === topic) {
          if (frame.type !== 'message') throw new Error('Unsupported selected-topic event.');
          live = true;
          selected = true;
          total += encoder.encode(JSON.stringify(frame.payload)).byteLength;
          if (total > maxBytes)
            throw new RangeError('The selected socket stream exceeds its byte limit.');
          acceptItem(frame);
        }
      }
      return selected;
    },
    get ended() {
      return ended;
    },
    result() {
      const reply = stream.result();
      // Received text and terminal flags alone do not establish topic replay/gap semantics.
      // Retain exact text for review, but require a later authoritative response for verification.
      return {
        ...reply,
        complete: false,
        socketTerminalObserved: reply.complete,
        socketTopic: topic,
      };
    },
  };
}
