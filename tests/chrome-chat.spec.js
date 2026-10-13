import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const url = 'https://chatgpt.com/c/chrome-synthetic';
const record = {
  conversation_id: 'chrome-synthetic',
  title: 'Synthetic Chrome chat',
  current_node: 'a',
  mapping: {
    root: { parent: null, message: null },
    u: {
      parent: 'root',
      message: {
        id: 'u',
        author: { role: 'user' },
        status: 'finished_successfully',
        content: { content_type: 'text', parts: ['Synthetic question.'] },
      },
    },
    a: {
      parent: 'u',
      message: {
        id: 'a',
        author: { role: 'assistant' },
        status: 'finished_successfully',
        end_turn: true,
        content: { content_type: 'text', parts: ['Original **Markdown** 中文 ✓\n'] },
      },
    },
  },
};
let context, worker, temp, debugPort, extensionId;
const sockets = [];
test.beforeAll(async () => {
  test.skip(
    !process.env.EXTENSION_CHROMIUM_PATH,
    'Set EXTENSION_CHROMIUM_PATH for the installed Chrome chat integration fixture.',
  );
  temp = await mkdtemp(path.join(os.tmpdir(), 'handoff-chrome-chat-'));
  const extension = path.join(temp, 'extension');
  const profile = path.join(temp, 'profile');
  await cp(path.resolve('dist/extension'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  // Fixture-only host pregrant; native permission prompts and user toolbar click are not covered.
  manifest.host_permissions = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.EXTENSION_CHROMIUM_PATH,
    headless: false,
    args: [
      '--remote-debugging-port=0',
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  debugPort = Number(
    (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0],
  );
  worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  await expect.poll(() => worker.evaluate(() => typeof chrome.action?.openPopup)).toBe('function');
  await context.route('https://chatgpt.com/**', (route) =>
    route.fulfill({
      contentType: route.request().isNavigationRequest() ? 'text/html' : 'application/json',
      body: route.request().isNavigationRequest()
        ? '<!doctype html><title>Synthetic Chrome chat</title><main><h1>Chat stays here</h1><textarea id="draft">Unsent synthetic draft.</textarea></main>'
        : JSON.stringify(record),
    }),
  );
});
test.afterAll(async () => {
  for (const socket of sockets) socket.close();
  await context?.close();
  if (temp) await rm(temp, { recursive: true, force: true });
});
async function popup(page) {
  await page.bringToFront();
  await worker.evaluate(() => chrome.action.openPopup());
  let target;
  await expect
    .poll(async () => {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      target = targets.find((item) => item.url === `chrome-extension://${extensionId}/chat.html`);
      return Boolean(target);
    })
    .toBe(true);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const pending = new Map();
  let sequence = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  };
  const evaluate = async (expression) => {
    const id = ++sequence;
    const reply = new Promise((resolve) => pending.set(id, resolve));
    socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      }),
    );
    const result = await reply;
    if (result.error || result.result.exceptionDetails)
      throw new Error(
        result.error?.message || result.result.exceptionDetails.exception?.description,
      );
    return result.result.result.value;
  };
  await expect
    .poll(() => evaluate("document.querySelector('#source')?.textContent"))
    .toMatch(/Enable Handoff|turns|Open a conversation/);
  return {
    async screenshot() {
      const id = ++sequence;
      const reply = new Promise((resolve) => pending.set(id, resolve));
      socket.send(
        JSON.stringify({ id, method: 'Page.captureScreenshot', params: { format: 'png' } }),
      );
      const result = await reply;
      await mkdir('artifacts', { recursive: true });
      await writeFile(
        'artifacts/12-chrome-handoff-popup.png',
        Buffer.from(result.result.data, 'base64'),
      );
    },
    close: async () => {
      await evaluate('setTimeout(() => window.close(), 0); true');
      await expect
        .poll(async () =>
          (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).some(
            (item) => item.id === target.id,
          ),
        )
        .toBe(false);
    },
    evaluate,
    click: (id) => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`),
    text: (id) => evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`),
    enabled: (id) => evaluate(`!document.getElementById(${JSON.stringify(id)}).disabled`),
  };
}

