import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CAPTURE_MAX_AGE } from '../extension/downloads.js';

// The only synthetic source is intercepted locally; no ChatGPT account/network is used.
const fixture = (
  title = 'Synthetic browser conversation',
) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>
<main><article data-testid="conversation-turn-0"><div data-message-author-role="user" data-message-id="fixture-u"><div class="whitespace-pre-wrap">Keep this exact user line.
Markdown **stays data**.</div></div></article>
<article data-testid="conversation-turn-1"><div data-message-author-role="assistant" data-message-id="fixture-a"><div class="markdown"><h2>A small answer</h2><p>Use <strong>clear language</strong> with a <a href="https://example.com/reference">source link</a>.</p><pre><code class="language-js">const result = "&lt;safe&gt;";\n</code></pre><a href="https://chatgpt.com/files/synthetic-notes.txt" download="notes.txt">Download notes.txt</a></div></div></article></main>
</body></html>`;

const collectionFixture = `<!doctype html><html><head><meta charset="utf-8"><title>Synthetic browser conversation</title>
<style>main{height:336px;overflow-y:auto;overflow-anchor:none}article{height:112px;box-sizing:border-box;padding:8px}</style></head><body><main id="thread"></main><script>
const total=24,row=112,visible=7,area=document.querySelector('main');
let mounted=-1;
function render(){const start=Math.max(0,Math.min(total-visible,Math.floor(area.scrollTop/row)-1));if(start===mounted)return;mounted=start;
area.innerHTML='<div style="height:'+start*row+'px"></div>'+Array.from({length:visible},(_,offset)=>{const i=start+offset;return '<article data-testid="conversation-turn-'+i+'"><div data-message-author-role="'+(i%2?'assistant':'user')+'" data-message-id="stable-'+i+'"><div class="'+(i%2?'markdown':'whitespace-pre-wrap')+'">Observed turn '+i+' — synthetic content only.</div></div></article>';}).join('')+'<div style="height:'+(total-start-visible)*row+'px"></div>';}
area.addEventListener('scroll',()=>requestAnimationFrame(render));render();area.scrollTop=1904;render();
</script></body></html>`;

const originalResponse = (() => {
  const mapping = { root: { id: 'root', parent: null, message: null } };
  for (let index = 0; index < 128; index += 1) {
    const id = `original-${index}`;
    mapping[id] = {
      id,
      parent: index ? `original-${index - 1}` : 'root',
      message: {
        author: { role: index % 2 ? 'assistant' : 'user' },
        status: 'finished_successfully',
        content: {
          content_type: 'text',
          parts: [`Original turn ${index} — **Markdown**.\n\n<https://example.com/source>\n`],
        },
      },
    };
  }
  return {
    conversation_id: 'original-response',
    title: 'Synthetic original conversation',
    current_node: 'original-127',
    mapping,
  };
})();

