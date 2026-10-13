import { test, expect } from '@playwright/test';

test('the served native compiler prepares exact original text with its packaged dependencies', async ({
  page,
}) => {
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/native-core.html');
  await expect.poll(() => page.evaluate(() => typeof window.handoffCore?.compile)).toBe('function');
  const result = await page.evaluate(() => {
    const message = (id, role, text) => ({
      id,
      author: { role },
      status: 'finished_successfully',
      end_turn: true,
      content: { content_type: 'text', parts: [text] },
    });
    return window.handoffCore.compile(
      JSON.stringify({
        conversation_id: 'synthetic-core',
        current_node: 'a',
        mapping: {
          root: { parent: null, message: null },
          u: { parent: 'root', message: message('u', 'user', 'Question **原文**.') },
          internal: {
            parent: 'u',
            message: { ...message('internal', 'assistant', 'Hidden synthetic text'), weight: 0 },
          },
          a: { parent: 'internal', message: message('a', 'assistant', 'Answer ✓\n') },
        },
      }),
      {
        pageUrl: 'https://chatgpt.com/c/synthetic-core',
        responseUrl: 'https://chatgpt.com/backend-api/conversation/synthetic-core',
        capturedAt: '2026-10-13T05:00:00.000Z',
      },
    );
  });
  expect(failures).toEqual([]);
  expect(result.model.verification.status).toBe('verified');
  expect(result.model.turns.map((turn) => turn.id)).toEqual(['u', 'a']);
  expect(result.markdown).toContain('Question **原文**.');
  expect(result.markdown).toContain('Answer ✓\n');
  expect(result.markdown).not.toContain('Hidden synthetic text');
});