test('primary installed popup observes one selected chat without reload, then routes explicit Add through a source-checked native transport fixture', async () => {
  const page = await context.newPage();
  await page.goto(url);
  // Native transport is mocked; Chrome source/permission/scripting/popup APIs are real.
  await worker.evaluate(() => {
    const event = () => {
      const listeners = [];
      return {
        addListener: (fn) => listeners.push(fn),
        emit: (value) => listeners.forEach((fn) => fn(value)),
      };
    };
    globalThis.fixtureDraft = 'Existing synthetic draft.';
    globalThis.fixtureNativeCommands = [];
    chrome.runtime.connectNative = () => {
      const port = {
        onMessage: event(),
        onDisconnect: event(),
        disconnect() {
          port.onDisconnect.emit();
        },
        postMessage(message) {
          fixtureNativeCommands.push(message.command);
          if (message.command === 'targets')
            queueMicrotask(() =>
              port.onMessage.emit({
                id: message.id,
                ok: true,
                trusted: true,
                targets: [{ id: 'window-a', app: 'Synthetic Agent', window: 'Composer A' }],
              }),
            );
          if (message.command === 'select')
            queueMicrotask(() =>
              port.onMessage.emit({
                id: message.id,
                ok: true,
                name: 'Synthetic Agent',
                targetToken: 'target-a',
              }),
            );
          if (message.command === 'append') {
            port.pending = message;
            queueMicrotask(() =>
              port.onMessage.emit({
                event: 'source-check',
                operationId: message.id,
                ticket: 'synthetic-ticket',
                revision: message.revision,
                hash: message.hash,
              }),
            );
          }
          if (message.command === 'source-permit') {
            if (message.current) fixtureDraft += '\n\n' + port.pending.text;
            port.onMessage.emit({
              id: port.pending.id,
              ok: message.current,
              inserted: message.current,
              message: message.current ? 'Added and verified. Nothing sent.' : 'Source changed.',
            });
          }
        },
      };
      return port;
    };
  });
  const panel = await popup(page);
  await panel.click('enable');
  await expect.poll(() => panel.text('status')).toContain('Reader enabled');
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.evaluate(async () =>
    (await fetch('/backend-api/conversation/chrome-synthetic')).text(),
  );
  await expect.poll(() => panel.text('source')).toContain('2 turns');
  await expect.poll(() => panel.enabled('preview')).toBe(true);
  await panel.click('preview');
  await expect
    .poll(() => panel.evaluate("document.getElementById('text').value"))
    .toContain('Original **Markdown** 中文 ✓');
  await panel.click('targets');
  await expect
    .poll(() => panel.evaluate("document.getElementById('target').options.length"))
    .toBe(2);
  await panel.evaluate(
    "document.getElementById('target').value='window-a';document.getElementById('target').dispatchEvent(new Event('change'))",
  );
  await expect.poll(() => panel.enabled('add')).toBe(true);
  await panel.screenshot();
  await panel.click('add');
  await expect.poll(() => panel.text('status')).toContain('Added and verified');
  const draft = await worker.evaluate(() => fixtureDraft);
  expect(draft).toContain('Existing synthetic draft.\n\n# Synthetic Chrome chat');
  expect(draft).toContain('Original **Markdown** 中文 ✓\n');
  expect(await worker.evaluate(() => fixtureNativeCommands)).toEqual([
    'targets',
    'select',
    'append',
    'source-permit',
  ]);
  await expect(page.locator('#draft')).toHaveValue('Unsent synthetic draft.');
  expect(requests).toEqual(['https://chatgpt.com/backend-api/conversation/chrome-synthetic']);
  expect(context.pages().filter((item) => /127\.0\.0\.1/u.test(item.url()))).toHaveLength(0);
  await panel.close();
  const reopened = await popup(page);
  await expect.poll(() => reopened.text('status')).toContain('Last handoff: Added and verified');
  expect(await reopened.enabled('add')).toBe(false);
  await page.close();
});
