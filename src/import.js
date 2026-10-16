/** Isolated ChatGPT export adapter. Reads the caller's selected data; never fetches history. */
import { LIMITS, safeUrl, validateConversation } from './model.js';
import { isInternalMessage } from './message-visibility.js';
import { readableMarkdown } from './chatgpt-markup.js';

const encoder = new TextEncoder();
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const identity = (value) =>
  typeof value === 'string' &&
  value.trim() &&
  value.length <= 512 &&
  !/[\u0000-\u001f\u007f]/u.test(value);

function readExport(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    if (encoder.encode(raw).byteLength > LIMITS.maxImportBytes)
      throw new RangeError(
        'Export exceeds 64 MiB. Select a smaller export or an individual conversation JSON.',
      );
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new TypeError(
        'This file is not valid JSON. Choose conversations.json from your ChatGPT export.',
      );
    }
  }
  const conversations = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && isRecord(parsed.mapping)
      ? [parsed]
      : null;
  if (!conversations || conversations.length > LIMITS.maxConversations)
    throw new TypeError(
      'Expected a ChatGPT conversations.json array with at most 10,000 conversations.',
    );
  const ids = new Set();
  for (const item of conversations) {
    if (!isRecord(item) || !identity(item.id ?? item.conversation_id) || !isRecord(item.mapping))
      throw new TypeError('Export contains an invalid conversation ID or message mapping.');
    const id = item.id ?? item.conversation_id;
    if (ids.has(id))
      throw new TypeError(
        'Export contains duplicate conversation IDs; selection would be ambiguous.',
      );
    ids.add(id);
    if (Object.keys(item.mapping).length > LIMITS.maxNodes)
      throw new RangeError('A conversation exceeds the 20,000-node limit.');
  }
  return conversations;
}

function locator(index, nodeId) {
  return `conversations[${index}].mapping[${JSON.stringify(nodeId)}]`;
}
function titleOf(conversation) {
  if (typeof conversation.title !== 'string' || !conversation.title.trim())
    return 'Untitled conversation';
  return conversation.title.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 500);
}

