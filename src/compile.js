import { importBrowserResponse } from './chatgpt-response.js';
import { projectFileLine, projectIssueLine, projectMarkdown } from './model.js';

export const MAX_MARKDOWN = 16 * 1024 * 1024;

/** One observed conversation response to the Markdown handed to a composer, plus what the panel shows. */
export function compile(packet) {
  const model = importBrowserResponse(packet.body, packet);
  const markdown = projectMarkdown(model);
  const turnNumber = new Map(model.turns.map((turn, index) => [turn.id, index + 1]));
  if (new TextEncoder().encode(markdown).byteLength > MAX_MARKDOWN)
    throw new Error('This conversation exceeds the 16 MiB context limit.');
  return {
    markdown,
    title: model.source.title,
    turns: model.turns.length,
    files: model.attachments.length,
    // File ids as the page uses them in /backend-api/files/download/<id>, with each file's line.
    attachments: model.attachments.map((file) => ({
      id: file.id.slice(file.id.indexOf(':') + 1),
      name: file.name,
      turn: turnNumber.get(file.turnId) ?? 0,
      messageId: file.turnId ?? '',
      line: projectFileLine(file),
      // The "download this file" check this reference raised, if any.
      issue: (() => {
        const raised = model.verification.issues.find(
          (issue) =>
            issue.code.startsWith('attachment-') && issue.sourceLocator === file.sourceLocator,
        );
        return raised ? projectIssueLine(raised) : '';
      })(),
    })),
    verification: model.verification.status,
    issues: model.verification.issues.slice(0, 5).map((issue) => issue.message),
  };
}
