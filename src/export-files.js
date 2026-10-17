/** Files a ChatGPT conversation refers to. References only: nothing here fetches or opens a file. */
import { LIMITS, safeUrl } from './model.js';
import { identity, isRecord } from './export-graph.js';

function attachmentName(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value
    .replace(/[\\/\u0000-\u001f\u007f]/gu, '_')
    .slice(0, 255)
    .replace(/^\.{1,2}$/u, '_');
}

/**
 * The branch's file list. `add` records one reference (once per message) and its issue; it
 * returns false when the item names no file.
 */
export function attachmentList(issue) {
  const list = [];
  const keys = new Set();
  const add = (item, sourceLocator, turnId) => {
    if (!isRecord(item)) return false;
    const pointer = item.asset_pointer ?? item.id ?? item.file_id ?? item.url ?? item.download_url;
    if (typeof pointer !== 'string' || !pointer.length) return false;
    // File identifiers are data. Never turn private asset pointers into requests or filesystem paths.
    const attachmentId =
      pointer.length <= 450 && identity(pointer) ? pointer : `attachment-${list.length + 1}`;
    const key = `${turnId ?? ''}\u0000${pointer}`;
    if (keys.has(key)) return true;
    keys.add(key);
    if (list.length >= LIMITS.maxAttachments)
      throw new RangeError('Conversation exceeds the 1,000 attachment limit.');
    const explicitStatus = item.status;
    const status =
      explicitStatus === 'expired' || item.expired === true
        ? 'expired'
        : explicitStatus === 'inaccessible'
          ? 'inaccessible'
          : 'download-needed';
    const result = {
      id: `${list.length + 1}:${attachmentId}`,
      name: attachmentName(item.name ?? item.filename, `Attachment ${list.length + 1}`),
      sourceLocator,
      status,
    };
    // The message a file came from; its turn is that message's exchange (see settleAttachments).
    if (turnId) result.turnId = result.messageId = turnId;
    const url = safeUrl(item.download_url ?? item.url);
    if (url) result.url = url;
    if (typeof (item.mime_type ?? item.media_type) === 'string')
      result.mediaType = (item.mime_type ?? item.media_type).slice(0, 200);
    if (Number.isSafeInteger(item.size) && item.size >= 0 && item.size <= LIMITS.maxAttachmentBytes)
      result.size = item.size;
    list.push(result);
    issue(
      `attachment-${status}`,
      `${result.name}: ${status === 'expired' ? 'the exported download has expired; reopen the source and request a fresh file.' : status === 'inaccessible' ? 'open the original conversation to check access, then download the file normally.' : 'download this file from the original conversation and select it separately; this export contains a reference only.'}`,
      sourceLocator,
    );
    return true;
  };
  return { list, add };
}

/**
 * Generated download links often appear only in Markdown. Keep the exact link in text, but
 * record that its bytes were not in this export. Never resolve a sandbox path locally.
 */
export function sandboxLinks(markdown) {
  return [...markdown.matchAll(/sandbox:\/[^\s<>"')\]]+/gu)].map((match) => {
    let name = match[0].split('/').at(-1);
    try {
      name = decodeURIComponent(name);
    } catch {
      /* Keep malformed URI text as a display name. */
    }
    return { id: match[0], name, offset: match.index };
  });
}

/** Put each file under its turn, join a sandbox link to its attached copy, and keep account ids out of names. */
export function settleAttachments(attachments, issues, foldedInto) {
  for (const file of attachments)
    if (file.turnId) file.turnId = foldedInto.get(file.turnId) ?? file.turnId;
  const rename = (file, name) => {
    const raised = issues.find((item) => item.sourceLocator === file.sourceLocator);
    if (raised) raised.message = raised.message.replace(file.name, name);
    file.name = name;
  };
  // A generated file linked in a turn as sandbox:/mnt/data/<name> may also be attached, outside any
  // turn, under ChatGPT's internal name "…_mnt_data_<name>". They are one file: the attached copy
  // (fetchable by its file id) takes the turn's place and short name, and the sandbox reference goes.
  // In a subfolder (sandbox:/mnt/data/dir/name) the internal name flattens the path: "…_mnt_data_dir_name".
  const internalName = (reference) => {
    let path = reference.id.split('sandbox:/mnt/data/')[1] ?? reference.name;
    try {
      path = decodeURIComponent(path);
    } catch {
      /* Keep the raw path. */
    }
    return `_mnt_data_${path.replaceAll('/', '_')}`;
  };
  for (const reference of attachments.filter((file) => file.id.includes(':sandbox:'))) {
    const attached = attachments.find(
      (file) =>
        !file.turnId &&
        !file.id.includes(':sandbox:') &&
        (file.name === reference.name || file.name.endsWith(internalName(reference))),
    );
    if (!attached) continue;
    rename(attached, reference.name);
    attached.turnId = reference.turnId;
    attached.messageId = reference.messageId;
    attachments.splice(attachments.indexOf(reference), 1);
    const raised = issues.findIndex((item) => item.sourceLocator === reference.sourceLocator);
    if (raised >= 0) issues.splice(raised, 1);
  }
  // An internal name left over starts with the account's id ("user-<id>_<hex>_mnt_data_…"): keep only
  // the part after it, so the id never reaches a file name or the hand-off text.
  for (const file of attachments) {
    const at = file.name.lastIndexOf('_mnt_data_');
    if (at >= 0 && file.name.length > at + 10) rename(file, file.name.slice(at + 10));
  }
}