// Installed-extension lifecycle. Needs a headed Chromium that still honours
// --load-extension (Chrome for Testing or Chromium; branded Chrome 137+ ignores it).
// Playwright does not surface the action popup as a Page, so the real popup is
// driven over its own DevTools target.
test.describe('unpacked extension lifecycle (headed Chromium with --load-extension)', () => {
  let context;
  let worker;
  let extensionId;
  let temp;
  let debugPort;
  let keepAlive;

  test.beforeAll(async () => {
    test.skip(
      !process.env.EXTENSION_CHROMIUM_PATH,
      'Set EXTENSION_CHROMIUM_PATH to a Chromium/Chrome for Testing binary to run the installed-extension lifecycle.',
    );
    temp = await mkdtemp(path.join(os.tmpdir(), 'gpt-handoff-extension-'));
    const extensionPath = path.join(temp, 'extension');
    const profile = path.join(temp, 'profile');
    await cp(path.resolve('dist/extension'), extensionPath, { recursive: true });
    const manifest = JSON.parse(await readFile(path.join(extensionPath, 'manifest.json'), 'utf8'));
    manifest.permissions = [...manifest.permissions, 'debugger'];
    manifest.action.default_popup = 'popup.html';
    // Real Chrome extension APIs, but fixture-only pregrants replace native permission prompts
    // and the toolbar gesture. This legacy suite explicitly adds debugger and the old popup; the primary Chrome path does not request debugger.
    manifest.host_permissions = [
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
      'http://127.0.0.1/*',
    ];
    await writeFile(path.join(extensionPath, 'manifest.json'), JSON.stringify(manifest));
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.EXTENSION_CHROMIUM_PATH,
      headless: false,
      viewport: { width: 1050, height: 850 },
      args: [
        '--remote-debugging-port=0',
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    debugPort = Number(
      (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0],
    );
    const isExtensionWorker = (item) =>
      /^chrome-extension:\/\/[^/]+\/worker\.js$/u.test(item.url());
    worker =
      context.serviceWorkers().find(isExtensionWorker) ||
      (await context.waitForEvent('serviceworker', { predicate: isExtensionWorker }));
    extensionId = new URL(worker.url()).host;
    // Worker creation precedes extension API initialization on a fresh Chrome profile.
    await expect
      .poll(() =>
        worker.evaluate(() => ({
          name: globalThis.chrome?.runtime?.getManifest?.().name,
          action: typeof globalThis.chrome?.action?.openPopup,
        })),
      )
      .toEqual({ name: 'gpt-handoff', action: 'function' });
    // Test-only keepalive: idle suspension would orphan this Playwright worker handle.
    // Real service-worker suspension is therefore NOT covered here.
    keepAlive = setInterval(
      () => worker.evaluate(() => chrome.runtime.getPlatformInfo()).catch(() => {}),
      10_000,
    );
    await context.route('https://chatgpt.com/**', async (route) => {
      if (
        route.request().url() === 'https://chatgpt.com/backend-api/conversation/original-response'
      ) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(originalResponse),
        });
        return;
      }
      if (route.request().isNavigationRequest())
        await route.fulfill({
          contentType: 'text/html',
          body: route.request().url().includes('virtualized')
            ? collectionFixture
            : route.request().url().includes('/c/original-response')
              ? fixture() +
                '<script>fetch("/backend-api/conversation/original-response").catch(() => {});</script>'
              : fixture(),
        });
      else await route.abort();
    });
  });

  test.afterEach(async () => {
    for (const page of context?.pages() || []) await page.close();
  });
  test.afterAll(async () => {
    clearInterval(keepAlive);
    await context?.close();
    if (temp) await rm(temp, { recursive: true, force: true });
  });

  async function conversation(id = 'synthetic-one') {
    const page = await context.newPage();
    await page.goto(`https://chatgpt.com/c/${id}`);
    return page;
  }

  async function popupTarget() {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    return targets.find((target) => target.url === `chrome-extension://${extensionId}/popup.html`);
  }

  /** Opens the real action popup and returns a minimal driver for its document. */
  async function popup(source) {
    await source.bringToFront();
    await worker.evaluate(() => chrome.action.openPopup());
    let target;
    await expect.poll(async () => (target = await popupTarget())).toBeTruthy();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    let sequence = 0;
    const waiting = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
    };
    const evaluate = async (expression) => {
      const id = ++sequence;
      const reply = new Promise((resolve) => waiting.set(id, resolve));
      socket.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          // userGesture: optional permission requests need transient activation.
          params: { expression, awaitPromise: true, returnByValue: true, userGesture: true },
        }),
      );
      const { result, error } = await reply;
      if (error || result.exceptionDetails)
        throw new Error(error?.message || result.exceptionDetails.exception?.description);
      return result.result.value;
    };
    const q = (selector) => `document.querySelector(${JSON.stringify(selector)})`;
    const panel = {
      evaluate,
      click: (selector) => evaluate(`${q(selector)}.click()`),
      text: (selector) => evaluate(`${q(selector)}.textContent`),
      visible: (selector) =>
        evaluate(
          `(() => { const n = ${q(selector)}; return !!n && !n.hidden && !n.closest('[hidden]'); })()`,
        ),
      isOpen: async () => Boolean(await popupTarget()),
    };
    await expect.poll(() => panel.text('#source-title')).toContain('Synthetic');
    return panel;
  }

  async function tabId(page) {
    return worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, page.url());
  }

  async function selectBackgroundSource(panel, source) {
    await panel.click('#find');
    const id = await tabId(source);
    await expect
      .poll(() =>
        panel.evaluate(`(() => {
          const select = document.querySelector('#choose');
          const option = [...select.options].find((item) => item.textContent.endsWith('tab ${id}'));
          if (!option) return false;
          select.value = option.value;
          select.dispatchEvent(new Event('change'));
          return true;
        })()`),
      )
      .toBe(true);
  }

  async function expectOriginalReaderDetached(source) {
    // getTargets().attached includes Playwright. This checks the extension's own capability.
    expect(
      await worker.evaluate(async (url) => {
        const [tab] = await chrome.tabs.query({ url });
        try {
          await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.getFrameTree');
          return 'still attached';
        } catch (error) {
          return error.message;
        }
      }, source.url()),
    ).toMatch(/not attached/iu);
  }

  test('original capture reads the real selected-page response across reload and delivers all 128 turns', async () => {
    const source = await conversation('original-response');
    const panel = await popup(source);
    await panel.click('#original');
    await expect
      .poll(
        async () => {
          if (await panel.visible('#review')) return 'ready';
          return await panel.text('#status');
        },
        { timeout: 30_000 },
      )
      .toBe('ready');
    expect(await panel.text('#counts')).toContain('128 observed turns');
    expect(await panel.text('.badge')).toBe('Branch verified');
    await expectOriginalReaderDetached(source);
    const deskPromise = context.waitForEvent('page');
    await panel.click('#deliver');
    const desk = await deskPromise;
    await desk.waitForURL('http://127.0.0.1:43119/#capture');
    await expect(desk.locator('#conversation-title')).toHaveText('Synthetic original conversation');
    await expect(desk.locator('#verification')).toContainText('Selected branch verified');
    await desk.locator('#preview-btn').click();
    const markdown = await desk.locator('#preview-content').textContent();
    for (let index = 0; index < 128; index += 1)
      expect(markdown).toContain(
        originalResponse.mapping[`original-${index}`].message.content.parts[0],
      );
    expect(markdown.indexOf('Original turn 0')).toBeLessThan(markdown.indexOf('Original turn 127'));
  });

  test('original capture refuses to reload a page with an unsent draft', async () => {
    const source = await conversation('original-response');
    await source.evaluate(() => {
      const draft = document.createElement('textarea');
      draft.id = 'prompt-textarea';
      draft.value = 'Keep this synthetic unsent draft.';
      document.body.append(draft);
    });
    const panel = await popup(source);
    await panel.click('#original');
    await expect.poll(() => panel.text('#status')).toContain('unsent draft');
    expect(await panel.visible('#review')).toBe(false);
    await expect(source.locator('#prompt-textarea')).toHaveValue(
      'Keep this synthetic unsent draft.',
    );
    await expectOriginalReaderDetached(source);
  });

  test('original capture cancellation detaches and permits another capture', async () => {
    const source = await conversation('original-response');
    let release;
    let intercepted = false;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await source.route(
      'https://chatgpt.com/backend-api/conversation/original-response',
      async (route) => {
        intercepted = true;
        await held;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(originalResponse),
        });
      },
    );
    const panel = await popup(source);
    await panel.click('#original');
    await expect.poll(() => panel.text('#collection-phase')).toContain('Reading original');
    await expect.poll(() => intercepted).toBe(true);
    await panel.click('#cancel-collection');
    await expect.poll(() => panel.text('#status')).toContain('cancelled');
    await expectOriginalReaderDetached(source);
    release();
    await source.unrouteAll({ behavior: 'wait' });
    await panel.click('#original');
    await expect.poll(() => panel.visible('#review'), { timeout: 30_000 }).toBe(true);
    expect(await panel.text('#counts')).toContain('128 observed turns');
    await expectOriginalReaderDetached(source);
  });

  test('real popup collects only the selected virtualized page, in order, and reviews it as unverified', async () => {
    const source = await conversation('virtualized');
    const other = await conversation('other-conversation');
    await other.locator('[data-message-id="fixture-u"]').evaluate((node) => {
      node.textContent = 'DO NOT CAPTURE THIS OTHER PAGE';
    });
    const panel = await popup(source);
    await panel.click('#capture');
    await expect.poll(() => panel.visible('#review'), { timeout: 30_000 }).toBe(true);
    expect(await panel.text('#counts')).toContain('24 observed turns');
    expect(await panel.text('.badge')).toBe('Unverified');
    expect(await panel.text('#checks')).toMatch(/render|visible|complete|loaded/i);
    // Scroll position is restored on the real page after real isolated-world scrolling.
    await expect.poll(() => source.locator('main').evaluate((node) => node.scrollTop)).toBe(1904);
    await panel.click('#discard');
    expect(await panel.visible('#review')).toBe(false);
  });

  test('cancel in the real popup stops collection and nothing is reviewed', async () => {
    const source = await conversation('virtualized');
    const panel = await popup(source);
    await panel.click('#capture');
    await expect.poll(() => panel.visible('#collection-progress')).toBe(true);
    await panel.click('#cancel-collection');
    await expect.poll(() => panel.text('#status')).toContain('cancelled');
    expect(await panel.visible('#review')).toBe(false);
    // The worker lock is released: a second collection completes.
    await panel.click('#capture');
    await expect.poll(() => panel.visible('#review'), { timeout: 30_000 }).toBe(true);
  });

  test('closing the popup mid-collection aborts the worker job and frees the lock', async () => {
    const source = await conversation('virtualized');
    const panel = await popup(source);
    await panel.click('#capture');
    await expect.poll(() => panel.visible('#collection-progress')).toBe(true);
    await panel.evaluate('window.close()').catch(() => {});
    await expect.poll(() => panel.isOpen()).toBe(false);
    const reopened = await popup(source);
    await reopened.click('#snapshot');
    await expect.poll(() => reopened.visible('#review')).toBe(true);
  });

  test('optional discovery lists distinct existing tabs and focuses the selected identity', async () => {
    const one = await conversation('first-open');
    const two = await conversation('second-open');
    const panel = await popup(one);
    await panel.click('#find');
    await expect
      .poll(() => panel.evaluate(`document.querySelectorAll('#choose option').length`))
      .toBe(2);
    const labels = await panel.evaluate(
      `[...document.querySelectorAll('#choose option')].map((item) => item.textContent)`,
    );
    expect(labels[0]).not.toBe(labels[1]);
    const twoId = await tabId(two);
    await selectBackgroundSource(panel, two);
    await panel.click('#focus');
    await expect
      .poll(async () => worker.evaluate(async (id) => (await chrome.tabs.get(id)).active, twoId))
      .toBe(true);
  });

  test('navigation after source selection is rejected before extraction', async () => {
    const source = await conversation('before-navigation');
    const foreground = await conversation('active-conversation');
    const panel = await popup(foreground);
    await selectBackgroundSource(panel, source);
    await source.goto('https://chatgpt.com/c/after-navigation');
    await panel.click('#capture');
    await expect.poll(() => panel.text('#status')).toContain('changed');
    expect(await panel.visible('#review')).toBe(false);
  });

  test('reload after capture rejects stale document identity before handoff', async () => {
    const source = await conversation('before-reload');
    const foreground = await conversation('active-conversation');
    const panel = await popup(foreground);
    await selectBackgroundSource(panel, source);
    await panel.click('#snapshot');
    await expect.poll(() => panel.visible('#review')).toBe(true);
    await source.reload();
    await panel.click('#deliver');
    await expect.poll(() => panel.text('#status')).toContain('reloaded');
    expect(
      context.pages().filter((page) => page.url().startsWith('http://127.0.0.1:43119/')),
    ).toHaveLength(0);
  });

  test('extension delivers source to real local desk and preserves selected content', async () => {
    const source = await conversation('handoff');
    const panel = await popup(source);
    await panel.click('#snapshot');
    await expect.poll(() => panel.visible('#review')).toBe(true);
    const deskPromise = context.waitForEvent('page');
    await panel.click('#deliver');
    const desk = await deskPromise;
    await desk.waitForURL('http://127.0.0.1:43119/#capture');
    await expect(desk.locator('#conversation-title')).toContainText(
      'Synthetic browser conversation',
    );
    await expect(desk.locator('#verification')).toContainText('unverified');
    await desk.locator('#preview-btn').click();
    await expect(desk.locator('#preview-content')).toContainText('Keep this exact user line.');
    await expect(desk.locator('#preview-content')).toContainText('const result');
    await expect(desk.locator('#preview-content')).toContainText('https://example.com/reference');
  });
});

