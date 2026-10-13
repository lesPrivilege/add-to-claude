import { isInternalMessage } from './message-visibility.js';

/** Join an observed request/reply exchange to the one current conversation, without fetching. */
export function mergeConversationStream(base, request, reply) {
  const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const identity = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/u.test(value);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  if (
    !record(request) ||
    !record(reply) ||
    !identity(reply.conversationId) ||
    !identity(request.parent_message_id) ||
    !['next', 'continue', 'variant'].includes(request.action ?? 'next')
  )
    throw new Error('The observed exchange has no supported source identity.');
  const id = reply.conversationId;
  if (request.conversation_id != null && request.conversation_id !== id)
    throw new Error('The observed request and reply belong to different conversations.');
  if (
    !Array.isArray(request.messages ?? []) ||
    (request.messages?.length ?? 0) > 100 ||
    !Array.isArray(reply.messages) ||
    reply.messages.length > 20000
  )
    throw new Error('The observed exchange exceeds the supported message bound.');
  let conversation, coverage;
  if (base) {
    if (
      !record(base.conversation) ||
      !record(base.conversation.mapping) ||
      (base.conversation.conversation_id ?? base.conversation.id) !== id
    )
      throw new Error('The saved source does not match this exchange.');
    conversation = structuredClone(base.conversation);
    coverage = base.coverage;
  } else {
    coverage = request.conversation_id == null ? 'new-conversation' : 'partial-history';
    conversation = {
      conversation_id: id,
      title: reply.title || 'Current ChatGPT conversation',
      mapping: {},
      current_node: request.parent_message_id,
    };
    Object.defineProperty(conversation.mapping, request.parent_message_id, {
      value: { id: request.parent_message_id, parent: null, children: [], message: null },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  if (!['observed-response', 'new-conversation', 'partial-history'].includes(coverage))
    throw new Error('The saved source has no coverage evidence.');
  const mapping = Object.assign(Object.create(null), conversation.mapping);
  if (!own(mapping, request.parent_message_id))
    throw new Error(
      'The source is missing the exchange parent. Earlier messages cannot be verified.',
    );
  const requestIds = new Set();
  let parent = request.parent_message_id;
  const validMessage = (message) => {
    if (
      !record(message) ||
      !identity(message.id) ||
      !record(message.author) ||
      !['user', 'assistant', 'system', 'tool'].includes(message.author.role) ||
      !record(message.content)
    )
      throw new Error('The observed message is incomplete or has no stable identity.');
  };
  const add = (message, parentId) => {
    if (Object.keys(mapping).length >= 20000)
      throw new RangeError('The conversation exceeds the node limit.');
    if (!identity(parentId) || parentId === message.id || !own(mapping, parentId))
      throw new Error('The observed message has an unavailable parent.');
    mapping[message.id] = { id: message.id, parent: parentId, children: [], message };
    if (
      Array.isArray(mapping[parentId].children) &&
      !mapping[parentId].children.includes(message.id)
    )
      mapping[parentId].children.push(message.id);
  };
  for (const input of request.messages ?? []) {
    validMessage(input);
    if (requestIds.has(input.id))
      throw new Error('The observed request repeats a message identity.');
    requestIds.add(input.id);
    if (own(mapping, input.id)) {
      const previous = mapping[input.id];
      if (
        previous.parent !== parent ||
        previous.message?.author?.role !== input.author.role ||
        JSON.stringify(previous.message?.content) !== JSON.stringify(input.content)
      )
        throw new Error('The observed request conflicts with the saved message.');
    } else {
      const message = structuredClone(input);
      // The server reply binds this request to its conversation; record the text's request origin separately.
      message.status ??= 'finished_successfully';
      add(message, parent);
    }
    parent = input.id;
  }
  const responseIds = new Set();
  for (const input of reply.messages) {
    validMessage(input);
    if (responseIds.has(input.id))
      throw new Error('The observed reply repeats a message identity.');
    responseIds.add(input.id);
    const message = structuredClone(input);
    if (own(mapping, input.id)) {
      if (
        !requestIds.has(input.id) &&
        !(request.action === 'continue' && input.id === request.parent_message_id) &&
        mapping[input.id].parent !== parent
      )
        throw new Error('The reply would replace an unrelated saved turn.');
      if (mapping[input.id].message?.author?.role !== input.author.role)
        throw new Error('The reply changed a message role.');
      mapping[input.id].message = message;
    } else {
      const declaredParent = input.parent_id ?? input.metadata?.parent_id;
      if (declaredParent !== undefined && declaredParent !== parent)
        throw new Error('The reply parent contradicts the observed message order.');
      add(message, parent);
    }
    parent = input.id;
  }
  // Keep uncertainty by branch anchor, including off-branch variants that may be selected later.
  // Only a complete re-observation of the same continued assistant resolves its anchor.
  const unresolved = new Set(
    base?.unresolvedStreamAnchors ??
      (base?.streamCompleted === false ? [base.conversation.current_node] : []),
  );
  if (
    reply.complete === true &&
    request.action === 'continue' &&
    responseIds.has(request.parent_message_id)
  )
    unresolved.delete(request.parent_message_id);
  if (reply.complete !== true) {
    const visible = reply.messages.filter(
      (message) => message.author.role === 'assistant' && !isInternalMessage(message),
    );
    // An internal routing tail must not let the next visible parent bypass this uncertainty.
    for (const anchor of visible.length ? visible.map((message) => message.id) : [parent])
      unresolved.add(anchor);
  }
  const selectedPath = new Set();
  let cursor = parent;
  while (cursor !== null && cursor !== undefined) {
    if (selectedPath.has(cursor) || !own(mapping, cursor))
      throw new Error('The selected exchange has a broken parent chain.');
    selectedPath.add(cursor);
    cursor = mapping[cursor].parent;
  }
  conversation.mapping = mapping;
  conversation.current_node = parent;
  if (typeof reply.title === 'string' && reply.title.trim())
    conversation.title = reply.title.slice(0, 500);
  return {
    conversation,
    coverage,
    requestMessageIds: [...new Set([...(base?.requestMessageIds ?? []), ...requestIds])],
    unresolvedStreamAnchors: [...unresolved],
    streamCompleted: reply.complete === true && ![...unresolved].some((id) => selectedPath.has(id)),
  };
}
