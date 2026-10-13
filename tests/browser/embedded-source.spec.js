import { test, expect } from '@playwright/test';
import { createEmbeddedSourceScript } from '../../web/embedded-source.js';
import { importBrowserResponse } from '../../src/chatgpt-response.js';

const pageURL = 'https://chatgpt.com/c/embedded-synthetic';
const responseURL = 'https://chatgpt.com/backend-api/conversation/embedded-synthetic';
const responseBody = JSON.stringify({
  conversation_id: 'embedded-synthetic',
  mapping: {},
  text: 'Original **Markdown** 中文 ✓\n',
});

async function setup(page, { maxBytes, initialURL = pageURL } = {}) {
  const requests = [];
  await page.addInitScript({
    content: `
    window.receivedSource = [];
    window.webkit = { messageHandlers: { handoffSource: { postMessage: packet => window.receivedSource.push(packet) } } };
    ${createEmbeddedSourceScript({ maxBytes })}
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
  await page.goto(initialURL);
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
  expect((await page.evaluate(() => window.receivedSource)).at(-1).kind).toBe('unavailable');
  expect(requests).toHaveLength(3);
});

const message = (id, role, text) => ({
  id,
  author: { role },
  status: 'finished_successfully',
  end_turn: true,
  content: { content_type: 'text', parts: [text] },
});
const base = () => ({
  conversation_id: 'embedded-synthetic',
  title: 'Synthetic streamed chat',
  current_node: 'a0',
  mapping: {
    root: { id: 'root', parent: null, message: null },
    u0: { id: 'u0', parent: 'root', message: message('u0', 'user', 'Earlier user turn.') },
    a0: { id: 'a0', parent: 'u0', message: message('a0', 'assistant', 'Earlier assistant turn.') },
  },
});
const liveEndpoint = 'https://chatgpt.com/backend-api/f/conversation';
const liveWire = (id = 'embedded-synthetic') =>
  `event: delta_encoding\ndata: "v1"\n\ndata: ${JSON.stringify({ type: 'resume_conversation_token', conversation_id: id, token: 'SYNTHETIC_TOKEN_NOT_RETAINED' })}\n\nevent: delta\ndata: ${JSON.stringify({ p: '', o: 'add', v: { conversation_id: id, message: { ...message('a1', 'assistant', ''), status: 'in_progress', end_turn: false, metadata: {} } } })}\n\nevent: delta\ndata: ${JSON.stringify({ p: '/message/content/parts/0', o: 'append', v: ' **Original** 中文 ✓\n' })}\n\nevent: delta\ndata: ${JSON.stringify(
    {
      p: '',
      o: 'patch',
      v: [
        { p: '/message/status', o: 'replace', v: 'finished_successfully' },
        { p: '/message/end_turn', o: 'replace', v: true },
      ],
    },
  )}\n\ndata: [DONE]\n\n`;

test('normal live response reaches the handoff model without extra requests, reload or draft changes', async ({
  page,
}) => {
  await setup(page);
  const requests = [];
  page.on('request', (request) =>
    requests.push({ url: request.url(), navigation: request.isNavigationRequest() }),
  );
  await page.route(responseURL, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(base()) }),
  );
  await page.route(liveEndpoint, (route) =>
    route.fulfill({ contentType: 'text/event-stream', body: liveWire() }),
  );
  await page.evaluate(async (url) => {
    const draft = document.createElement('textarea');
    draft.id = 'next-draft';
    draft.value = 'Leave my next unsent draft alone.';
    document.body.append(draft);
    await (await fetch(url)).text();
  }, responseURL);
  const wire = await page.evaluate(async (url) => {
    const request = new Request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'SYNTHETIC_HEADER_NOT_RETAINED',
      },
      body: JSON.stringify({
        action: 'next',
        conversation_id: 'embedded-synthetic',
        parent_message_id: 'a0',
        messages: [
          {
            id: 'u1',
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['New exact user text.'] },
          },
        ],
        ignored_token: 'SYNTHETIC_BODY_TOKEN_NOT_RETAINED',
      }),
    });
    return (await fetch(request)).text();
  }, liveEndpoint);
  expect(wire).toBe(liveWire());
  await expect
    .poll(() =>
      page.evaluate(
        () => window.receivedSource.filter((packet) => packet.kind === 'response').at(-1)?.method,
      ),
    )
    .toBe('POST');
  const packet = await page.evaluate(() =>
    window.receivedSource.filter((packet) => packet.kind === 'response').at(-1),
  );
  const model = importBrowserResponse(packet.body, packet);
  expect(model.turns.map((turn) => turn.id)).toEqual(['u0', 'a0', 'u1', 'a1']);
  expect(model.turns[3].markdown).toBe(' **Original** 中文 ✓\n');
  expect(model.verification.status).toBe('verified');
  expect(packet.body).not.toContain('NOT_RETAINED');
  expect(requests.map((request) => request.url)).toEqual([responseURL, liveEndpoint]);
  expect(requests.some((request) => request.navigation)).toBe(false);
  await expect(page.locator('#next-draft')).toHaveValue('Leave my next unsent draft alone.');
  await expect(page.locator('main')).toHaveText('Chat stays visible.');
});

test('a new chat can receive its URL after its answer without losing the observed exchange', async ({
  page,
}) => {
  await setup(page, { initialURL: 'https://chatgpt.com/' });
  await page.route(liveEndpoint, (route) =>
    route.fulfill({ contentType: 'text/event-stream', body: liveWire('new-chat') }),
  );
  await page.evaluate(async (url) => {
    await (
      await fetch(url, {
        method: 'POST',
        body: JSON.stringify({
          action: 'next',
          parent_message_id: 'root',
          messages: [
            {
              id: 'u1',
              author: { role: 'user' },
              content: { content_type: 'text', parts: ['Synthetic new chat.'] },
            },
          ],
        }),
      })
    ).text();
    history.pushState({}, '', '/c/new-chat');
  }, liveEndpoint);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.receivedSource.filter((packet) => packet.kind === 'response').length,
      ),
    )
    .toBe(1);
  const packet = await page.evaluate(() =>
    window.receivedSource.find((packet) => packet.kind === 'response'),
  );
  expect(importBrowserResponse(packet.body, packet).source.response.coverage).toBe(
    'new-conversation',
  );
  expect(importBrowserResponse(packet.body, packet).verification.status).toBe('verified');
});

test('a stream handoff never masquerades as a completed answer or invokes a resume endpoint', async ({
  page,
}) => {
  await setup(page);
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.route(responseURL, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(base()) }),
  );
  await page.route(liveEndpoint, (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: 'data: {"type":"stream_handoff","conversation_id":"embedded-synthetic"}\n\ndata: [DONE]\n\n',
    }),
  );
  await page.evaluate(
    async ({ get, post }) => {
      await (await fetch(get)).text();
      await (
        await fetch(post, {
          method: 'POST',
          body: JSON.stringify({
            action: 'next',
            conversation_id: 'embedded-synthetic',
            parent_message_id: 'a0',
            messages: [
              {
                id: 'u1',
                author: { role: 'user' },
                content: { content_type: 'text', parts: ['Synthetic question.'] },
              },
            ],
          }),
        })
      ).text();
    },
    { get: responseURL, post: liveEndpoint },
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => window.receivedSource.filter((packet) => packet.kind === 'response').at(-1)?.method,
      ),
    )
    .toBe('POST');
  const packet = await page.evaluate(() =>
    window.receivedSource.filter((packet) => packet.kind === 'response').at(-1),
  );
  expect(importBrowserResponse(packet.body, packet).verification.status).toBe('partial');
  expect(requests).toEqual([responseURL, liveEndpoint]);
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
