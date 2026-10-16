// File naming and the hand-off text's file lines, shared by the Electron helper and the tests.
// These mirror native/Files.swift (safeFileName, freePath) and native/Handoff.swift (linkFiles),
// so the DeepSeek Harness plugin and the menu-bar app hand off the same text.

/** Visible text only: control characters dropped, at most `limit` code points. */
export function safeLabel(text, limit = 90) {
  // Same set as Swift's CharacterSet.controlCharacters: Unicode general category Cc and Cf.
  const visible = String(text).replace(/[\p{Cc}\p{Cf}]/gu, '');
  return Array.from(visible).slice(0, limit).join('');
}

const MAX_NAME_BYTES = 200;
const bytes = (text) => Buffer.byteLength(text, 'utf8');

/** The longest prefix of `text` that fits `limit` UTF-8 bytes without splitting a code point. */
function capBytes(text, limit) {
  let used = 0;
  let out = '';
  for (const char of text) {
    used += bytes(char);
    if (used > limit) break;
    out += char;
  }
  return out;
}

/** A file name that stays inside its folder: no separators, never `.`, `..` or hidden. */
export function safeFileName(raw, fallback = 'file') {
  let name = safeLabel(raw, 120).replaceAll('/', '-').replaceAll(':', '-').trim();
  if (bytes(name) > MAX_NAME_BYTES) {
    // Cap by UTF-8 bytes (file systems count bytes), whole code points, keeping a short extension.
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && bytes(name.slice(dot)) <= 32 ? name.slice(dot) : '';
    name = capBytes(name.slice(0, ext ? dot : name.length), MAX_NAME_BYTES - bytes(ext)) + ext;
  }
  if (name === '' || name === '.' || name === '..') return fallback;
  return name.startsWith('.') ? `_${name.slice(1)}` : name;
}

/** The conversation's own subfolder name inside the files folder. */
export function folderName(title) {
  return safeFileName(Array.from(String(title)).slice(0, 80).join(''), 'conversation');
}

/** `name`, then `name 2`, `name 3`… : the first candidate `exists` says is free. */
export function freeName(name, exists) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let index = 2; exists(candidate); index++) candidate = `${base} ${index}${ext}`;
  return candidate;
}

/**
 * Each saved file's line points at its local copy, and a "download this file" check goes once
 * every file it was about has a copy. When only the files kept it partial, it reads verified.
 * `copies` maps an attachment key to `{ path, sha256 }`.
 * @returns `{ markdown, note }` exactly as native/Handoff.swift linkFiles does.
 */
export function linkFiles(prepared, copies) {
  let lines = prepared.markdown.split('\n');
  const linked = new Set();
  const dropped = new Set();
  for (const file of prepared.attachments) {
    if (!(file.line >= 0 && file.line < lines.length)) continue;
    const copy = copies.get(file.key);
    if (!copy) continue;
    const path = copy.path.includes('`') ? `\`\` ${copy.path} \`\`` : `\`${copy.path}\``;
    lines[file.line] = `- ${file.label} — ${path} · sha256 ${copy.sha256}`;
    linked.add(file.key);
  }
  for (const check of new Set(prepared.attachments.map((file) => file.check))) {
    if (check < 0) continue;
    const about = prepared.attachments.filter((file) => file.check === check);
    if (about.every((file) => linked.has(file.key))) dropped.add(check);
  }
  lines = lines.filter((_, index) => !dropped.has(index));
  const header = lines.indexOf('## Content checks');
  if (
    header > 0 &&
    header + 2 < lines.length &&
    lines[header + 1] === '' &&
    lines[header + 2] === ''
  )
    lines.splice(header - 1, 3);
  const total = prepared.attachments.length;
  if (total > 0 && linked.size === total && prepared.verifiedWithFiles) {
    const source = lines.findIndex((line) => line.startsWith('Source: '));
    if (source >= 0)
      lines[source] = lines[source].replaceAll(
        ' · verification: partial',
        ' · verification: verified',
      );
  }
  const note =
    total === 0
      ? ''
      : linked.size === total
        ? `${total} file${total === 1 ? '' : 's'} linked.`
        : `${linked.size} of ${total} files linked; the rest are references (download them from the Files list).`;
  return { markdown: lines.join('\n'), note };
}
