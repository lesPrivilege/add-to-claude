import { createChatGPTSocketTurn } from '../src/chatgpt-socket.js';
import { isInternalMessage } from '../src/message-visibility.js';
import { createEventStreamDecoder } from '../src/event-stream.js';
import { createChatGPTStream } from '../src/chatgpt-stream.js';
import { mergeConversationStream } from '../src/stream-conversation.js';

/** Observe only data the current ChatGPT page loads itself. Never fetch or refresh.
 * Packets go to the app's isolated-world bridge over a private MessagePort. The port is handed over
 * once at document start, before any page script runs, so page scripts cannot post into it. */
export function installPageObserver({ maxBytes = 16 * 1024 * 1024 } = {}) {
  const documentURL = new URL(location.href);
  if (
    documentURL.protocol !== 'https:' ||
    !['chatgpt.com', 'chat.openai.com'].includes(documentURL.hostname)
  )
    return;
  const key = Symbol.for('gpt-handoff.passive-observer');
  if (window[key]) return;
  Object.defineProperty(window, key, { value: true });
  let generation = 0,
    getSequence = 0,
    cached = null,
    job = null,
    snapshot = null;
  let lastLocation = location.href;
  const readers = new Set();
  const encoder = new TextEncoder();
  const surface = () => {
    const url = new URL(location.href);
    if (
      url.protocol !== 'https:' ||
      !['chatgpt.com', 'chat.openai.com'].includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password
    )
      return null;
    const id = /^\/(?:g\/[A-Za-z0-9_-]+\/)?c\/([A-Za-z0-9_-]+)\/?$/u.exec(url.pathname)?.[1];
    if (!id && !/^\/(?:g\/[A-Za-z0-9_-]+\/?)?$/u.test(url.pathname)) return null;
    return {
      id: id ?? null,
      origin: url.origin,
      pageUrl: url.origin + url.pathname,
      responseUrl: id ? `${url.origin}/backend-api/conversation/${id}` : null,
    };
  };
  const channel = new MessageChannel();
  window.postMessage({ type: 'gpt-handoff/port' }, location.origin, [channel.port2]);
  const port = channel.port1;
  const post = (value) => {
    try {
      port.postMessage(value);
    } catch {}
  };
  // TEMPORARY diagnostic: request shapes only, ids redacted, to learn how the live page loads chats.
  const trace = (method, url) =>
    post({
      kind: 'trace',
      pageUrl: location.origin + location.pathname,
      method,
      path:
        url.origin +
        url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}|[A-Za-z0-9_-]{20,}/giu, ':id') +
        (url.search ? '?…' : ''),
    });
  addEventListener('DOMContentLoaded', () =>
    trace(
      `DOM mapping-in-html=${/"mapping"/u.test(document.documentElement.innerHTML)}`,
      new URL(location.href),
    ),
  );
  const invalidate = (keepBase = false) => {
    generation++;
    for (const reader of readers) void reader.cancel().catch(() => {});
    readers.clear();
    if (job?.socketTimer) clearTimeout(job.socketTimer);
    job = null;
    snapshot = null;
    if (!keepBase) cached = null;
    post({ kind: 'changed', pageUrl: location.href });
  };
  const publish = (value) => {
    const selected = surface();
    if (!selected?.id || value.id !== selected.id) return false;
    if (encoder.encode(value.body).byteLength > maxBytes) throw new Error('size');
    snapshot = value;
    post({
      kind: 'response',
      pageUrl: selected.pageUrl,
      responseUrl: value.responseUrl,
      capturedAt: value.capturedAt,
      method: value.method,
      body: value.body,
    });
    return true;
  };
  const unavailable = (version) => {
    if (version === generation) post({ kind: 'unavailable', pageUrl: location.href });
  };
  const read = async (response, version, consume, owned = false) => {
    const reader = (owned ? response : response.clone()).body?.getReader();
    if (!reader) throw new Error('body unavailable');
    readers.add(reader);
    let count = 0,
      reachedEnd = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (version !== generation) return false;
        if (done) {
          reachedEnd = true;
          return true;
        }
        count += value.byteLength;
        if (count > maxBytes) throw new Error('size');
        consume(value);
      }
    } finally {
      // Cancelling a tee branch can wait for the website; never await it here.
      if (!reachedEnd) void reader.cancel().catch(() => {});
      readers.delete(reader);
      reader.releaseLock();
    }
  };
  const requestText = (input, init) => {
    if (typeof init?.body === 'string') return () => Promise.resolve(init.body);
    if (typeof Request !== 'undefined' && input instanceof Request && init?.body === undefined) {
      // Clone before fetch consumes the Request, but read only after the new job owns its generation.
      const copy = input.clone();
      return async (version) => {
        const decoder = new TextDecoder('utf-8', { fatal: true }),
          parts = [];
        if (
          !(await read(
            copy,
            version,
            (bytes) => parts.push(decoder.decode(bytes, { stream: true })),
            true,
          ))
        )
          throw new Error('request changed');
        parts.push(decoder.decode());
        return parts.join('');
      };
    }
    return () => Promise.reject(new Error('unsupported request body'));
  };
  const selectedRequest = (text, selected) => {
    if (encoder.encode(text).byteLength > maxBytes) throw new Error('request size');
    const value = JSON.parse(text);
    if (
      !value ||
      typeof value !== 'object' ||
      !Array.isArray(value.messages ?? []) ||
      (value.messages?.length ?? 0) > 100 ||
      typeof value.parent_message_id !== 'string' ||
      (value.conversation_id != null ? value.conversation_id !== selected.id : selected.id !== null)
    )
      throw new Error('unselected request');
    return {
      action: value.action ?? 'next',
      conversation_id: value.conversation_id ?? null,
      parent_message_id: value.parent_message_id,
      messages: (value.messages ?? []).map((message) => {
        const output = {
          id: message.id,
          author: { role: message.author?.role },
          content: message.content,
        };
        for (const key of ['status', 'end_turn', 'recipient', 'channel', 'weight'])
          if (message[key] !== undefined) output[key] = message[key];
        if (message.metadata && typeof message.metadata === 'object') {
          output.metadata = {};
          for (const key of [
            'attachments',
            'citations',
            'content_references',
            'is_visually_hidden_from_conversation',
          ])
            if (message.metadata[key] !== undefined) output.metadata[key] = message.metadata[key];
        }
        return output;
      }),
    };
  };
  const failSocket = (active) => {
    if (job !== active || active.version !== generation) return;
    active.socketFailed = true;
    active.socketReader = null;
    if (active.socketTimer) clearTimeout(active.socketTimer);
    if (active.socketReady) {
      active.ready = null;
      active.socketReply = null;
      snapshot = null;
      cached = active.base;
      unavailable(active.version);
    }
  };
  const retireSocket = (active) => {
    active.socketRetired = true;
    active.socketReader = null;
    active.socket = null;
    if (active.socketTimer) clearTimeout(active.socketTimer);
    if (active.finished && active.ready && surface()?.id === active.replyId) job = null;
  };
  const publishSocket = (active) => {
    if (
      job !== active ||
      active.version !== generation ||
      !active.finished ||
      !active.socketReply ||
      active.socketFailed
    )
      return;
    const next = mergeConversationStream(active.base, active.request, active.socketReply);
    next.socket = {
      origin: 'wss://ws.chatgpt.com',
      topic: active.handoff.topic,
      coverage: 'unverified-replay',
      terminalObserved: active.socketReply.socketTerminalObserved,
    };
    cached = next;
    active.ready = {
      id: active.replyId,
      body: JSON.stringify(next),
      method: 'POST',
      responseUrl: active.responseURL,
      capturedAt: new Date().toISOString(),
    };
    active.socketReady = true;
    const published = publish(active.ready);
    if (published && active.socketRetired) job = null;
    if (active.socketTimer) clearTimeout(active.socketTimer);
  };
  const bindSocket = (active) => {
    if (!active.handoff || active.socketFailed || active.socketReader || active.socketRetired)
      return;
    const subscription = active.subscriptions.get(active.handoff.topic);
    if (!subscription) return;
    if (subscription.bad) {
      failSocket(active);
      return;
    }
    active.socket = subscription.socket;
    active.socketReader = createChatGPTSocketTurn({ ...active.handoff, maxBytes });
    active.socketTimer = setTimeout(() => failSocket(active), 120000);
  };
  const markEarlySocketFrames = (active, socket, data) => {
    const candidates = [...active.subscriptions.entries()].filter(
      ([, item]) => item.socket === socket,
    );
    if (!candidates.length) return;
    try {
      if (
        typeof data !== 'string' ||
        data.length > 8 * 1024 * 1024 ||
        encoder.encode(data).byteLength > 8 * 1024 * 1024
      )
        throw new Error('unsupported early frame');
      const raw = JSON.parse(data),
        frames = Array.isArray(raw) ? raw : [raw];
      if (frames.length > 1000) throw new Error('too many frames');
      for (const frame of frames) {
        const topic = frame?.type === 'reply' ? frame.reply?.topic_id : frame?.topic_id;
        const subscription = active.subscriptions.get(topic);
        if (subscription?.socket === socket) subscription.bad = true;
      }
    } catch {
      for (const [, subscription] of candidates) subscription.bad = true;
    }
    // Only the missed-frame flag survives; never queue another topic's transcript or raw frame.
  };
  // Observe only website-owned sockets on the known ChatGPT endpoint. No query/protocol/auth values retained.
  if (typeof window.WebSocket === 'function') {
    const NativeSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeSocket, {
      construct(target, args, newTarget) {
        const socket = Reflect.construct(target, args, newTarget);
        try {
          const url = new URL(socket.url);
          trace('WS', url);
          if (
            url.origin !== 'wss://ws.chatgpt.com' ||
            !/^\/p4\/ws\/user\/[^/]+$/u.test(url.pathname)
          )
            return socket;
          const send = socket.send;
          socket.send = function (...outgoing) {
            const result = Reflect.apply(send, this, outgoing);
            try {
              const active = job;
              if (
                this !== socket ||
                !active ||
                active.socketRetired ||
                typeof outgoing[0] !== 'string' ||
                encoder.encode(outgoing[0]).byteLength > 65536
              )
                return result;
              const commands = JSON.parse(outgoing[0]);
              if (!Array.isArray(commands) || commands.length > 64) return result;
              for (const entry of commands) {
                const command = entry?.command,
                  topic = command?.topic_id;
                if (
                  typeof topic !== 'string' ||
                  !/^conversation-turn-[A-Za-z0-9_-]{1,200}$/u.test(topic) ||
                  !['subscribe', 'unsubscribe'].includes(command.type) ||
                  (active.handoff && topic !== active.handoff.topic)
                )
                  continue;
                if (!active.subscriptions.has(topic) && active.subscriptions.size >= 4) {
                  failSocket(active);
                  break;
                }
                if (
                  command.type === 'unsubscribe' &&
                  active.handoff?.topic === topic &&
                  active.socketReply
                ) {
                  retireSocket(active);
                  continue;
                }
                const previous = active.subscriptions.get(topic);
                active.subscriptions.set(topic, {
                  socket,
                  bad: Boolean(previous) || command.type !== 'subscribe' || command.offset !== '0',
                });
                if (previous && active.handoff?.topic === topic) failSocket(active);
                else bindSocket(active);
              }
            } catch {
              if (job?.socket === socket) failSocket(job);
            }
            return result;
          };
          socket.addEventListener('message', (event) => {
            const active = job;
            if (!active || active.socketRetired || active.version !== generation) return;
            if (active.socket !== socket || !active.socketReader) {
              markEarlySocketFrames(active, socket, event.data);
              return;
            }
            try {
              if (typeof event.data !== 'string') throw new Error('unsupported socket data');
              const selected = active.socketReader.accept(event.data);
              if (selected && active.socketReader.ended) {
                active.socketReply = active.socketReader.result();
                publishSocket(active);
              }
            } catch {
              failSocket(active);
            }
          });
          for (const event of ['close', 'error'])
            socket.addEventListener(event, () => {
              if (job?.socket !== socket) return;
              if (job.socketReply) retireSocket(job);
              else failSocket(job);
            });
        } catch {
          /* The original socket remains usable even if observation cannot attach. */
        }
        return socket;
      },
    });
  }
  const captureStream = async (responsePromise, bodyPromise, selected, requested, active) => {
    try {
      const request = selectedRequest(await bodyPromise, selected);
      if (active.version !== generation) return;
      active.isNew = request.conversation_id === null;
      active.request = request;
      active.responseURL = requested.href;
      const response = await responsePromise;
      if (active.version !== generation) return;
      if (
        response.status !== 200 ||
        response.url !== requested.href ||
        !/^text\/event-stream(?:;|$)/iu.test(response.headers.get('content-type') ?? '')
      )
        throw new Error('not a stream');
      const stream = createChatGPTStream({ expectedConversationId: request.conversation_id });
      const decoder = createEventStreamDecoder({
        onEvent: (event) => {
          stream.accept(event);
          active.replyId = stream.conversationId;
          if (stream.handoff && !active.handoff && stream.result().messages.length === 0) {
            active.handoff = stream.handoff;
            bindSocket(active);
          }
          if (active.boundId && active.replyId && active.boundId !== active.replyId)
            throw new Error('changed source');
        },
      });
      if (!(await read(response, active.version, (bytes) => decoder.push(bytes), true))) return;
      decoder.finish();
      const reply = stream.result();
      if (!reply.conversationId || (active.boundId && active.boundId !== reply.conversationId))
        throw new Error('changed source');
      const next = mergeConversationStream(active.base, request, reply);
      if (active.version !== generation) return;
      const current = surface();
      if (current?.id && current.id !== reply.conversationId) return;
      cached = next;
      active.finished = true;
      active.ready = {
        id: reply.conversationId,
        body: JSON.stringify(next),
        method: 'POST',
        responseUrl: requested.href,
        capturedAt: new Date().toISOString(),
      };
      const published = publish(active.ready);
      if (active.handoff) publishSocket(active);
      else if (published) job = null;
    } catch {
      if (active.socketTimer) clearTimeout(active.socketTimer);
      active.finished = true;
      if (job === active) {
        job = null;
        unavailable(active.version);
      }
    } finally {
      // The observer's branch must not retain an unread body if request validation fails.
      void responsePromise.then((response) => response.body?.cancel()).catch(() => {});
    }
  };
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    let requested, selected, method, readRequest;
    try {
      requested = new URL(
        typeof args[0] === 'string' || args[0] instanceof URL ? args[0] : args[0].url,
        location.href,
      );
      selected = surface();
      method = String(args[1]?.method ?? args[0]?.method ?? 'GET').toUpperCase();
      if (
        requested.pathname.includes('/backend-api/') ||
        requested.pathname.includes('conversation')
      )
        trace(method, requested);
      if (
        selected &&
        method === 'POST' &&
        requested.origin === selected.origin &&
        ['/backend-api/conversation', '/backend-api/f/conversation'].includes(requested.pathname) &&
        !requested.search &&
        !requested.hash
      ) {
        readRequest = requestText(args[0], args[1]);
      }
    } catch {
      /* Observing must never prevent the website's request. */
    }
    const promise = Reflect.apply(originalFetch, this, args);
    if (!selected || !requested) return promise;
    if (readRequest) {
      // Register the clone before the website can consume its original response.
      const observed = promise.then((response) => response.clone());
      void observed.catch(() => {});
      const base = cached;
      invalidate(true);
      const active = {
        version: generation,
        base,
        isNew: !selected.id,
        boundId: selected.id,
        subscriptions: new Map(),
      };
      job = active;
      void captureStream(observed, readRequest(active.version), selected, requested, active);
      return promise;
    }
    if (method !== 'GET' || !selected.id || requested.href !== selected.responseUrl) return promise;
    // The website can hydrate a new conversation while its answer is streaming.
    // Keep that stream alive and use the GET as its base, never as a final answer.
    const associatedJob = job && !job.finished && job.boundId === selected.id ? job : null;
    if (!associatedJob) invalidate();
    const sequence = ++getSequence;
    const version = generation;
    void promise
      .then(async (response) => {
        if (
          version !== generation ||
          sequence !== getSequence ||
          response.url !== selected.responseUrl ||
          response.status !== 200
        )
          return;
        const decoder = new TextDecoder('utf-8', { fatal: true }),
          parts = [];
        try {
          if (
            !(await read(response, version, (bytes) =>
              parts.push(decoder.decode(bytes, { stream: true })),
            ))
          )
            return;
          parts.push(decoder.decode());
          const body = parts.join('');
          if (surface()?.id !== selected.id || sequence !== getSequence || associatedJob?.finished)
            return;
          try {
            const conversation = JSON.parse(body);
            if (
              (conversation.conversation_id ?? conversation.id) === selected.id &&
              conversation.mapping
            ) {
              cached = { conversation, coverage: 'observed-response', requestMessageIds: [] };
              if (associatedJob && associatedJob === job) associatedJob.base = cached;
            }
          } catch {
            /* The core will report unsupported JSON if the user chooses Add. */
          }
          if (!associatedJob)
            publish({
              id: selected.id,
              body,
              method: 'GET',
              responseUrl: selected.responseUrl,
              capturedAt: new Date().toISOString(),
            });
        } catch {
          if (sequence === getSequence && !associatedJob?.finished) unavailable(version);
        }
      })
      .catch(() => {
        if (sequence === getSequence && !associatedJob?.finished) unavailable(version);
      });
    return promise;
  };
  const locationChanged = () => {
    const before = lastLocation;
    lastLocation = location.href;
    const selected = surface();
    // The website assigns a URL during a new chat; this is not a different selected source.
    if (
      job?.isNew &&
      selected?.id &&
      (!job.boundId || job.boundId === selected.id) &&
      (!job.replyId || job.replyId === selected.id)
    ) {
      job.boundId = selected.id;
      if (
        job.ready &&
        !job.socketFailed &&
        publish(job.ready) &&
        (!job.handoff || job.socketRetired)
      )
        job = null;
      return;
    }
    if (snapshot && before.split('#')[0] === location.href.split('#')[0] && publish(snapshot))
      return;
    invalidate();
  };
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name];
    history[name] = function (...args) {
      const before = location.href;
      const result = Reflect.apply(original, this, args);
      if (location.href !== before) locationChanged();
      return result;
    };
  }
  addEventListener('popstate', locationChanged);
  addEventListener('pagehide', () => invalidate());
}

/** The extension and browser tests install this same self-contained observer bundle. */
export function createPageObserverScript(options = {}) {
  return `(() => {\nconst isInternalMessage = ${isInternalMessage.toString()};\nconst createEventStreamDecoder = ${createEventStreamDecoder.toString()};\nconst createChatGPTStream = ${createChatGPTStream.toString()};\nconst createChatGPTSocketTurn = ${createChatGPTSocketTurn.toString()};\nconst mergeConversationStream = ${mergeConversationStream.toString()};\n(${installPageObserver.toString()})(${JSON.stringify(options)});\n})();\n`;
}
