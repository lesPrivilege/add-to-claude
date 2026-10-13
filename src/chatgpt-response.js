/** Original data from the selected page's own response. No requests or credentials. */
import { importConversation } from './import.js';
import { LIMITS, validateConversation } from './model.js';

const encoder = new TextEncoder();
const hosts = new Set(['chatgpt.com', 'chat.openai.com']);

export function originalSource(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Choose an open ChatGPT conversation.');
  }
  const match = /^\/(?:g\/[A-Za-z0-9_-]{1,200}\/)?c\/([A-Za-z0-9_-]{1,200})\/?$/u.exec(
    url.pathname,
  );
  if (
    url.protocol !== 'https:' ||
    !hosts.has(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    !match
  )
    throw new TypeError(
      'Original messages require an open ChatGPT conversation, not a shared-page preview.',
    );
  return {
    id: match[1],
    pageUrl: `${url.origin}${url.pathname}`,
    responseUrl: `${url.origin}/backend-api/conversation/${match[1]}`,
  };
}

export function isSelectedResponse(value, pageUrl) {
  try {
    const expected = originalSource(pageUrl);
    const url = new URL(value);
    // No related endpoints, pagination, child frames, auth responses or other conversations.
    return url.href === expected.responseUrl;
  } catch {
    return false;
  }
}

export function importBrowserResponse(body, { pageUrl, responseUrl, capturedAt, method = 'GET' }) {
  const selected = originalSource(pageUrl);
  const origin = new URL(pageUrl).origin;
  if (
    (method === 'GET' && !isSelectedResponse(responseUrl, pageUrl)) ||
    (method === 'POST' &&
      ![`${origin}/backend-api/conversation`, `${origin}/backend-api/f/conversation`].includes(
        responseUrl,
      )) ||
    !['GET', 'POST'].includes(method)
  )
    throw new TypeError('The response does not belong to the selected conversation.');
  if (typeof body !== 'string' || encoder.encode(body).byteLength > LIMITS.maxImportBytes)
    throw new RangeError('The conversation response exceeds the 64 MiB limit.');
  let raw;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new TypeError('The selected page did not return a supported conversation JSON response.');
  }
  let stream;
  if (method === 'POST') {
    stream = raw;
    if (
      !stream ||
      !['observed-response', 'new-conversation', 'partial-history'].includes(stream.coverage) ||
      typeof stream.streamCompleted !== 'boolean' ||
      !Array.isArray(stream.requestMessageIds) ||
      stream.requestMessageIds.length > LIMITS.maxNodes
    )
      throw new TypeError('The observed stream has no valid coverage evidence.');
    raw = stream.conversation;
  }
  if (
    !raw ||
    Array.isArray(raw) ||
    typeof raw !== 'object' ||
    (raw.id ?? raw.conversation_id) !== selected.id ||
    (raw.id !== undefined && raw.conversation_id !== undefined && raw.id !== raw.conversation_id)
  )
    throw new TypeError('The response conversation ID does not match the selected page.');
  if (typeof raw.current_node !== 'string' || !raw.current_node)
    throw new TypeError('The response does not identify the currently selected branch.');
  const model = importConversation(raw, selected.id);
  const location = stream ? 'observed-stream.conversation' : 'response';
  const relocate = (value) => value.replace(/^conversations\[0\]/u, location);
  model.source = {
    ...model.source,
    type: 'chatgpt-response',
    url: selected.pageUrl,
    locator: location,
    response: {
      url: responseUrl,
      capturedAt,
      observedNodes: Object.keys(raw.mapping).length,
      ...(stream
        ? {
            method,
            coverage: stream.coverage,
            streamCompleted: stream.streamCompleted,
            requestMessageIds: stream.requestMessageIds,
          }
        : {}),
    },
  };
  for (const turn of model.turns) {
    turn.sourceLocator = relocate(turn.sourceLocator);
    for (const citation of turn.citations)
      citation.sourceLocator = relocate(citation.sourceLocator);
  }
  for (const attachment of model.attachments)
    attachment.sourceLocator = relocate(attachment.sourceLocator);
  for (const issue of model.verification.issues)
    if (issue.sourceLocator) issue.sourceLocator = relocate(issue.sourceLocator);
  if (raw.has_more === true || raw.is_truncated === true || raw.next_cursor != null) {
    model.verification.status = 'partial';
    model.verification.issues.push({
      code: 'response-incomplete',
      message:
        'The page reports more conversation data. This response is not the complete selected branch.',
      sourceLocator: 'response',
    });
  }
  if (stream?.coverage === 'partial-history') {
    model.verification.status = 'partial';
    model.verification.issues.push({
      code: 'history-unobserved',
      message: 'Only this exchange was observed. Earlier conversation history was not available.',
      sourceLocator: location,
    });
  }
  if (stream && !stream.streamCompleted) {
    model.verification.status = 'partial';
    model.verification.issues.push({
      code: 'stream-incomplete',
      message:
        'The live answer has not been confirmed complete. Review the source before handing off.',
      sourceLocator: location,
    });
  }
  return validateConversation(model);
}
