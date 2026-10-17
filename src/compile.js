import { importBrowserResponse } from './chatgpt-response.js';
import { validateConversation } from './model.js';
import { describeTurns, labelText, projectMarkdown } from './projection.js';
import { sha256Hex } from './sha256.js';

export const MAX_MARKDOWN = 16 * 1024 * 1024;

/**
 * The hand-off text for a model, or for some of its turns (`turnIds`, with a scope `note`), plus what
 * the app needs to point file lines at local copies. Line numbers are those of this text.
 */
export function handoff(model, { turnIds = null, note = '' } = {}) {
  const lines = {};
  const markdown = projectMarkdown(model, lines, { turnIds, note });
  const { selection } = lines;
  const turnNumber = new Map(model.turns.map((turn, index) => [turn.id, index + 1]));
  if (new TextEncoder().encode(markdown).byteLength > MAX_MARKDOWN)
    throw new Error('This conversation exceeds the 16 MiB context limit.');
  const fileChecks = selection.verification.issues.filter((issue) =>
    issue.code.startsWith('attachment-'),
  );
  return {
    markdown,
    title: model.source.title,
    turns: model.turns.length,
    selectedTurns: selection.turns.length,
    files: selection.attachments.length,
    // For each file: the page's id for it (file id or sandbox path) and its message, to fetch it;
    // the line numbers of its file line and of its "download this file" check, to point them at a copy.
    attachments: selection.attachments.map((file) => {
      const check = fileChecks.find((issue) => issue.sourceLocator === file.sourceLocator);
      return {
        key: file.id,
        id: file.id.slice(file.id.indexOf(':') + 1),
        name: file.name,
        label: labelText(file.name),
        turn: turnNumber.get(file.turnId) ?? 0,
        messageId: file.messageId ?? '',
        line: lines.files.get(file.id),
        check: check ? lines.checks.get(check.message) : -1,
      };
    }),
    // Whether the hand-off would be verified if every file were available locally.
    verifiedWithFiles:
      selection.verification.status === 'partial' &&
      validateConversation({
        ...model,
        turns: selection.turns,
        // As if each file had been saved: a placeholder local id and digest stand in for the copy.
        attachments: selection.attachments.map((file) => ({
          ...file,
          status: 'available',
          localFileId: 'saved',
          sha256: '0'.repeat(64),
        })),
        verification: {
          status: 'verified',
          issues: selection.verification.issues.filter((issue) => !fileChecks.includes(issue)),
        },
      }).verification.status === 'verified',
    verification: selection.verification.status,
    issues: [...new Set(selection.verification.issues.map((issue) => issue.message))].slice(0, 5),
    // How many of each content check, by code only: what diagnostics may record about the text.
    checks: selection.verification.issues.reduce(
      (counts, { code }) => Object.assign(counts, { [code]: (counts[code] ?? 0) + 1 }),
      {},
    ),
  };
}

/** The validated model of one observed conversation response. */
export function compileModel(packet) {
  return importBrowserResponse(packet.body, packet);
}

/** One observed conversation response to the Markdown handed to a composer, plus what the panel shows. */
export function compile(packet, model = compileModel(packet)) {
  // Per turn, for choosing turns and for telling what was added before: id, role, position, preview,
  // file keys and the SHA-256 of the turn's projected body.
  return { ...handoff(model), turnList: describeTurns(model, sha256Hex) };
}
