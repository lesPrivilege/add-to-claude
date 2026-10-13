import { isInternalMessage } from './message-visibility.js';

/** Decode observed ChatGPT message envelopes and v1 deltas, without making requests. */
export function createChatGPTStream({ expectedConversationId = null, maxMessages = 20000 } = {}) {
  const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/u.test(value);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
  const messages = new Map();
  let state = {},
    previousPath,
    previousOperation,
    conversationId = expectedConversationId;
  let done = false,
    handedOff = false,
    title,
    handoff = null;
  const bind = (value) => {
    if (value === undefined || value === null) return;
    if (!identifier(value) || (conversationId && value !== conversationId))
      throw new Error('The source stream changed conversation identity.');
    conversationId = value;
  };
  const remember = () => {
    bind(state.conversation_id);
    const message = state.message;
    if (!record(message)) return;
    if (!identifier(message.id) || !record(message.author))
      throw new Error('The source stream has no stable message identity.');
    if (!messages.has(message.id) && messages.size >= maxMessages)
      throw new RangeError('The source stream contains too many messages.');
    messages.set(message.id, message);
  };
  const envelope = (value) => {
    if (!record(value) || !record(value.message))
      throw new Error('Unsupported source message envelope.');
    // Do not retain resume tokens, trace metadata, or unrelated root fields.
    state = { message: structuredClone(value.message) };
    if (value.conversation_id !== undefined) state.conversation_id = value.conversation_id;
    remember();
  };
  const patch = (change, inherit = true) => {
    if (!record(change)) throw new Error('Unsupported source patch.');
    const path = own(change, 'p') ? change.p : inherit ? previousPath : undefined;
    const operation = own(change, 'o') ? change.o : inherit ? previousOperation : undefined;
    if (
      typeof path !== 'string' ||
      path.length > 2048 ||
      !['add', 'replace', 'append', 'remove', 'patch'].includes(operation)
    )
      throw new Error('Unsupported source patch path or operation.');
    if (inherit) {
      previousPath = path;
      previousOperation = operation;
    }
    if (operation === 'patch') {
      if (path !== '' || !Array.isArray(change.v) || change.v.length > 10000)
        throw new Error('Unsupported source patch batch.');
      for (const child of change.v) patch(child, false);
      remember();
      return;
    }
    if (path === '') {
      if (!['add', 'replace'].includes(operation))
        throw new Error('Unsupported source envelope operation.');
      envelope(change.v);
      return;
    }
    if (!path.startsWith('/') || /~(?![01])/u.test(path))
      throw new Error('Invalid source JSON pointer.');
    const keys = path
      .slice(1)
      .split('/')
      .map((key) => key.replace(/~1/gu, '/').replace(/~0/gu, '~'));
    if (keys.length > 32 || keys.some((key) => forbidden.has(key)))
      throw new Error('Unsafe source JSON pointer.');
    // Stream control/telemetry fields are irrelevant to the transcript.
    if (!['message', 'conversation_id'].includes(keys[0])) return;
    let parent = state;
    for (const key of keys.slice(0, -1)) {
      if ((!record(parent) && !Array.isArray(parent)) || !own(parent, key))
        throw new Error('The source patch refers to missing data.');
      parent = parent[key];
    }
    if (!record(parent) && !Array.isArray(parent))
      throw new Error('The source patch has no object target.');
    const key = keys.at(-1);
    if (Array.isArray(parent) && (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) > parent.length))
      throw new Error('The source patch has an invalid array index.');
    if (operation === 'remove') {
      if (!own(parent, key)) throw new Error('The source patch removes missing data.');
      if (Array.isArray(parent)) parent.splice(Number(key), 1);
      else delete parent[key];
    } else if (operation === 'append') {
      if (!own(parent, key)) throw new Error('The source patch appends to missing data.');
      if (typeof parent[key] === 'string' && typeof change.v === 'string') parent[key] += change.v;
      else if (Array.isArray(parent[key]) && Array.isArray(change.v))
        parent[key].push(...structuredClone(change.v));
      else if (record(parent[key]) && record(change.v)) {
        for (const [field, value] of Object.entries(change.v)) {
          if (forbidden.has(field)) throw new Error('Unsafe source metadata field.');
          parent[key][field] = structuredClone(value);
        }
      } else throw new Error('The source patch has incompatible append data.');
    } else {
      if (operation === 'replace' && !own(parent, key))
        throw new Error('The source patch replaces missing data.');
      if (Array.isArray(parent) && operation === 'add')
        parent.splice(Number(key), 0, structuredClone(change.v));
      else parent[key] = structuredClone(change.v);
    }
    remember();
  };
  return {
    get conversationId() {
      return conversationId;
    },
    get handoff() {
      return handoff ? { ...handoff } : null;
    },
    accept({ event, data }) {
      if (done) throw new Error('Conversation data arrived after the stream ended.');
      if (data === '[DONE]') {
        done = true;
        return;
      }
      let packet;
      try {
        packet = JSON.parse(data);
      } catch {
        throw new Error('The source stream contains invalid JSON.');
      }
      if (event === 'delta_encoding') {
        if (packet !== 'v1') throw new Error('This source stream encoding is not supported.');
        return;
      }
      if (!record(packet)) throw new Error('Unsupported source stream event.');
      if (packet.error) throw new Error('The source reported a failed answer.');
      bind(packet.conversation_id);
      if (packet.type === 'stream_handoff' || event === 'stream_handoff') {
        if (handedOff) throw new Error('The source handed off the exchange more than once.');
        handedOff = true;
        const options = Array.isArray(packet.options)
          ? packet.options.filter(
              (option) =>
                option?.type === 'subscribe_ws_topic' &&
                typeof option.topic_id === 'string' &&
                /^conversation-turn-[A-Za-z0-9_-]{1,200}$/u.test(option.topic_id),
            )
          : [];
        if (identifier(packet.conversation_id) && options.length === 1) {
          handoff = { conversationId: packet.conversation_id, topic: options[0].topic_id };
          if (identifier(packet.turn_exchange_id)) handoff.turnExchangeId = packet.turn_exchange_id;
        }
        return;
      }
      if (packet.type === 'resume_conversation_token') return;
      if (packet.type === 'title_generation') {
        if (typeof packet.title === 'string') title = packet.title.slice(0, 500);
        return;
      }
      if (record(packet.message)) {
        envelope(packet);
        return;
      }
      if (record(packet.v) && record(packet.v.message) && !own(packet, 'p') && !own(packet, 'o')) {
        patch({ p: '', o: 'add', v: packet.v });
        return;
      }
      if (own(packet, 'v') || own(packet, 'p') || own(packet, 'o')) {
        patch(packet);
        return;
      }
      // Typed non-message events carry timing, moderation or routing information only.
      if (typeof packet.type !== 'string') throw new Error('Unrecognized source stream event.');
    },
    result() {
      const captured = [...messages.values()];
      const last = captured.findLast(
        (message) => message.author?.role === 'assistant' && !isInternalMessage(message),
      );
      const finish = last?.metadata?.finish_details?.type;
      const complete =
        done &&
        !handedOff &&
        Boolean(last) &&
        last.status === 'finished_successfully' &&
        (last.end_turn === true || finish === 'stop') &&
        !['interrupted', 'max_tokens'].includes(finish);
      return {
        conversationId,
        messages: structuredClone(captured),
        complete,
        handedOff,
        ...(handoff ? { handoff: { ...handoff } } : {}),
        ...(title ? { title } : {}),
      };
    },
  };
}
