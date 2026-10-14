import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

// Real Chrome, the built extension and the real compiled relay. Only the menu-bar app is a stand-in:
// a socket server that speaks the same frames and records what it receives.
const execute = promisify(execFile);
const conversation = {
  conversation_id: 'chrome-synthetic',
  title: 'Synthetic Chrome chat',
  current_node: 'a',
  mapping: {
    root: { parent: null, children: ['u'], message: null },
    u: {
      parent: 'root',
      children: ['a'],
      message: {
        id: 'u',
        author: { role: 'user' },
        status: 'finished_successfully',
        content: { content_type: 'text', parts: ['Synthetic question.'] },
      },
    },
    a: {
      parent: 'u',
      children: [],
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

// The stand-in is the real ChromeLink in a small Swift binary named like the app, beside the relay.
function standInApp(binary, socketPath) {
  const app = { states: [], connections: 0, replies: new Map(), sequence: 0 };
  app.start = () =>
    new Promise((resolve) => {
      app.process = spawn(binary, [socketPath], { stdio: ['pipe', 'pipe', 'inherit'] });
      createInterface({ input: app.process.stdout }).on('line', (line) => {
        const message = JSON.parse(line);
        if (message.listening) resolve();
        if ('state' in message) {
          if (message.state && !app.states.at(-1)) app.connections++;
          app.states.push(message.state);
        }
        if ('reply' in message) app.replies.get(message.id)?.(message.reply ?? {});
      });
    });
  app.stop = () =>
    new Promise((resolve) => {
      app.process.once('exit', resolve);
      app.process.kill();
    });
  app.state = () => app.states.at(-1);
  app.request = (command, values = {}) =>
    new Promise((resolve) => {
      const id = ++app.sequence;
      app.replies.set(id, resolve);
      app.process.stdin.write(JSON.stringify({ id, command, ...values }) + '\n');
    });
  return app;
}

let context, temp, app;
const requests = [];
test.beforeAll(async () => {
  test.skip(
    !process.env.EXTENSION_CHROMIUM_PATH || process.platform !== 'darwin',
    'Set EXTENSION_CHROMIUM_PATH to Chrome for Testing; branded Chrome ignores --load-extension.',
  );
  temp = await mkdtemp(path.join(os.tmpdir(), 'gh-'));
  const extension = path.join(temp, 'extension');
  const profile = path.join(temp, 'profile');
  await cp(path.resolve('dist/extension'), extension, { recursive: true });
  const bin = path.join(temp, 'bin');
  await mkdir(bin);
  const relay = path.join(bin, 'gpt-handoff-host');
  const swiftc = [
    ...[
      '--sdk',
      'macosx',
      'swiftc',
      '-swift-version',
      '5',
      '-parse-as-library',
      '-D',
      'GPT_HANDOFF_TEST',
    ],
    ...['-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos14.0`],
  ];
  await execute('xcrun', [
    ...swiftc,
    ...['native/Relay.swift', 'native/Link.swift', 'native/NativeHostOrigin.swift', '-o', relay],
  ]);
  await execute('xcrun', [
    ...swiftc,
    ...['tests/native/StandIn.swift', 'native/Link.swift', '-o', path.join(bin, 'gpt-handoff')],
  ]);
  const origin = (await readFile('native/NativeHostOrigin.swift', 'utf8')).match(
    /"(chrome-extension:\/\/[^"]+\/)"/u,
  )[1];
  // Chromium reads user native hosts from this throwaway profile, never the owner's Chrome.
  await mkdir(path.join(profile, 'NativeMessagingHosts'), { recursive: true });
  await writeFile(
    path.join(profile, 'NativeMessagingHosts', 'io.lesprivilege.gpt_handoff.json'),
    JSON.stringify({
      name: 'io.lesprivilege.gpt_handoff',
      description: 'gpt-handoff relay (test)',
      path: relay,
      type: 'stdio',
      allowed_origins: [origin],
    }),
  );
  const socketPath = path.join(temp, 'app.sock');
  app = standInApp(path.join(bin, 'gpt-handoff'), socketPath);
  await app.start();
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.EXTENSION_CHROMIUM_PATH,
    headless: false,
    env: { ...process.env, GPT_HANDOFF_SOCKET: socketPath },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  expect(origin).toBe(`chrome-extension://${new URL(worker.url()).host}/`);
  await context.route('https://chatgpt.com/**', (route) => {
    requests.push(`${route.request().method()} ${route.request().url()}`);
    return route.fulfill(
      route.request().isNavigationRequest()
        ? {
            contentType: 'text/html',
            body: '<!doctype html><title>Synthetic Chrome chat</title><main>Chat</main>',
          }
        : { contentType: 'application/json', body: JSON.stringify(conversation) },
    );
  });
});
test.afterAll(async () => {
  await context?.close();
  if (app?.process) await app.stop();
  if (temp) await rm(temp, { recursive: true, force: true });
});

test('the viewed chat reaches the app through the real relay, without extra requests or reloads', async () => {
  const page = await context.newPage();
  await page.goto('https://chatgpt.com/c/chrome-synthetic');
  await page.bringToFront();
  await expect.poll(() => app.connections).toBeGreaterThan(0);
  await expect.poll(() => app.state()?.status).toBe('waiting');
  // The website loads its own conversation; the extension only observes it.
  await page.evaluate(() =>
    fetch('/backend-api/conversation/chrome-synthetic').then((r) => r.text()),
  );
  await expect.poll(() => app.state()?.status).toBe('ready');
  expect(app.state()).toMatchObject({
    title: 'Synthetic Chrome chat',
    page: 'https://chatgpt.com/c/chrome-synthetic',
    turns: 2,
    verification: 'verified',
  });

  const context1 = await app.request('context');
  expect(context1.ok).toBe(true);
  expect(context1.markdown).toContain('Original **Markdown** 中文 ✓\n');
  expect(context1.markdown.indexOf('Synthetic question.')).toBeLessThan(
    context1.markdown.indexOf('Original **Markdown**'),
  );
  expect(context1.hash).toBe(createHash('sha256').update(context1.markdown).digest('hex'));
  const { revision, hash } = context1;
  expect((await app.request('check', { revision, hash })).current).toBe(true);
  expect(requests).toEqual([
    'GET https://chatgpt.com/c/chrome-synthetic',
    'GET https://chatgpt.com/backend-api/conversation/chrome-synthetic',
  ]);

  // Moving to another conversation revokes the old context before anything can be added.
  await page.evaluate(() => history.pushState(null, '', '/c/another'));
  await expect.poll(() => app.state()?.status).toBe('waiting');
  expect((await app.request('check', { revision, hash })).current).toBe(false);
  expect((await app.request('context')).ok).toBe(false);

  // The app restarting: the relay reconnects on its own and the state is republished.
  const connections = app.connections;
  await app.stop();
  app.states.push(null);
  await app.start();
  await expect.poll(() => app.connections, { timeout: 5000 }).toBeGreaterThan(connections);
  expect(app.state()?.status).toBe('waiting');

  await page.close();
  await expect.poll(() => app.state()?.status).toBe('none');
});
