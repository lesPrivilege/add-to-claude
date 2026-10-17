/** Synthetic fixture. Never represents, retrieves, or transmits an actual user's conversation. */
import { validateConversation } from '../src/model.js';

export function demoConversation() {
  return validateConversation({
    schemaVersion: 1,
    source: {
      type: 'synthetic',
      id: 'demo-field-notes',
      title: 'A quieter launch',
      url: 'https://chatgpt.com/',
      locator: 'synthetic:demo-field-notes',
    },
    branches: {
      selectedLeaf: 'demo-4',
      availableLeaves: [{ id: 'demo-4', turnCount: 4 }],
      selection: 'single-path',
    },
    verification: { status: 'verified', issues: [] },
    turns: [
      {
        id: 'demo-1',
        role: 'user',
        markdown:
          'Help me shape a small launch page for **Field Notes**, a local-first writing app.\n\nKeep it calm, clear, and useful.',
        sourceLocators: ['synthetic:demo/1'],
        contentFidelity: 'original-markdown',
      },
      {
        id: 'demo-2',
        role: 'assistant',
        markdown:
          '## A place for unfinished thoughts\n\nA quiet space to collect ideas, find a thread, and keep writing.\n\n- Your words stay on your device.\n- Start with a blank page.\n- Export whenever you like.\n\nUse a single primary action: **Start a note**.',
        sourceLocators: ['synthetic:demo/2'],
        contentFidelity: 'original-markdown',
      },
      {
        id: 'demo-3',
        role: 'user',
        markdown: 'Add a tiny code example and a reference link. Keep the draft as Markdown.',
        sourceLocators: ['synthetic:demo/3'],
        contentFidelity: 'original-markdown',
      },
      {
        id: 'demo-4',
        role: 'assistant',
        markdown:
          '```js\nconst note = { title: "A small beginning", saved: true };\n```\n\nFor the implementation, start with [semantic HTML](https://developer.mozilla.org/en-US/docs/Glossary/Semantics).\n\nThe first screen should feel like an invitation to write.',
        sourceLocators: ['synthetic:demo/4'],
        contentFidelity: 'original-markdown',
        citations: [
          {
            title: 'Semantic HTML · MDN',
            url: 'https://developer.mozilla.org/en-US/docs/Glossary/Semantics',
            sourceLocator: 'synthetic:demo/4/reference/1',
          },
        ],
      },
    ],
    attachments: [],
  });
}
