import { importBrowserResponse } from './chatgpt-response.js';
import { labelText, projectMarkdown, validateConversation } from './model.js';

export const MAX_MARKDOWN = 16 * 1024 * 1024;

/** One observed conversation response to the Markdown handed to a composer, plus what the panel shows. */
export function compile(packet) {
  const model = importBrowserResponse(packet.body, packet);
  const lines = {};
  const markdown = projectMarkdown(model, lines);
  const turnNumber = new Map(model.turns.map((turn, index) => [turn.id, index + 1]));
  if (new TextEncoder().encode(markdown).byteLength > MAX_MARKDOWN)
    throw new Error('This conversation exceeds the 16 MiB context limit.');
  const fileChecks = model.verification.issues.filter((issue) =>
    issue.code.startsWith('attachment-'),
  );
  return {
    markdown,
    title: model.source.title,
    turns: model.turns.length,
    files: model.attachments.length,
    // For each file: the page's id for it (file id or sandbox path) and its message, to fetch it;
    // the line numbers of its file line and of its "download this file" check, to point them at a copy.
    attachments: model.attachments.map((file) => {
      const check = fileChecks.find((issue) => issue.sourceLocator === file.sourceLocator);
      return {
        key: file.id,
        id: file.id.slice(file.id.indexOf(':') + 1),
        name: file.name,
        label: labelText(file.name),
        turn: turnNumber.get(file.turnId) ?? 0,
        messageId: file.turnId ?? '',
        line: lines.files.get(file.id),
        check: check ? lines.checks.get(check.message) : -1,
      };
    }),
    // Whether the hand-off would be verified if every file were available locally.
    verifiedWithFiles:
      model.verification.status === 'partial' &&
      validateConversation({
        ...model,
        // As if each file had been saved: a placeholder local id and digest stand in for the copy.
        attachments: model.attachments.map((file) => ({
          ...file,
          status: 'available',
          localFileId: 'saved',
          sha256: '0'.repeat(64),
        })),
        verification: {
          status: 'verified',
          issues: model.verification.issues.filter((issue) => !fileChecks.includes(issue)),
        },
      }).verification.status === 'verified',
    verification: model.verification.status,
    issues: [...new Set(model.verification.issues.map((issue) => issue.message))].slice(0, 5),
  };
}
