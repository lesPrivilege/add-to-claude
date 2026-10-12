import { test, expect } from '@playwright/test';
import { demoConversation } from '../../src/model.js';
import { captureChatGPT } from '../../src/capture.js';
import { readFile, mkdir } from 'node:fs/promises';

const snapshot = () => {
  const model = demoConversation();
  model.source = {
    ...model.source,
    type: 'dom-snapshot',
    title: 'Selected browser chat',
    url: 'https://chatgpt.com/c/synthetic-selected',
    locator: 'document:synthetic',
  };
  return model;
};

async function hello(page, id = 'a'.repeat(32)) {
  return page.evaluate(
    (requestId) =>
      new Promise((resolve) => {
        const receive = (event) => {
          if (event.data?.type === 'GH_SOURCE_READY' && event.data.requestId === requestId) {
            window.removeEventListener('message', receive);
            resolve(event.data.nonce);
          }
        };
        window.addEventListener('message', receive);
        window.postMessage({ type: 'GH_SOURCE_HELLO', requestId }, location.origin);
      }),
    id,
  );
}
async function send(page, model, nonce, id = 'a'.repeat(32)) {
  await page.evaluate(
    ({ model, nonce, requestId }) => {
      window.postMessage({ type: 'GH_SOURCE_MODEL', model, nonce, requestId }, location.origin);
    },
    { model, nonce, requestId: id },
  );
}

test('browser source adopts one unverified snapshot, rejects bad nonce and replay', async ({
  page,
}) => {
  await page.goto('/');
  const nonce = await hello(page);
  const model = snapshot();
  await send(page, model, 'b'.repeat(32));
  await expect(page.locator('#source-empty')).toBeVisible();
  await send(page, model, nonce);
  await expect(page.locator('#conversation-title')).toHaveText(model.source.title);
  await expect(page.locator('#verification')).toHaveText('Completeness unverified');
  await expect(page.locator('#unverified-confirm')).toBeVisible();
  await expect(page.locator('#transfer-btn')).toBeDisabled();
  await page.locator('#clear-btn').click();
  await send(page, model, nonce);
  await expect(page.locator('#source-empty')).toBeVisible();
});

test('a loaded source requires explicit replacement and can keep its selected files', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#demo-btn').click();
  const existing = await page.locator('#conversation-title').textContent();
  await page.locator('#attachment-files').setInputFiles({
    name: 'keep.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('Keep this synthetic file'),
  });
  await send(page, snapshot(), await hello(page));
  await expect(page.locator('#incoming-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keep existing source' }).click();
  await expect(page.locator('#conversation-title')).toHaveText(existing);
  await expect(page.locator('#attachment-list')).toContainText('keep.md');
  await expect(page.locator('#source-notice')).toHaveText('Kept existing source. Nothing changed.');
  await send(page, snapshot(), await hello(page, 'b'.repeat(32)), 'b'.repeat(32));
  await page.getByRole('button', { name: 'Use current chat', exact: true }).click();
  await expect(page.locator('#conversation-title')).toHaveText('Selected browser chat');
  await expect(page.locator('#attachment-list')).not.toContainText('keep.md');
});

test('rejects unsupported source URLs and foreign window messages', async ({ page }) => {
  await page.goto('/');
  const model = snapshot();
  model.source.url = 'https://example.com/c/synthetic';
  await send(page, model, await hello(page));
  await expect(page.locator('#source-empty')).toBeVisible();
  await page.evaluate(() => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
  });
  await page.frames()[1].evaluate(() => {
    parent.postMessage(
      { type: 'GH_SOURCE_HELLO', requestId: 'c'.repeat(32) },
      parent.location.origin,
    );
  });
  // A forged request from a child window cannot reserve the same request ID.
  expect(await hello(page, 'c'.repeat(32))).toMatch(/^[a-f0-9]{32}$/);
  await send(page, snapshot(), await hello(page, 'd'.repeat(32)), 'd'.repeat(32));
  await expect(page.locator('#conversation-title')).toHaveText('Selected browser chat');
});

test('synthetic rendered chat travels through the desk into the exact chosen composer', async ({
  page,
  context,
}) => {
  const source = await context.newPage();
  const fixture = await readFile('tests/fixtures/chatgpt-page.html', 'utf8');
  await source.route('https://chatgpt.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: fixture }),
  );
  await source.goto('https://chatgpt.com/c/synthetic-roundtrip');
  const captured = await source.evaluate(captureChatGPT, { expectedUrl: source.url() });
  const target = await context.newPage();
  await target.goto('/composer.html?title=Browser%20handoff');
  await expect(target.locator('#composer-state')).toHaveText('Ready to receive');
  const other = await context.newPage();
  await other.goto('/composer.html?title=Leave%20untouched');
  await page.goto('/');
  await send(page, captured, await hello(page));
  await expect(page.locator('#conversation-title')).toHaveText(captured.source.title);
  await expect(page.locator('#verification')).toHaveText('Completeness unverified');
  await page.locator('#target-picker').click();
  await page
    .locator('#target-dialog')
    .getByRole('button', { name: /Browser handoff/ })
    .click();
  await expect(page.locator('#transfer-btn')).toBeDisabled();
  await page.locator('#preview-btn').click();
  await expect(page.locator('#preview-content')).toContainText('print("<hello>")');
  await expect(page.locator('#preview-content')).toContainText('https://example.net/paper');
  await page.keyboard.press('Escape');
  await page.locator('#accept-unverified').check();
  await page.locator('#transfer-btn').click();
  await expect(page.locator('#status')).toContainText('Added to Browser handoff');
  const draft = await target.locator('#editor').inputValue();
  expect(draft.indexOf('Keep this order.')).toBeLessThan(draft.indexOf('A small example'));
  expect(draft).toContain('print("<hello>")');
  expect(draft).toContain('https://example.net/paper');
  expect(draft).toContain('[source link](<https://example.org/reference?section=one>)');
  expect(draft).toContain('> A quoted thought.');
  expect(draft).not.toContain('](&lt;https://');
  expect(draft).toContain('expired');
  expect(draft).not.toContain('SIDEBAR HISTORY MUST NOT BE CAPTURED');
  expect(draft).not.toContain('HIDDEN CONTENT MUST NOT BE CAPTURED');
  await expect(other.locator('#editor')).toHaveValue('');
  await expect(target.locator('#composer-files')).toBeEmpty();
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/07-browser-source-handoff.png', fullPage: true });
});