function graphInfo(conversation, index) {
  const entries = Object.entries(conversation.mapping);
  const parents = new Set();
  const declaredChildren = new Map();
  const defects = new Map();
  const report = (code, message, nodeId) => {
    if (defects.has(code)) {
      defects.get(code).count += 1;
      return;
    }
    defects.set(code, {
      code,
      message,
      sourceLocator: identity(nodeId) ? locator(index, nodeId) : `conversations[${index}].mapping`,
      count: 1,
    });
  };
  let edges = 0;
  let roots = 0;
  for (const [nodeId, node] of entries) {
    if (!identity(nodeId))
      report(
        'branch-invalid-id',
        'The branch inventory contains an invalid node ID. Re-export this conversation to recover its variants.',
        nodeId,
      );
    if (!isRecord(node)) {
      report(
        'branch-invalid-node',
        'A branch node is missing or malformed. Re-export this conversation to recover its variants.',
        nodeId,
      );
      continue;
    }
    if (own(node, 'id') && node.id !== nodeId)
      report(
        'branch-id-mismatch',
        'A node ID contradicts its mapping key. Re-export this conversation to verify its variants.',
        nodeId,
      );
    if (node.parent === null) roots += 1;
    else if (!identity(node.parent))
      report(
        'branch-invalid-parent',
        'A branch parent is missing or invalid. Re-export this conversation to recover its variants.',
        nodeId,
      );
    else {
      parents.add(node.parent);
      if (!own(conversation.mapping, node.parent) || !isRecord(conversation.mapping[node.parent]))
        report(
          'branch-missing-parent',
          'A branch references a missing parent. Re-export this conversation to recover its variants.',
          nodeId,
        );
    }
    if (node.message === null && node.parent === null) {
      /* An explicit null root is the export's structural sentinel. */
    } else if (!isRecord(node.message))
      report(
        'branch-missing-message',
        'A branch node has missing or malformed message data. Re-export this conversation to recover its variants.',
        nodeId,
      );
    else if (!['user', 'assistant', 'system', 'tool'].includes(node.message.author?.role))
      report(
        'branch-unknown-role',
        'A branch message has a missing or unknown role. Re-export this conversation to recover its variants.',
        nodeId,
      );
    if (!own(node, 'children')) continue;
    if (!Array.isArray(node.children)) {
      report(
        'branch-invalid-children',
        'A branch child list is malformed. Re-export this conversation to recover its variants.',
        nodeId,
      );
      continue;
    }
    const children = new Set();
    declaredChildren.set(nodeId, children);
    const remaining = Math.max(0, LIMITS.maxNodes * 2 - edges);
    if (node.children.length > remaining)
      report(
        'branch-edge-limit',
        'The branch inventory exceeds the supported link limit. Some variants could not be checked; re-export this conversation.',
        nodeId,
      );
    for (
      let childIndex = 0;
      childIndex < Math.min(node.children.length, remaining);
      childIndex += 1
    ) {
      edges += 1;
      const childId = node.children[childIndex];
      if (!identity(childId)) {
        report(
          'branch-invalid-child',
          'A branch child ID is invalid. Re-export this conversation to recover its variants.',
          nodeId,
        );
        continue;
      }
      if (children.has(childId))
        report(
          'branch-duplicate-child',
          'A branch repeats a child reference. Re-export this conversation to verify its variants.',
          nodeId,
        );
      children.add(childId);
      if (!own(conversation.mapping, childId) || !isRecord(conversation.mapping[childId]))
        report(
          'branch-missing-child',
          'A listed branch child is missing. The branch inventory is incomplete; re-export this conversation to recover its variants.',
          nodeId,
        );
      else if (conversation.mapping[childId].parent !== nodeId)
        report(
          'branch-parent-mismatch',
          'A child reference contradicts that node’s parent. Re-export this conversation to verify its variants.',
          nodeId,
        );
    }
  }
  if (roots !== 1)
    report(
      'branch-root-count',
      'The export does not have exactly one root. Its branch inventory may be incomplete; re-export this conversation.',
      entries[0]?.[0],
    );
  for (const [nodeId, node] of entries) {
    if (
      isRecord(node) &&
      declaredChildren.has(node.parent) &&
      !declaredChildren.get(node.parent).has(nodeId)
    )
      report(
        'branch-child-omission',
        'A parent’s child list omits a node that names it as parent. Re-export this conversation to verify its variants.',
        nodeId,
      );
  }
  // A parent chain has one outgoing edge per node. Memoizing each chain avoids walking
  // a shared 5,000-turn prefix once for every alternative leaf (quadratic work).
  const turnCounts = new Map();
  for (const [nodeId] of entries) {
    if (turnCounts.has(nodeId)) continue;
    const chain = [];
    const positions = new Map();
    let cursor = nodeId;
    while (
      identity(cursor) &&
      own(conversation.mapping, cursor) &&
      isRecord(conversation.mapping[cursor]) &&
      !turnCounts.has(cursor)
    ) {
      if (positions.has(cursor)) {
        const cycle = chain.slice(positions.get(cursor));
        const count = cycle.reduce(
          (total, key) => total + Number(isTurn(conversation.mapping[key])),
          0,
        );
        for (const key of cycle) turnCounts.set(key, Math.min(count, LIMITS.maxTurns));
        report(
          'branch-cycle',
          'A branch contains a cycle. Its order and variant inventory are incomplete; re-export this conversation.',
          cursor,
        );
        break;
      }
      positions.set(cursor, chain.length);
      chain.push(cursor);
      cursor = conversation.mapping[cursor].parent;
    }
    let count = turnCounts.get(cursor) ?? 0;
    for (let chainIndex = chain.length - 1; chainIndex >= 0; chainIndex -= 1) {
      const key = chain[chainIndex];
      if (turnCounts.has(key)) {
        count = turnCounts.get(key);
        continue;
      }
      count = Math.min(count + Number(isTurn(conversation.mapping[key])), LIMITS.maxTurns);
      turnCounts.set(key, count);
    }
  }
  let leafIds = entries.filter(([key]) => identity(key) && !parents.has(key)).map(([key]) => key);
  const currentNode = identity(conversation.current_node) ? conversation.current_node : null;
  if (own(conversation, 'current_node') && !currentNode)
    report(
      'branch-invalid-current',
      'The exported current branch is invalid. Choose a known branch and re-export to verify the current selection.',
      entries[0]?.[0],
    );
  if (currentNode && !own(conversation.mapping, currentNode))
    report(
      'branch-missing-current',
      'The exported current branch is missing. Re-export this conversation to recover it.',
      currentNode,
    );
  if (currentNode && !leafIds.includes(currentNode)) leafIds.push(currentNode);
  // A cyclic damaged export still needs an addressable selection to produce a precise error.
  if (!leafIds.length && entries.length)
    leafIds = entries
      .filter(([key]) => identity(key))
      .slice(-1)
      .map(([key]) => key);
  const issues = [...defects.values()].map(({ count, ...defect }) => ({
    ...defect,
    message: `${defect.message}${count > 1 ? ` (${count} occurrences.)` : ''}`,
  }));
  return { leafIds, currentNode, issues, turnCounts };
}

