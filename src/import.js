/** Isolated ChatGPT export adapter. Reads the caller's selected data; never fetches history. */
import { LIMITS, validateConversation } from './model.js';
import { isInternalMessage } from './message-visibility.js';
import { readableMarkdown } from './chatgpt-markup.js';
import {
  graphInfo,
  identity,
  isRecord,
  isTurn,
  locator,
  readExport,
  titleOf,
  walk,
} from './export-graph.js';
import {
  citationMarks,
  citationSources,
  messageCitations,
  numberCitations,
} from './export-citations.js';
import { attachmentList, sandboxLinks, settleAttachments } from './export-files.js';

const encoder = new TextEncoder();

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
  // Assistant messages folded into the turn before them: message id → turn id.
  const foldedInto = new Map();
  // Inline citation marks across the whole branch: the links each resolves to, or null.
  const slots = [];
  let excludedMessages = 0;
  let textBytes = 0;
  const issue = (code, message, sourceLocator) =>
    issues.push({ code, message, ...(sourceLocator ? { sourceLocator } : {}) });
  const { list: attachments, add: addAttachment } = attachmentList(issue);
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
    const sources = citationSources(metadata, base);
    const raw = parts.join('\n\n');
    const marker = citationMarks(raw, sources, slots);
    // Assistant text carries ChatGPT's rendering markup; the hand-off reads like its Copy button.
    const readable =
      role === 'assistant' && content.content_type !== 'code'
        ? readableMarkdown(raw, marker.mark)
        : { markdown: raw, cites: [], omitted: 0 };
    const { markdown, marks } = marker.extract(readable.markdown);
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
    for (const link of sandboxLinks(markdown))
      addAttachment(
        { id: link.id, name: link.name },
        `${base}.message.content:text-offset-${link.offset}`,
        nodeId,
      );
    const citations = messageCitations(metadata, base, readable.cites, sources, issue);
    if (readable.omitted)
      issue(
        'omitted-inline-content',
        'Inline images or widgets from the original turn are not included. Review it if they matter.',
        `${base}.message.content`,
      );
    // A file reference leaves the text whole; the file itself is accounted for under Files.
    const contentFidelity = issues
      .slice(beforeIssues)
      .some((issue) => !issue.code.startsWith('attachment-'))
      ? 'partial'
      : 'original-markdown';
    // One turn per exchange: assistant messages in a row (a note before a tool call, the answer
    // after it) are one turn, in source order. Structured code keeps its own turn.
    const previous = turns.at(-1);
    if (role === 'assistant' && previous?.role === 'assistant' && !code && !previous.code) {
      const offset =
        previous.markdown && markdown ? previous.markdown.length + 2 : previous.markdown.length;
      previous.marks.push(...marks.map((item) => ({ ...item, at: item.at + offset })));
      previous.markdown = [previous.markdown, markdown].filter(Boolean).join('\n\n');
      previous.originalParts.push(...parts);
      previous.sourceLocators.push(`${base}.message`);
      previous.citations.push(...citations);
      if (contentFidelity === 'partial') previous.contentFidelity = 'partial';
      foldedInto.set(nodeId, previous.id);
      continue;
    }
    turns.push({
      id: nodeId,
      role,
      markdown,
      originalParts: parts,
      sourceLocators: [`${base}.message`],
      contentFidelity,
      citations,
      marks,
      ...(code ? { code } : {}),
    });
  }
  settleAttachments(attachments, issues, foldedInto);
  for (const turn of turns) {
    Object.assign(turn, numberCitations(turn, turn.marks, slots));
    delete turn.marks;
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
