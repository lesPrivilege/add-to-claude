/** The ChatGPT export's shape: reading the file, its message graph, and one branch's path. */
import { LIMITS } from './model.js';
import { isInternalMessage } from './message-visibility.js';

const encoder = new TextEncoder();
export const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
export const isRecord = (value) =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
export const identity = (value) =>
  typeof value === 'string' &&
  value.trim() &&
  value.length <= 512 &&
  !/[\u0000-\u001f\u007f]/u.test(value);

export function readExport(raw) {
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

export function locator(index, nodeId) {
  return `conversations[${index}].mapping[${JSON.stringify(nodeId)}]`;
}
export function titleOf(conversation) {
  if (typeof conversation.title !== 'string' || !conversation.title.trim())
    return 'Untitled conversation';
  return conversation.title.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 500);
}

export function graphInfo(conversation, index) {
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

export function walk(conversation, leafId, index) {
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

export function isTurn(node) {
  return (
    isRecord(node.message) &&
    !isInternalMessage(node.message) &&
    ['user', 'assistant'].includes(node.message.author?.role)
  );
}