function walk(conversation, leafId, index) {
  const path = [];
  const issues = [];
  const visited = new Set();
  let cursor = leafId;
  while (cursor !== null && cursor !== undefined) {
    if (!identity(cursor)) {
      issues.push({
        code: 'invalid-parent',
        message:
          'A parent ID is invalid. Re-export this conversation to recover the missing turns.',
      });
      break;
    }
    if (visited.has(cursor)) {
      issues.push({
        code: 'cycle',
        message:
          'The selected branch contains a cycle. Re-export this conversation before transferring it.',
        sourceLocator: locator(index, cursor),
      });
      break;
    }
    if (!own(conversation.mapping, cursor) || !isRecord(conversation.mapping[cursor])) {
      issues.push({
        code: 'missing-parent',
        message: `A referenced turn (${cursor}) is missing. Re-export this conversation to recover it.`,
        sourceLocator: locator(index, cursor),
      });
      break;
    }
    visited.add(cursor);
    const node = conversation.mapping[cursor];
    path.push({ id: cursor, node });
    if (path.length > LIMITS.maxNodes)
      throw new RangeError('Selected branch exceeds the node limit.');
    if (!own(node, 'parent')) {
      issues.push({
        code: 'missing-parent-field',
        message: 'A turn has no parent field. Re-export this conversation to verify its order.',
        sourceLocator: locator(index, cursor),
      });
      break;
    }
    cursor = node.parent;
  }
  path.reverse();
  return { path, issues };
}

function isTurn(node) {
  return (
    isRecord(node.message) &&
    !isInternalMessage(node.message) &&
    ['user', 'assistant'].includes(node.message.author?.role)
  );
}

/** Return only selection metadata. No turn text, attachment data, or whole-export archive escapes this function. */
export function listConversations(raw) {
  return readExport(raw).map((conversation, index) => {
    const { leafIds, currentNode, issues } = graphInfo(conversation, index);
    return {
      id: conversation.id ?? conversation.conversation_id,
      title: titleOf(conversation),
      turnCount: Object.values(conversation.mapping).filter(
        (node) => isRecord(node) && isTurn(node),
      ).length,
      leafIds,
      currentNode,
      branchCount: leafIds.length,
      branchInventory: issues.length ? 'partial' : 'complete',
      inventoryIssues: issues,
    };
  });
}

function attachmentName(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value
    .replace(/[\\/\u0000-\u001f\u007f]/gu, '_')
    .slice(0, 255)
    .replace(/^\.{1,2}$/u, '_');
}

