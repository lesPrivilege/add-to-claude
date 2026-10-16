// Where the ChatGPT window may go. Mirrors native/Chat.swift: top-level pages stay on ChatGPT and
// a small allowlist of sign-in hosts; other web links open in the default browser; other schemes
// are dropped.

export const CHAT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);
/** Hosts that sign-in may pass through. Anything else a link opens goes to the default browser. */
export const SIGN_IN_HOSTS = new Set([
  'chatgpt.com',
  'chat.openai.com',
  'auth.openai.com',
  'auth0.openai.com',
  'accounts.google.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'login.live.com',
]);
export const START_URL = 'https://chatgpt.com/';

function parse(text) {
  try {
    return new URL(String(text));
  } catch {
    return null;
  }
}

/** `https://<chat host><path>` for a ChatGPT page, else null. Same rule as Chat.swift pageKey. */
export function pageKey(text) {
  const url = parse(text);
  if (!url || url.protocol !== 'https:' || !CHAT_HOSTS.has(url.hostname)) return null;
  if (url.port || url.username || url.password) return null;
  return `https://${url.hostname}${url.pathname}`;
}

/** The chat root (a new chat), where a conversation URL is assigned only after the first reply. */
export function isChatRoot(text) {
  if (pageKey(text) === null) return false;
  const path = new URL(text).pathname;
  return path === '/' || /^\/g\/[A-Za-z0-9_-]+\/?$/u.test(path);
}

/** Only web links leave the window, and only to the default browser. */
export function external(text) {
  const url = parse(text);
  return url && (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : null;
}

/**
 * A top-level navigation in the ChatGPT window or a sign-in popup.
 * @returns 'allow', or 'external' (open in the default browser and cancel), or 'drop'.
 */
export function topLevel(text) {
  const url = parse(text);
  if (!url) return 'drop';
  if (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    SIGN_IN_HOSTS.has(url.hostname)
  )
    return 'allow';
  return external(text) ? 'external' : 'drop';
}

/** Subframes may load web, about, blob and data documents, as in Chat.swift. */
export function subframe(text) {
  const url = parse(text);
  return Boolean(url && ['https:', 'about:', 'blob:', 'data:'].includes(url.protocol));
}

/** `window.open`: sign-in popups keep this session; other new windows go to the default browser. */
export function popup(text) {
  const url = parse(text);
  if (url?.href === 'about:blank') return 'popup';
  const decision = topLevel(text);
  return decision === 'allow' ? 'popup' : decision;
}

/** A file link the page asked for itself: https on ChatGPT's own hosts only. */
export function isFileLink(text) {
  const url = parse(text);
  if (!url || url.protocol !== 'https:' || url.username || url.password) return false;
  return CHAT_HOSTS.has(url.hostname) || url.hostname.endsWith('.oaiusercontent.com');
}