// Actual browser DOM/bridge execution with explicit Chrome API mocks. This is
// not evidence of installed-extension permission grants or action lifecycle.
test.describe('portable transport API harness (Chrome APIs mocked)', () => {
  let browser, context, tabs, listener, connectListener, source, activeCalls, onCreate;
  const runtimeId = 'fixture-extension-id';
  const sender = { id: runtimeId, url: `chrome-extension://${runtimeId}/popup.html` };
  async function recordPage(page, id) {
    const item = { page, id, windowId: 1, active: false, documentId: crypto.randomUUID() };
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) item.documentId = crypto.randomUUID();
    });
    tabs.set(id, item);
    return item;
  }
  const tabData = (item) => ({
    id: item.id,
    windowId: 1,
    url: item.page.url(),
    title: 'Synthetic browser conversation',
    active: item.active,
    status: 'complete',
  });
  const selected = () => ({ tabId: 1, windowId: 1, url: source.page.url() });
  function send(message, from = sender) {
    return new Promise((resolve) => {
      if (!listener(message, from, resolve)) resolve({ rejectedCaller: true });
    });
  }
  function openPort(onPacket = () => {}, from = sender) {
    const messages = [],
      disconnects = [];
    let closed = false;
    const received = [];
    const port = {
      name: 'collection',
      sender: from,
      onMessage: { addListener: (fn) => messages.push(fn) },
      onDisconnect: { addListener: (fn) => disconnects.push(fn) },
      postMessage: (packet) => {
        if (closed) throw new Error('Port closed');
        received.push(packet);
        onPacket(packet);
      },
      disconnect: () => {
        if (closed) return;
        closed = true;
        for (const fn of disconnects) fn();
      },
    };
    connectListener(port);
    return {
      send: (packet) => {
        if (closed) throw new Error('Port closed');
        for (const fn of messages) fn(packet);
      },
      disconnect: port.disconnect,
      received,
      get closed() {
        return closed;
      },
    };
  }
  async function virtualSource() {
    await context.route('https://chatgpt.com/c/virtual-collection', (route) =>
      route.fulfill({ contentType: 'text/html', body: collectionFixture }),
    );
    await source.page.goto('https://chatgpt.com/c/virtual-collection');
    return source.page.locator('#thread').evaluate((node) => node.scrollTop);
  }
  test.beforeEach(async () => {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      headless: true,
      args: ['--no-sandbox'],
    });
    context = await browser.newContext();
    tabs = new Map();
    activeCalls = [];
    onCreate = null;
    await context.route('https://chatgpt.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: fixture() }),
    );
    source = await recordPage(await context.newPage(), 1);
    await source.page.goto('https://chatgpt.com/c/synthetic-harness');
    source.active = true;
    globalThis.chrome = {
      runtime: {
        id: runtimeId,
        getURL: (name) => `chrome-extension://${runtimeId}/${name}`,
        onMessage: {
          addListener: (fn) => {
            listener = fn;
          },
        },
        onConnect: {
          addListener: (fn) => {
            connectListener = fn;
          },
        },
      },
      permissions: { contains: async () => true },
      windows: { update: async () => ({ id: 1 }) },
      tabs: {
        get: async (id) => tabData(tabs.get(id)),
        query: async ({ url } = {}) =>
          [...tabs.values()]
            .filter(
              (item) =>
                !url ||
                (String(url).includes('127.0.0.1')
                  ? item.page.url().startsWith('http://127.0.0.1:')
                  : item.page.url().startsWith('https://chatgpt.com/')),
            )
            .map(tabData),
        create: async ({ url, active }) => {
          const item = await recordPage(await context.newPage(), tabs.size + 1);
          item.active = active;
          await item.page.goto(url);
          if (onCreate) await onCreate(item);
          return tabData(item);
        },
        update: async (id, update) => {
          const item = tabs.get(id);
          if (update.url && update.url !== item.page.url()) await item.page.goto(update.url);
          if (update.active) {
            activeCalls.push(id);
            for (const candidate of tabs.values()) candidate.active = candidate.id === id;
          }
          return tabData(item);
        },
      },
      scripting: {
        executeScript: async ({ target, func, args = [] }) => {
          const item = tabs.get(target.tabId);
          if (target.documentIds && !target.documentIds.includes(item.documentId))
            throw new Error('Document changed');
          const documentId = item.documentId;
          const result = await item.page.evaluate(
            `(${func.toString()})(...${JSON.stringify(args)})`,
          );
          return [{ result, documentId, frameId: 0 }];
        },
      },
    };
    await import(
      `${pathToFileURL(path.resolve('dist/extension/worker.js')).href}?harness=${crypto.randomUUID()}`
    );
  });
  test.afterEach(async () => {
    delete globalThis.chrome;
    await browser.close();
  });

  test('trusted popup captures selected DOM; content-script and foreign callers fail', async () => {
    expect(
      (await send({ type: 'capture', selected: selected() }, { ...sender, tab: { id: 1 } }))
        .rejectedCaller,
    ).toBe(true);
    expect(
      (await send({ type: 'capture', selected: selected() }, { ...sender, id: 'other' }))
        .rejectedCaller,
    ).toBe(true);
    const result = await send({ type: 'capture', selected: selected() });
    expect(result.ok).toBe(true);
    expect(result.model.turns).toHaveLength(2);
    expect(result.model.verification.status).toBe('unverified');
    expect(result.model.turns[0].markdown).toContain('Keep this exact user line.');
    expect(result.identity.documentId).toBe(source.documentId);
  });
  test('collection port gathers virtualized turns, reports observed progress and restores scroll', async () => {
    const initialTop = await virtualSource();
    const snapshot = await send({ type: 'capture', selected: selected() });
    expect(snapshot.model.turns.length).toBeLessThan(24);
    const jobId = 'b'.repeat(32);
    const port = openPort();
    port.send({ type: 'collect', jobId, selected: selected() });
    await expect
      .poll(() => port.received.find((packet) => ['done', 'error'].includes(packet.type)), {
        timeout: 25_000,
      })
      .toBeTruthy();
    const final = port.received.at(-1);
    expect(final.type, JSON.stringify(final)).toBe('done');
    expect(final.model.turns).toHaveLength(24);
    expect(final.model.turns.map((turn) => turn.markdown)).toEqual(
      Array.from({ length: 24 }, (_, i) => `Observed turn ${i} — synthetic content only.`),
    );
    expect(final.model.verification.status).toBe('unverified');
    expect(final.model.source.collection.stoppedReason).toBe('observed-boundaries');
    expect(
      port.received.some((packet) => packet.type === 'progress' && packet.phase === 'up'),
    ).toBe(true);
    expect(
      port.received.some((packet) => packet.type === 'progress' && packet.phase === 'down'),
    ).toBe(true);
    expect(await source.page.locator('#thread').evaluate((node) => node.scrollTop)).toBe(
      initialTop,
    );
    port.disconnect();
  });
  test('cancel discards collected content and releases the collection lock after restore', async () => {
    const initialTop = await virtualSource();
    const jobId = 'c'.repeat(32);
    const port = openPort((packet) => {
      if (packet.type === 'progress' && packet.phase === 'up' && packet.steps >= 1)
        port.send({ type: 'cancel', jobId });
    });
    port.send({ type: 'collect', jobId, selected: selected() });
    const second = openPort();
    second.send({ type: 'collect', jobId: 'd'.repeat(32), selected: selected() });
    expect(second.received[0].code).toBe('busy');
    await expect.poll(() => port.received.find((packet) => packet.type === 'error')).toBeTruthy();
    expect(port.received.at(-1).code).toBe('cancelled');
    expect(port.received.some((packet) => packet.type === 'done' || packet.model)).toBe(false);
    expect(await source.page.locator('#thread').evaluate((node) => node.scrollTop)).toBe(
      initialTop,
    );
    expect((await send({ type: 'capture', selected: selected() })).ok).toBe(true);
    port.disconnect();
    second.disconnect();
  });
  test('popup disconnect cancels collection and foreign ports never acquire the source', async () => {
    const initialTop = await virtualSource();
    expect(openPort(() => {}, { ...sender, tab: { id: 1 } }).closed).toBe(true);
    const jobId = 'e'.repeat(32);
    const port = openPort((packet) => {
      if (packet.type === 'progress' && packet.phase === 'up' && packet.steps >= 1)
        port.disconnect();
    });
    port.send({ type: 'collect', jobId, selected: selected() });
    await expect.poll(() => port.closed).toBe(true);
    await expect
      .poll(async () => (await send({ type: 'capture', selected: selected() })).ok)
      .toBe(true);
    expect(await source.page.locator('#thread').evaluate((node) => node.scrollTop)).toBe(
      initialTop,
    );
    expect(port.received.some((packet) => packet.type === 'done')).toBe(false);
  });
  test('actual browser handshake adopts captured source in the local desk', async () => {
    const capture = await send({ type: 'capture', selected: selected() });
    expect(await send({ type: 'deliver', ...capture })).toEqual({ ok: true, accepted: true });
    const desk = tabs.get(2).page;
    await expect(desk.locator('#conversation-title')).toContainText(
      'Synthetic browser conversation',
    );
    await expect(desk.locator('#verification')).toContainText('unverified');
    await desk.locator('#preview-btn').click();
    await expect(desk.locator('#preview-content')).toContainText('https://example.com/reference');
    await expect(desk.locator('#preview-content')).toContainText('const result');
    expect(activeCalls).toHaveLength(1);
  });
  test('shared source lifetime expires by injected clock without changing capture time', async () => {
    const capture = await send({ type: 'capture', selected: selected() });
    const capturedAt = capture.capturedAt;
    const originalNow = Date.now;
    let result;
    try {
      Date.now = () => capturedAt + CAPTURE_MAX_AGE + 1;
      result = await send({ type: 'deliver', ...capture });
    } finally {
      Date.now = originalNow;
    }
    expect(result.ok).toBe(false);
    expect(result.error).toContain('expired');
    expect(capture.capturedAt).toBe(capturedAt);
    expect(tabs.size).toBe(1);
    // Ordinary downloads can take longer than the former two-minute source age.
    expect(await send({ type: 'deliver', ...capture, capturedAt: capturedAt - 180_000 })).toEqual({
      ok: true,
      accepted: true,
    });
  });
  test('reloaded source or navigation during desk startup rejects stale capture', async () => {
    const first = await send({ type: 'capture', selected: selected() });
    await source.page.reload();
    const reload = await send({ type: 'deliver', ...first });
    expect(reload.ok).toBe(false);
    expect(reload.error).toContain('reloaded');
    const second = await send({ type: 'capture', selected: selected() });
    onCreate = async () => source.page.goto('https://chatgpt.com/c/another-conversation');
    const changed = await send({ type: 'deliver', ...second });
    expect(changed.ok).toBe(false);
    expect(changed.error).toContain('changed');
    expect(activeCalls).toHaveLength(0);
  });
  test('concurrent delivery rejects synchronously and produces a single receipt', async () => {
    const capture = await send({ type: 'capture', selected: selected() });
    const [one, two] = await Promise.all([
      send({ type: 'deliver', ...capture }),
      send({ type: 'deliver', ...capture }),
    ]);
    expect(one).toEqual({ ok: true, accepted: true });
    expect(two.ok).toBe(false);
    expect(two.error).toContain('already waiting');
    expect(tabs.size).toBe(2);
  });
  test('unready desk remains inactive and returns an actionable failure', async () => {
    await context.route('http://127.0.0.1:43119/', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Unavailable desk</title>',
      }),
    );
    const capture = await send({ type: 'capture', selected: selected() });
    const result = await send({ type: 'deliver', ...capture });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not ready');
    expect(activeCalls).toHaveLength(0);
    expect(source.active).toBe(true);
  });
  test('rendered popup freezes source controls during permission and reports denial', async () => {
    const panel = await context.newPage();
    await context.route('http://127.0.0.1:43119/extension/*', async (route) => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1);
      await route.fulfill({
        body: await readFile(path.join('dist/extension', name)),
        contentType: name.endsWith('.js')
          ? 'text/javascript'
          : name.endsWith('.css')
            ? 'text/css'
            : 'text/html',
      });
    });
    await panel.exposeFunction('harnessMessage', (message) => send(message));
    await panel.addInitScript((tab) => {
      window.chrome = {
        tabs: { query: async () => [tab] },
        runtime: { sendMessage: (message) => window.harnessMessage(message) },
        permissions: {
          request: () =>
            new Promise((resolve) => {
              window.harnessPermission = resolve;
            }),
        },
      };
    }, tabData(source));
    await panel.goto('http://127.0.0.1:43119/extension/popup.html');
    await panel.locator('#snapshot').click();
    await expect(panel.locator('#review')).toBeVisible();
    await expect(panel.locator('#counts')).toContainText('file ref');
    await panel.locator('#deliver').scrollIntoViewIfNeeded();
    await mkdir('artifacts', { recursive: true });
    await panel.locator('body').screenshot({ path: 'artifacts/08-browser-capture-harness.png' });
    await panel.locator('#deliver').click();
    for (const id of [
      'deliver',
      'capture',
      'snapshot',
      'find',
      'focus',
      'choose',
      'discard',
      'copy',
    ])
      await expect(panel.locator(`#${id}`)).toBeDisabled();
    await panel.evaluate(() => window.harnessPermission(false));
    await expect(panel.locator('#status')).toContainText('not allowed');
    await expect(panel.locator('#discard')).toBeEnabled();
    await panel.locator('#discard').click();
    await expect(panel.locator('#review')).toBeHidden();
  });
  test('popup shows collection progress/cancel and ignores late tab-discovery selection', async () => {
    await virtualSource();
    const panel = await context.newPage();
    let wire;
    await context.route('http://127.0.0.1:43119/extension/*', async (route) => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1);
      await route.fulfill({
        body: await readFile(path.join('dist/extension', name)),
        contentType: name.endsWith('.js')
          ? 'text/javascript'
          : name.endsWith('.css')
            ? 'text/css'
            : 'text/html',
      });
    });
    await panel.exposeFunction('harnessMessage', (message) => send(message));
    await panel.exposeFunction('harnessPortSend', (message) => {
      wire ??= openPort((packet) => {
        void panel.evaluate((data) => window.harnessPortReceive(data), packet).catch(() => {});
      });
      wire.send(message);
    });
    await panel.exposeFunction('harnessPortClose', () => wire?.disconnect());
    await panel.addInitScript((tab) => {
      window.chrome = {
        tabs: {
          query: (query) =>
            query.url
              ? new Promise((resolve) => {
                  window.harnessDiscovery = resolve;
                })
              : Promise.resolve([tab]),
        },
        permissions: { request: async () => true },
        runtime: {
          sendMessage: (message) => window.harnessMessage(message),
          connect: () => {
            const receives = [],
              disconnects = [];
            window.harnessPortReceive = (packet) => receives.forEach((fn) => fn(packet));
            return {
              onMessage: { addListener: (fn) => receives.push(fn) },
              onDisconnect: { addListener: (fn) => disconnects.push(fn) },
              postMessage: (packet) => {
                void window.harnessPortSend(packet);
              },
              disconnect: () => {
                void window.harnessPortClose();
              },
            };
          },
        },
      };
    }, tabData(source));
    await panel.goto('http://127.0.0.1:43119/extension/popup.html');
    await panel.locator('#find').click();
    await expect.poll(() => panel.evaluate(() => typeof window.harnessDiscovery)).toBe('function');
    await panel.locator('#capture').click();
    await expect(panel.locator('#collection-progress')).toBeVisible();
    await expect(panel.locator('#collection-count')).toContainText('turns observed');
    await panel.evaluate(() =>
      window.harnessDiscovery([
        { id: 999, windowId: 1, title: 'Wrong late choice', url: 'https://chatgpt.com/c/other' },
      ]),
    );
    await expect(panel.locator('#source-title')).toHaveText('Synthetic browser conversation');
    await expect(panel.locator('#snapshot')).toBeDisabled();
    await mkdir('artifacts', { recursive: true });
    await panel
      .locator('body')
      .screenshot({ path: 'artifacts/10-collection-progress-harness.png' });
    await panel.locator('#cancel-collection').click();
    await expect(panel.locator('#status')).toContainText('cancelled');
    await expect(panel.locator('#collection-progress')).toBeHidden();
    await expect(panel.locator('#capture')).toBeEnabled();
    await expect(panel.locator('#review')).toBeHidden();
    await panel.locator('#snapshot').click();
    await expect(panel.locator('#review')).toBeVisible();
  });
  test('optional download UI uses the selected receipt and locks capture until completion or cancel', async () => {
    const downloadCalls = [],
      searches = [],
      cancellations = [];
    let completed = false;
    globalThis.chrome.downloads = {
      download: async (options) => {
        downloadCalls.push(options);
        return 80 + downloadCalls.length;
      },
      search: async ({ id }) => {
        searches.push(id);
        return [
          {
            id,
            state: completed ? 'complete' : 'in_progress',
            danger: 'safe',
            filename: '/synthetic/Downloads/notes.txt',
            bytesReceived: completed ? 12 : 2,
            totalBytes: 12,
            fileSize: 12,
          },
        ];
      },
      cancel: async (id) => {
        cancellations.push(id);
      },
    };
    const panel = await context.newPage();
    await context.route('http://127.0.0.1:43119/extension/*', async (route) => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1);
      await route.fulfill({
        body: await readFile(path.join('dist/extension', name)),
        contentType: name.endsWith('.js')
          ? 'text/javascript'
          : name.endsWith('.css')
            ? 'text/css'
            : 'text/html',
      });
    });
    await panel.exposeFunction('harnessMessage', (message) => send(message));
    await panel.addInitScript((tab) => {
      window.harnessPermissions = [];
      window.addEventListener('gh-capture', (event) => {
        window.harnessCapture = event.detail;
      });
      window.chrome = {
        tabs: { query: async () => [tab] },
        runtime: { sendMessage: (message) => window.harnessMessage(message) },
        permissions: {
          request: async (permission) => {
            window.harnessPermissions.push(permission);
            return true;
          },
        },
      };
    }, tabData(source));
    await panel.goto('http://127.0.0.1:43119/extension/popup.html');
    await panel.locator('#snapshot').click();
    const files = panel.locator('#download-assistance');
    await expect(files).toBeVisible();
    await files.locator('[data-start]').click();
    await expect(panel.locator('#capture')).toBeDisabled();
    await expect(panel.locator('#snapshot')).toBeDisabled();
    await expect(panel.locator('#deliver')).toBeDisabled();
    await expect.poll(() => downloadCalls.length).toBe(1);
    expect(downloadCalls[0].url).toBe('https://chatgpt.com/files/synthetic-notes.txt');
    expect(await panel.evaluate(() => window.harnessPermissions)).toEqual([
      { permissions: ['downloads'] },
    ]);
    completed = true;
    await expect(files).toContainText('Download complete');
    await expect(panel.locator('#capture')).toBeEnabled();
    const attachment = await panel.evaluate(() => window.harnessCapture.model.attachments[0]);
    expect(attachment.download).toEqual({ name: 'notes.txt', size: 12 });
    expect(attachment.status).toBe('download-needed');
    expect(attachment.localFileId).toBeUndefined();
    expect(searches.every((id) => id === 81)).toBe(true);
    completed = false;
    await files.locator('[data-start]').click();
    await expect.poll(() => downloadCalls.length).toBe(2);
    await files.getByRole('button', { name: 'Cancel download' }).click();
    await expect.poll(() => cancellations).toContain(82);
    await expect(panel.locator('#capture')).toBeEnabled();
  });
});

test('production manifest contains no background capture, cookie or broad host grant', async () => {
  const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
  expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'storage', 'nativeMessaging']);
  expect(manifest.action.default_popup).toBe('chat.html');
  expect(manifest.key).toBeTruthy();
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.externally_connectable).toBeUndefined();
  expect(manifest.optional_host_permissions).toEqual([
    'https://chatgpt.com/*',
    'https://chat.openai.com/*',
    'http://127.0.0.1/*',
  ]);
});