/** Import one selected export conversation and its current_node path (or an explicitly selected leaf ID). */
export function importConversation(raw, id, leafId) {
  const conversations = readExport(raw);
  const index = conversations.findIndex((item) => (item.id ?? item.conversation_id) === id);
  if (index < 0) throw new TypeError('Selected conversation was not found in this export.');
  const conversation = conversations[index];
  const graph = graphInfo(conversation, index);
  let selectedLeaf = leafId ?? graph.currentNode;
  let selection =
    leafId !== undefined ? 'explicit' : graph.currentNode ? 'current-node' : 'single-path';
  if (!selectedLeaf) {
    if (graph.leafIds.length !== 1)
      throw new TypeError(
        'This conversation has multiple branches and no current selection. Choose a branch first.',
      );
    selectedLeaf = graph.leafIds[0];
  }
  if (!identity(selectedLeaf) || !graph.leafIds.includes(selectedLeaf))
    throw new TypeError(
      'Selected branch is not a leaf or the exported current node. Choose one of the listed branches.',
    );
  const { path, issues } = walk(conversation, selectedLeaf, index);
  issues.push(...graph.issues);
  const lastVisibleTurnId = path.findLast(({ node }) => isTurn(node))?.id;
  const turns = [];
  let excludedMessages = 0;
  const attachments = [];
  const attachmentKeys = new Set();
  let textBytes = 0;
  const issue = (code, message, sourceLocator) =>
    issues.push({ code, message, ...(sourceLocator ? { sourceLocator } : {}) });
  const addAttachment = (item, sourceLocator, turnId) => {
    if (!isRecord(item)) return false;
    const pointer = item.asset_pointer ?? item.id ?? item.file_id ?? item.url ?? item.download_url;
    if (typeof pointer !== 'string' || !pointer.length) return false;
    // File identifiers are data. Never turn private asset pointers into requests or filesystem paths.
    const attachmentId =
      pointer.length <= 450 && identity(pointer) ? pointer : `attachment-${attachments.length + 1}`;
    const dedupeKey = `${turnId ?? ''}\u0000${pointer}`;
    if (attachmentKeys.has(dedupeKey)) return true;
    attachmentKeys.add(dedupeKey);
    if (attachments.length >= LIMITS.maxAttachments)
      throw new RangeError('Conversation exceeds the 1,000 attachment limit.');
    const explicitStatus = item.status;
    const status =
      explicitStatus === 'expired' || item.expired === true
        ? 'expired'
        : explicitStatus === 'inaccessible'
          ? 'inaccessible'
          : 'download-needed';
    const result = {
      id: `${attachments.length + 1}:${attachmentId}`,
      name: attachmentName(item.name ?? item.filename, `Attachment ${attachments.length + 1}`),
      sourceLocator,
      status,
    };
    if (turnId) result.turnId = turnId;
    const url = safeUrl(item.download_url ?? item.url);
    if (url) result.url = url;
    if (typeof (item.mime_type ?? item.media_type) === 'string')
      result.mediaType = (item.mime_type ?? item.media_type).slice(0, 200);
    if (Number.isSafeInteger(item.size) && item.size >= 0 && item.size <= LIMITS.maxAttachmentBytes)
      result.size = item.size;
    attachments.push(result);
    issue(
      `attachment-${status}`,
      `${result.name}: ${status === 'expired' ? 'the exported download has expired; reopen the source and request a fresh file.' : status === 'inaccessible' ? 'open the original conversation to check access, then download the file normally.' : 'download this file from the original conversation and select it separately; this export contains a reference only.'}`,
      sourceLocator,
    );
    return true;
  };
  for (const { id: nodeId, node } of path) {
    const base = locator(index, nodeId);
    if (node.message === null || node.message === undefined) {
      if (node.parent !== null || node.message !== null)
        issue(
          'missing-message',
          'A branch node contains no message. Re-export the conversation to verify that no turn is missing.',
          base,
        );
      continue;
    }
    if (!isRecord(node.message)) {
      issue(
        'invalid-message',
        'A message is malformed. Re-export the conversation to recover it.',
        base,
      );
      continue;
    }
    const message = node.message;
    if (isInternalMessage(message)) {
      excludedMessages++;
      continue;
    }
    const role = message.author?.role;
    const included = ['user', 'assistant'].includes(role);
    if (!included && !['system', 'tool'].includes(role))
      issue(
        'unknown-role',
        'A message has an unknown role and could not be represented as a user or assistant turn.',
        `${base}.message.author`,
      );
    const metadata = isRecord(message.metadata) ? message.metadata : {};
    if (Array.isArray(metadata.attachments))
      metadata.attachments.forEach((item, attachmentIndex) => {
        if (
          !addAttachment(
            item,
            `${base}.message.metadata.attachments[${attachmentIndex}]`,
            included ? nodeId : undefined,
          )
        )
          issue(
            'unknown-attachment',
            'An attachment reference is incomplete. Open the original conversation to recover the file.',
            `${base}.message.metadata.attachments[${attachmentIndex}]`,
          );
      });
    if (!included) {
      if (role === 'tool' && Array.isArray(message.content?.parts))
        message.content.parts.forEach((part, partIndex) =>
          addAttachment(part, `${base}.message.content.parts[${partIndex}]`),
        );
      continue;
    }
    if (turns.length >= LIMITS.maxTurns)
      throw new RangeError('Selected conversation exceeds the 5,000-turn limit.');
    const beforeIssues = issues.length;
    const content = isRecord(message.content) ? message.content : {};
    const parts = [];
    if (Array.isArray(content.parts)) {
      for (const [partIndex, part] of content.parts.entries()) {
        const partLocator = `${base}.message.content.parts[${partIndex}]`;
        if (typeof part === 'string') parts.push(part);
        else if (isRecord(part) && part.content_type === 'text' && typeof part.text === 'string')
          parts.push(part.text);
        else {
          addAttachment(part, partLocator, nodeId);
          issue(
            'nontext-content',
            'A non-text content part is not represented as Markdown. Review it in the original conversation before transferring.',
            partLocator,
          );
        }
      }
      if (!['text', 'multimodal_text', 'code', undefined].includes(content.content_type))
        issue(
          'unknown-content-type',
          `Content type ${String(content.content_type).slice(0, 100)} may contain fields outside its text parts. Review the original turn.`,
          `${base}.message.content`,
        );
    } else if (typeof content.text === 'string') {
      parts.push(content.text);
      if (!['text', 'code'].includes(content.content_type))
        issue(
          'unknown-content-type',
          'Only the text field of an unfamiliar content type was recovered. Review the original turn.',
          `${base}.message.content`,
        );
    } else
      issue(
        'missing-content',
        'This turn has no supported text content. Open the original conversation to recover it.',
        `${base}.message.content`,
      );
    // Assistant text carries ChatGPT's rendering markup; the hand-off reads like its Copy button.
    const readable =
      role === 'assistant' && content.content_type !== 'code'
        ? readableMarkdown(parts.join('\n\n'))
        : { markdown: parts.join('\n\n'), cites: [], omitted: 0 };
    const markdown = readable.markdown;
    let code;
    if (content.content_type === 'code') {
      code = {
        language: typeof content.language === 'string' ? content.language : '',
        sourceText: markdown,
      };
      issue(
        'structured-code',
        'This turn contains structured code, preserved with its language and original text. The Markdown projection adds a code fence; review the original turn for full presentation fidelity.',
        `${base}.message.content`,
      );
      if (content.language !== undefined && typeof content.language !== 'string')
        issue(
          'unknown-code-language',
          'The code language field has an unsupported structure. Its text was recovered; review the original turn to identify the language.',
          `${base}.message.content.language`,
        );
      if (
        Array.isArray(content.parts) &&
        typeof content.text === 'string' &&
        content.text !== markdown
      )
        issue(
          'conflicting-code-text',
          'The code text field differs from its text parts. The parts were preserved; review the original turn to recover the alternate representation.',
          `${base}.message.content.text`,
        );
    }
    if (!markdown.trim())
      issue(
        'empty-text',
        'This turn contains no supported text. Open the original turn to check for omitted content before transferring.',
        `${base}.message.content`,
      );
    textBytes += encoder.encode(markdown).byteLength;
    if (textBytes > LIMITS.maxTextBytes)
      throw new RangeError('Selected conversation exceeds the 8 MiB text limit.');
    if (typeof message.status !== 'string' || !message.status)
      issue(
        'unknown-turn-status',
        'This turn has no supported completion status. Open the original conversation to check whether the response finished, then export again.',
        `${base}.message.status`,
      );
    else if (message.status !== 'finished_successfully')
      issue(
        'unfinished-turn',
        `This turn has status ${message.status.slice(0, 100)}. Wait for the response to finish, then export again.`,
        `${base}.message.status`,
      );
    else if (nodeId === lastVisibleTurnId && role === 'assistant' && message.end_turn === false)
      issue(
        'unfinished-turn',
        'The last assistant turn is marked unfinished. Wait for the response to finish, then export again.',
        `${base}.message.end_turn`,
      );
    if (['interrupted', 'max_tokens'].includes(metadata.finish_details?.type))
      issue(
        'unfinished-turn',
        'The source reports that this answer was interrupted or reached its length limit. Review it before handing off.',
        `${base}.message.metadata.finish_details`,
      );
    // Generated download links often appear only in Markdown. Keep the exact link in text,
    // but record that its bytes were not in this export. Never resolve a sandbox path locally.
    for (const match of markdown.matchAll(/sandbox:\/[^\s<>"')\]]+/gu)) {
      let name = match[0].split('/').at(-1);
      try {
        name = decodeURIComponent(name);
      } catch {
        /* Keep malformed URI text as a display name. */
      }
      addAttachment(
        { id: match[0], name },
        `${base}.message.content:text-offset-${match.index}`,
        nodeId,
      );
    }
    const citations = [];
    const seenCitations = new Set();
    const addCitation = (url, title, sourceLocator) => {
      if (seenCitations.has(url)) return;
      seenCitations.add(url);
      if (citations.length >= 1000)
        throw new RangeError('A turn exceeds the 1,000-citation limit.');
      citations.push({
        url,
        title: typeof title === 'string' ? title.slice(0, 2000) || url : url,
        sourceLocator,
      });
    };
    const citationContainers = [
      'items',
      'sources',
      'citations',
      'safe_urls',
      'metadata',
      'fallback_items',
      'supporting_websites',
    ];
    // Source fields that hold no links of their own: reference ids, quoted spans, thumbnails.
    const citationDetails = [
      'refs',
      'ref_id',
      'attribution_segments',
      'attributions',
      'extra',
      'thumbnail_url',
    ];
    // content_references entries that only shape the rendered text, never a source link.
    const linklessReferences = ['hidden', 'entity', 'image_group'];
    let citationNodes = 0;
    let citationLimitReported = false;
    const citationLimit = (path) => {
      if (citationLimitReported) return;
      citationLimitReported = true;
      issue(
        'truncated-citations',
        'Citation metadata exceeds the supported size or depth. Some sources may be missing; review the original turn.',
        path,
      );
    };
    const collectCitations = (value, path, depth = 0) => {
      citationNodes += 1;
      if (depth > 6 || citationNodes > 10000) {
        citationLimit(path);
        return;
      }
      if (typeof value === 'string') {
        const url = safeUrl(value);
        if (url) addCitation(url, url, path);
        else
          issue(
            'unrecognized-citation',
            'A source reference is not a supported HTTP(S) link. Review the original turn to recover it.',
            path,
          );
        return;
      }
      if (!value || typeof value !== 'object') {
        issue(
          'unrecognized-citation',
          'A source reference has an unsupported structure. Review the original turn to recover it.',
          path,
        );
        return;
      }
      if (Array.isArray(value)) {
        if (value.length > 1000) citationLimit(path);
        value
          .slice(0, 1000)
          .forEach((child, i) => collectCitations(child, `${path}[${i}]`, depth + 1));
        return;
      }
      if (linklessReferences.includes(value.type)) return;
      const linkKeys = ['url', 'href'].filter((key) => own(value, key));
      for (const key of linkKeys) {
        const url = safeUrl(value[key]);
        if (url) addCitation(url, value.title, `${path}.${key}`);
        else
          issue(
            'unrecognized-citation',
            'A source URL could not be represented as a safe HTTP(S) link. Review the original turn to recover it.',
            `${path}.${key}`,
          );
      }
      const containers = citationContainers.filter((key) => own(value, key) && value[key] !== null);
      if (!linkKeys.length && !containers.length)
        issue(
          'unrecognized-citation',
          'Citation metadata has an unfamiliar structure. Its links may be missing; review the original turn.',
          path,
        );
      else if (
        Object.entries(value).some(
          ([key, child]) =>
            !['url', 'href', 'title', ...citationContainers, ...citationDetails].includes(key) &&
            ((child !== null && typeof child === 'object') || safeUrl(child)),
        )
      ) {
        issue(
          'unrecognized-citation',
          'Citation metadata contains an unfamiliar source field. Some links may be missing; review the original turn.',
          path,
        );
      }
      for (const key of containers) collectCitations(value[key], `${path}.${key}`, depth + 1);
    };
    for (const key of ['citations', 'content_references'])
      if (metadata[key] !== undefined && metadata[key] !== null)
        collectCitations(metadata[key], `${base}.message.metadata.${key}`);
    // An inline citation is resolved when the content reference that replaces its exact text has
    // a link, or when every source id it names (turn, type, index) is a known search result.
    const referenceId = (value) =>
      typeof value === 'string'
        ? value
        : isRecord(value) &&
            Number.isSafeInteger(value.turn_index) &&
            typeof value.ref_type === 'string' &&
            Number.isSafeInteger(value.ref_index)
          ? `turn${value.turn_index}${value.ref_type}${value.ref_index}`
          : null;
    const linkedText = new Set();
    const sourceById = new Map();
    const noteSource = (entry, ids, sourceLocator) => {
      const url = isRecord(entry) && safeUrl(entry.url);
      if (!url || !Array.isArray(ids)) return;
      for (const id of ids.map(referenceId))
        if (id && !sourceById.has(id))
          sourceById.set(id, { url, title: entry.title, sourceLocator });
    };
    if (Array.isArray(metadata.content_references))
      metadata.content_references.forEach((reference, referenceIndex) => {
        if (!isRecord(reference)) return;
        const path = `${base}.message.metadata.content_references[${referenceIndex}]`;
        const items = Array.isArray(reference.items) ? reference.items : [];
        noteSource(reference, reference.refs, path);
        items.forEach((item, itemIndex) =>
          noteSource(item, item?.refs, `${path}.items[${itemIndex}]`),
        );
        const links = [
          reference.url,
          ...items.map((item) => item?.url),
          ...(Array.isArray(reference.sources) ? reference.sources.map((item) => item?.url) : []),
          ...(Array.isArray(reference.safe_urls) ? reference.safe_urls : []),
        ];
        if (
          typeof reference.matched_text === 'string' &&
          !linklessReferences.includes(reference.type) &&
          links.some(safeUrl)
        )
          linkedText.add(reference.matched_text);
      });
    if (Array.isArray(metadata.search_result_groups))
      metadata.search_result_groups.forEach((group, groupIndex) => {
        if (isRecord(group) && Array.isArray(group.entries))
          group.entries.forEach((entry, entryIndex) =>
            noteSource(
              entry,
              [entry?.ref_id],
              `${base}.message.metadata.search_result_groups[${groupIndex}].entries[${entryIndex}]`,
            ),
          );
      });
    let unresolved = false;
    for (const cite of readable.cites) {
      if (linkedText.has(cite.marker)) continue;
      const sources = cite.refs.map((id) => sourceById.get(id));
      if (!sources.length || sources.includes(undefined)) unresolved = true;
      else
        for (const source of sources) addCitation(source.url, source.title, source.sourceLocator);
    }
    if (unresolved)
      issue(
        'unresolved-citations',
        'Some inline citations could not be matched to a source link. Recovered links are included; review the original turn to verify each citation.',
        `${base}.message.content`,
      );
    if (readable.omitted)
      issue(
        'omitted-inline-content',
        'Inline images or widgets from the original turn are not included. Review it if they matter.',
        `${base}.message.content`,
      );
    turns.push({
      id: nodeId,
      role,
      markdown,
      originalParts: parts,
      sourceLocator: `${base}.message`,
      // A file reference leaves the text whole; the file itself is accounted for under Files.
      contentFidelity: issues
        .slice(beforeIssues)
        .some((issue) => !issue.code.startsWith('attachment-'))
        ? 'partial'
        : 'original-markdown',
      citations,
      ...(code ? { code } : {}),
    });
  }
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
    const own = issues.find((item) => item.sourceLocator === attached.sourceLocator);
    if (own) own.message = own.message.replace(attached.name, reference.name);
    attached.turnId = reference.turnId;
    attached.name = reference.name;
    attachments.splice(attachments.indexOf(reference), 1);
    const raised = issues.findIndex((item) => item.sourceLocator === reference.sourceLocator);
    if (raised >= 0) issues.splice(raised, 1);
  }
  // An internal name left over starts with the account's id ("user-<id>_<hex>_mnt_data_…"): keep only
  // the part after it, so the id never reaches a file name or the hand-off text.
  for (const file of attachments) {
    const at = file.name.lastIndexOf('_mnt_data_');
    if (at >= 0 && file.name.length > at + 10) {
      const name = file.name.slice(at + 10);
      const own = issues.find((item) => item.sourceLocator === file.sourceLocator);
      if (own) own.message = own.message.replace(file.name, name);
      file.name = name;
    }
  }
  if (!turns.length)
    issue(
      'no-turns',
      'No user or assistant text turns were recovered. Choose another branch or re-export the conversation.',
    );
  return validateConversation({
    schemaVersion: 1,
    source: {
      type: 'chatgpt-export',
      id,
      title: titleOf(conversation),
      url: `https://chatgpt.com/c/${encodeURIComponent(id)}`,
      locator: `conversations[${index}]`,
      ...(excludedMessages ? { excludedMessages } : {}),
    },
    turns,
    branches: {
      selectedLeaf,
      selection,
      availableLeaves: graph.leafIds.map((branchId) => ({
        id: branchId,
        turnCount: graph.turnCounts.get(branchId) ?? 0,
      })),
    },
    verification: { status: issues.length ? 'partial' : 'verified', issues },
    attachments,
  });
}
