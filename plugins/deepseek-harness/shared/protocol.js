// What crosses each boundary, validated on the receiving side:
//   bridge (isolated world) -> helper main: `ready` packets, as native/Chat.swift accepts them;
//   helper -> host over the private IPC pipe: `state` and `reply` messages;
//   host -> DeepSeek Harness client over the authenticated /api routes: the panel state and Add's text.
import { pageKey, isChatRoot } from './navigation.js';
import { safeLabel } from './files.js';

/** The Markdown the compiler may produce (src/compile.js MAX_MARKDOWN). */
export const MAX_MARKDOWN_BYTES = 16 * 1024 * 1024;
/** Text that goes into a composer (docs/architecture.md, Limits). */
export const MAX_COMPOSER_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENTS = 500;

const bytes = (text) => Buffer.byteLength(text, 'utf8');
const int = (value, fallback) => (Number.isSafeInteger(value) ? value : fallback);

/**
 * A `ready` packet from the bridge, for the page the window shows (or the chat root, which gets
 * its conversation URL only after the first reply starts). Returns the prepared conversation or null.
 */
export function readyFrom(body, windowUrl) {
  if (!body || typeof body !== 'object' || body.kind !== 'ready') return null;
  const page = pageKey(body.page);
  if (!page || !(page === pageKey(windowUrl) || isChatRoot(windowUrl))) return null;
  if (typeof body.markdown !== 'string' || bytes(body.markdown) > MAX_MARKDOWN_BYTES) return null;
  const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
    .slice(0, MAX_ATTACHMENTS)
    .flatMap((file) =>
      file &&
      typeof file.key === 'string' &&
      typeof file.id === 'string' &&
      Number.isSafeInteger(file.line)
        ? [
            {
              key: file.key,
              id: file.id,
              name: safeLabel(typeof file.name === 'string' ? file.name : '', 200),
              label: typeof file.label === 'string' ? file.label : '',
              turn: int(file.turn, 0),
              messageId: typeof file.messageId === 'string' ? file.messageId : '',
              line: file.line,
              check: int(file.check, -1),
            },
          ]
        : [],
    );
  return {
    page,
    markdown: body.markdown,
    title: safeLabel(typeof body.title === 'string' ? body.title : 'ChatGPT conversation', 120),
    turns: int(body.turns, 0),
    files: int(body.files, 0),
    verification: body.verification === 'verified' ? 'verified' : 'partial',
    issues: (Array.isArray(body.issues) ? body.issues : [])
      .filter((issue) => typeof issue === 'string')
      .slice(0, 5)
      .map((issue) => safeLabel(issue, 200)),
    attachments,
    verifiedWithFiles: body.verifiedWithFiles === true,
  };
}

/** The panel's summary of a prepared conversation: no Markdown, no file ids. */
export function summary(prepared, savedCount) {
  return {
    title: prepared.title,
    turns: prepared.turns,
    files: prepared.files,
    saved: savedCount,
    verification: prepared.verification,
    verifiedWithFiles: prepared.verifiedWithFiles,
    issues: prepared.issues,
  };
}

const SOURCES = new Set(['waiting', 'ready', 'unavailable']);

/** A helper `state` message as the host keeps it; anything malformed becomes null. */
export function helperState(message) {
  if (!message || message.type !== 'state') return null;
  const source = SOURCES.has(message.source) ? message.source : 'waiting';
  const conversation =
    source === 'ready' && message.conversation && typeof message.conversation === 'object'
      ? {
          title: safeLabel(String(message.conversation.title ?? ''), 120),
          turns: int(message.conversation.turns, 0),
          files: int(message.conversation.files, 0),
          saved: int(message.conversation.saved, 0),
          verification: message.conversation.verification === 'verified' ? 'verified' : 'partial',
          verifiedWithFiles: message.conversation.verifiedWithFiles === true,
          issues: (Array.isArray(message.conversation.issues) ? message.conversation.issues : [])
            .slice(0, 5)
            .map((issue) => safeLabel(String(issue), 200)),
        }
      : null;
  return {
    visible: message.visible === true,
    focused: message.focused === true,
    pinned: message.pinned === true,
    source: conversation ? 'ready' : source === 'ready' ? 'waiting' : source,
    conversation,
    message: safeLabel(String(message.message ?? ''), 200),
  };
}

/** A helper `reply` to Add: the hand-off text or why there is none. */
export function addReply(message) {
  if (!message || message.type !== 'reply' || !Number.isSafeInteger(message.id)) return null;
  if (message.ok !== true)
    return { id: message.id, ok: false, error: safeLabel(String(message.error ?? ''), 200) };
  if (typeof message.markdown !== 'string' || bytes(message.markdown) > MAX_MARKDOWN_BYTES)
    return { id: message.id, ok: false, error: 'The hand-off text was malformed.' };
  return {
    id: message.id,
    ok: true,
    markdown: message.markdown,
    note: safeLabel(String(message.note ?? ''), 200),
  };
}

/** The Add request body from the client: `{ "downloadFiles": boolean }`, at most 1 KiB. */
export function addRequest(text) {
  if (typeof text !== 'string' || text.length > 1024) return null;
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return { downloadFiles: value.downloadFiles !== false };
}

/** The pin request body: `{ "on": boolean }`. */
export function pinRequest(text) {
  if (typeof text !== 'string' || text.length > 1024) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value.on === 'boolean' ? { on: value.on } : null;
  } catch {
    return null;
  }
}

/** Whether the text fits a composer. */
export function fitsComposer(markdown) {
  return bytes(markdown) <= MAX_COMPOSER_BYTES;
}
