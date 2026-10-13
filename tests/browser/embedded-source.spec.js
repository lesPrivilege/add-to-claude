import { test, expect } from '@playwright/test';
import { installEmbeddedSourceObserver } from '../../web/embedded-source.js';

const pageURL = 'https://chatgpt.com/c/embedded-synthetic';
const responseURL = 'https://chatgpt.com/backend-api/conversation/embedded-synthetic';
const responseBody = JSON.stringify({
  conversation_id: 'embedded-synthetic',
  mapping: {},
  text: 'Original **Markdown** 中文 ✓\n',
});

async function setup(page, { maxBytes } = {}) {
  const requests = [];
  await page.addInitScript({
    content: `
    window.receivedSource = [];
    window.webkit = { messageHandlers: { handoffSource: { postMessage: packet => window.receivedSource.push(packet) } } };
    (${installEmbeddedSourceObserver.toString()})(${JSON.stringify({ maxBytes })});
  `,
  });
  await page.route('https://chatgpt.com/**', (route) => {
    requests.push({ url: route.request().url(), method: route.request().method() });
    return route.fulfill({
      contentType: route.request().isNavigationRequest() ? 'text/html' : 'application/json',
      body: route.request().isNavigationRequest()
        ? '<!doctype html><title>Synthetic embedded chat</title><main>Chat stays visible.</main>'
        : responseBody,
    });
  });
  await page.goto(pageURL);
  return requests;
}

test('embedded observer makes no requests or reloads and leaves the website response intact', async ({
  page,
}) => {
  const requests = await setup(page);
  expect(requests).toEqual([{ url: pageURL, method: 'GET' }]);
  const text = await page.evaluate(async (url) => (await fetch(url)).text(), responseURL);
  expect(text).toBe(responseBody);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.receivedSource.filter((packet) => packet.kind === 'response').length,
      ),
    )
    .toBe(1);
  const [packet] = await page.evaluate(() =>
    window.receivedSource.filter((packet) => packet.kind === 'response'),
  );
  expect(packet.kind).toBe('response');
  expect(packet.pageUrl).toBe(pageURL);
  expect(packet.responseUrl).toBe(responseURL);
  expect(packet.body).toBe(responseBody);
  expect(requests).toHaveLength(2);
  await expect(page.locator('main')).toHaveText('Chat stays visible.');
});

test('embedded observer ignores authentication and other conversations', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    await fetch('/api/auth/session');
    await fetch('/backend-api/conversation/another-chat');
  });
  expect(await page.evaluate(() => window.receivedSource)).toEqual([]);
});

test('source navigation and a newly sent message invalidate the old snapshot without sending anything themselves', async ({
  page,
}) => {
  const requests = await setup(page);
  await page.evaluate(async (url) => (await fetch(url)).text(), responseURL);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.receivedSource.filter((packet) => packet.kind === 'response').length,
      ),
    )
    .toBe(1);
  await page.evaluate(() => history.pushState({}, '', '/c/next-synthetic'));
  expect((await page.evaluate(() => window.receivedSource)).at(-1).kind).toBe('changed');
  expect(requests).toHaveLength(2);
  // The fixture, standing in for a user's normal website action, owns this request.
  await page.evaluate(async () =>
    (await fetch('/backend-api/conversation', { method: 'POST', body: '{}' })).text(),
  );
  expect((await page.evaluate(() => window.receivedSource)).at(-1).kind).toBe('changed');
  expect(requests).toHaveLength(3);
});

test('oversize observer data is refused while the original website response remains readable', async ({
  page,
}) => {
  await setup(page, { maxBytes: 16 });
  expect(await page.evaluate(async (url) => (await fetch(url)).text(), responseURL)).toBe(
    responseBody,
  );
  await expect
    .poll(() => page.evaluate(() => window.receivedSource.at(-1)?.kind))
    .toBe('unavailable');
  expect(await page.evaluate(() => window.receivedSource.some((packet) => 'body' in packet))).toBe(
    false,
  );
});

test('a response finishing after navigation cannot repopulate the previous conversation', async ({
  page,
}) => {
  await setup(page);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let arrived = false;
  await page.route(responseURL, async (route) => {
    arrived = true;
    await held;
    await route.fulfill({ contentType: 'application/json', body: responseBody });
  });
  const pending = page.evaluate(async (url) => (await fetch(url)).text(), responseURL);
  await expect.poll(() => arrived).toBe(true);
  await page.evaluate(() => history.pushState({}, '', '/c/other-synthetic'));
  release();
  expect(await pending).toBe(responseBody);
  expect(
    await page.evaluate(() => window.receivedSource.some((packet) => packet.kind === 'response')),
  ).toBe(false);
});
