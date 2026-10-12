import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { captureChatGPT } from '../../src/capture.js';
import { validateConversation } from '../../src/model.js';

const fixture = await readFile(new URL('../fixtures/chatgpt-page.html', import.meta.url), 'utf8');
async function load(page, url = 'https://chatgpt.com/c/synthetic-fixture') {
  await page.route('https://chatgpt.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: fixture }),
  );
  await page.goto(url);
}

test('self-contained capture preserves rendered order, Markdown, code, citations, and file references', async ({
  page,
}) => {
  await load(page);
  const model = validateConversation(await page.evaluate(captureChatGPT));
  expect(model.source.type).toBe('dom-snapshot');
  expect(model.source.capture.observedTurns).toBe(2);
  expect(model.source.capture.observedIndices).toEqual([0, 1]);
  expect(model.source.capture.hiddenTurns).toBe(0);
  expect(model.turns.map((turn) => turn.id)).toEqual(['user-1', 'assistant-1']);
  expect(model.turns.every((turn) => turn.contentFidelity === 'rendered-text')).toBe(true);
  expect(model.verification.status).toBe('unverified');
  const markdown = model.turns[1].markdown;
  expect(markdown).toContain('## A small example');
  expect(markdown).toContain('**clear words**');
  expect(markdown).toContain('*quiet emphasis*');
  expect(markdown).toContain('`inline <code>`');
  expect(markdown).toContain('3. Third item');
  expect(markdown).toContain('Nested item');
  expect(markdown).toContain('````python\nprint("<hello>")\n  # keep two spaces\n```\n````');
  expect(markdown).toContain('| pipe \\| cell | 42 |');
  expect(markdown).toContain('> A quoted thought.');
  expect(model.turns[1].citations.map((citation) => citation.url)).toEqual([
    'https://example.org/reference?section=one',
    'https://example.net/paper',
  ]);
  expect(model.attachments.map((file) => [file.name, file.status])).toEqual([
    ['report.csv', 'download-needed'],
    ['old-notes.txt', 'expired'],
    ['missing.pdf', 'inaccessible'],
  ]);
  expect(model.attachments.every((file) => !file.localFileId)).toBe(true);
  expect(model.turns[0].sourceLocator).toContain('[data-message-id="user-1"]');
  const serialized = JSON.stringify(model);
  for (const omitted of [
    'SIDEBAR HISTORY',
    'NAVIGATION MUST',
    'HIDDEN CONTENT',
    'SCRIPT CONTENT',
    'Copy code',
    'Good response',
  ])
    expect(serialized).not.toContain(omitted);
});

test('missing indices, reported counts, hidden variants, branch controls and streaming remain explicit', async ({
  page,
}) => {
  await load(page);
  await page.evaluate(() => {
    const main = document.querySelector('main');
    main.setAttribute('aria-setsize', '8');
    const articles = main.querySelectorAll('article');
    articles[0].setAttribute('data-testid', 'conversation-turn-3');
    articles[0].setAttribute('aria-posinset', '4');
    articles[0].setAttribute('aria-setsize', '8');
    articles[1].setAttribute('data-testid', 'conversation-turn-6');
    articles[1].setAttribute('aria-posinset', '7');
    articles[1].setAttribute('aria-setsize', '8');
    articles[1].setAttribute('aria-busy', 'true');
    main.insertAdjacentHTML(
      'beforeend',
      '<button aria-label="Previous response">Previous</button><span>2 / 2</span><button data-testid="stop-button">Stop generating</button><article hidden data-testid="conversation-turn-7"><div data-message-author-role="assistant" data-message-id="hidden-variant"><div class="markdown">SECRET HIDDEN VARIANT</div></div></article>',
    );
  });
  const model = validateConversation(await page.evaluate(captureChatGPT));
  expect(model.turns).toHaveLength(2);
  expect(model.source.capture).toMatchObject({
    observedIndices: [3, 6],
    reportedTotal: 8,
    streaming: true,
    branchControls: true,
  });
  expect(model.source.capture.hiddenTurns).toBeGreaterThan(0);
  for (const code of [
    'rendered-snapshot',
    'missing-indices',
    'reported-missing-turns',
    'hidden-turns',
    'streaming',
    'branch-controls',
  ])
    expect(model.verification.issues.some((issue) => issue.code === code)).toBe(true);
  expect(JSON.stringify(model)).not.toContain('SECRET HIDDEN VARIANT');
  expect(model.verification.status).toBe('unverified');
});

test('unsupported media, empty turns and unopened source controls report missing content', async ({
  page,
}) => {
  await load(page);
  await page.evaluate(() => {
    document.querySelector('[data-message-id="user-1"] .whitespace-pre-wrap').textContent = '';
    document
      .querySelector('.markdown')
      .insertAdjacentHTML(
        'beforeend',
        '<img alt="Synthetic diagram"><button aria-label="Open sources">Sources</button><p><a href="javascript:alert(1)">Unsafe link</a></p>',
      );
  });
  const model = validateConversation(await page.evaluate(captureChatGPT));
  for (const code of [
    'empty-rendered-turn',
    'unsupported-rendered-content',
    'unopened-sources',
    'unusable-link',
  ])
    expect(model.verification.issues.some((issue) => issue.code === code)).toBe(true);
  expect(model.turns[1].markdown).toContain('[Synthetic diagram]');
  expect(JSON.stringify(model)).not.toContain('javascript:');
});

test('a generated image with a Download control keeps an unresolved file reference without inventing a URL', async ({
  page,
}) => {
  await load(page);
  await page.evaluate(() => {
    document
      .querySelector('.markdown')
      .insertAdjacentHTML(
        'beforeend',
        '<div><img alt="Synthetic generated image"><button aria-label="Download image">Download</button></div>',
      );
  });
  const model = validateConversation(await page.evaluate(captureChatGPT));
  const attachment = model.attachments.find((file) => file.name === 'Downloadable image');
  expect(attachment).toMatchObject({ turnId: 'assistant-1', status: 'download-needed' });
  expect(attachment.sourceLocator).toContain('download-control');
  expect(attachment.url).toBeUndefined();
  expect(
    model.verification.issues.some(
      (issue) =>
        issue.code === 'unresolved-download' &&
        issue.message.includes('filename and URL are unknown'),
    ),
  ).toBe(true);
});

test('capture only reads DOM: no scrolling, clipboard, download clicks, or additional network requests', async ({
  page,
}) => {
  await load(page);
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.evaluate(() => {
    window.__captureEffects = [];
    window.fetch = () => {
      window.__captureEffects.push('fetch');
      throw new Error('Unexpected fetch');
    };
    window.scrollTo = () => window.__captureEffects.push('scroll');
    Element.prototype.scrollIntoView = () => window.__captureEffects.push('scrollIntoView');
    HTMLElement.prototype.click = () => window.__captureEffects.push('click');
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => window.__captureEffects.push('clipboard') },
      configurable: true,
    });
  });
  await page.evaluate(captureChatGPT);
  expect(await page.evaluate(() => window.__captureEffects)).toEqual([]);
  expect(requests).toEqual([]);
});

test('page identity, unsupported locations, and no visible turns fail with recovery actions', async ({
  page,
}) => {
  await load(page);
  await expect(
    page.evaluate(captureChatGPT, { expectedUrl: 'https://chatgpt.com/c/another' }),
  ).rejects.toThrow('page changed');
  await page.goto('https://chatgpt.com/');
  await expect(page.evaluate(captureChatGPT)).rejects.toThrow('Open a selected');
  await page.goto('https://chatgpt.com/c/synthetic-fixture');
  await page.evaluate(() => document.querySelector('main').replaceChildren());
  await expect(page.evaluate(captureChatGPT)).rejects.toThrow('No visible');
});

test('share and custom GPT conversation paths retain current source identity', async ({ page }) => {
  for (const url of [
    'https://chatgpt.com/share/synthetic-shared',
    'https://chatgpt.com/g/g-synthetic/c/synthetic-gpt?view=one#current',
  ]) {
    await load(page, url);
    const model = validateConversation(await page.evaluate(captureChatGPT, { expectedUrl: url }));
    expect(model.source.url).toBe(new URL(url).origin + new URL(url).pathname);
    expect(model.source.id).toBe(new URL(url).pathname.split('/').at(-1));
  }
});

test('same-document content or branch mutation during capture requires recapture', async ({
  page,
}) => {
  await load(page);
  await page.evaluate(() => {
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
    let calls = 0;
    crypto.subtle.digest = async (...args) => {
      if (++calls === 1)
        queueMicrotask(() => {
          document.querySelector('[data-message-id="assistant-1"] .markdown p').textContent =
            'Changed branch content';
        });
      return originalDigest(...args);
    };
  });
  await expect(page.evaluate(captureChatGPT)).rejects.toThrow('rendered conversation changed');
});

test('same-text attributes changing during either digest require recapture, including the closing digest', async ({
  page,
}) => {
  for (const phase of [1, 2]) {
    for (const kind of ['href', 'download', 'status', 'format']) {
      await load(page);
      await page.evaluate(
        ({ phase, kind }) => {
          const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
          let calls = 0;
          crypto.subtle.digest = async (...args) => {
            const currentCall = ++calls;
            const digest = await originalDigest(...args);
            if (currentCall === phase) {
              if (kind === 'href')
                document
                  .querySelector('a[title="Synthetic reference"]')
                  .setAttribute('href', 'https://example.org/changed-destination');
              if (kind === 'download')
                document
                  .querySelector('a[download="report.csv"]')
                  .setAttribute('download', 'changed-filename.csv');
              if (kind === 'status')
                document
                  .querySelector('[data-file-status]')
                  .setAttribute('data-file-status', 'inaccessible');
              if (kind === 'format')
                document
                  .querySelector('.markdown p')
                  .setAttribute('style', 'white-space: pre-wrap');
            }
            return digest;
          };
        },
        { phase, kind },
      );
      await expect(
        page.evaluate(captureChatGPT),
        `${kind} changed during digest ${phase}`,
      ).rejects.toThrow('rendered conversation changed');
    }
  }
});

test('pending mutation records are drained before returning a snapshot', async ({ page }) => {
  await load(page);
  await page.evaluate(() => {
    const stringify = JSON.stringify;
    let changed = false;
    JSON.stringify = (...args) => {
      if (!changed && args[0]?.schemaVersion === 1) {
        changed = true;
        document
          .querySelector('a[title="Synthetic reference"]')
          .setAttribute('href', 'https://example.org/changed-before-return');
      }
      return stringify(...args);
    };
  });
  await expect(page.evaluate(captureChatGPT)).rejects.toThrow('rendered conversation changed');
});

test('the scoped observer is disconnected after success and every capture error', async ({
  page,
}) => {
  for (const outcome of ['success', 'empty', 'digest-error']) {
    await load(page);
    await page.evaluate((outcome) => {
      const NativeObserver = MutationObserver;
      window.__observerLifecycle = { active: 0, disconnected: 0 };
      window.MutationObserver = class extends NativeObserver {
        observe(...args) {
          window.__observerLifecycle.active += 1;
          return super.observe(...args);
        }
        disconnect() {
          window.__observerLifecycle.active -= 1;
          window.__observerLifecycle.disconnected += 1;
          return super.disconnect();
        }
      };
      if (outcome === 'empty') document.querySelector('main').replaceChildren();
      if (outcome === 'digest-error')
        crypto.subtle.digest = async () => {
          throw new Error('Synthetic digest failure');
        };
    }, outcome);
    if (outcome === 'success') await page.evaluate(captureChatGPT);
    else
      await expect(page.evaluate(captureChatGPT)).rejects.toThrow(
        outcome === 'empty' ? 'No visible' : 'Synthetic digest failure',
      );
    expect(await page.evaluate(() => window.__observerLifecycle)).toEqual({
      active: 0,
      disconnected: 1,
    });
  }
});

test('large rendered text is bounded and explicitly truncated rather than marked complete', async ({
  page,
}) => {
  await load(page);
  await page.evaluate(() => {
    document.querySelector('[data-message-id="assistant-1"] .markdown').textContent = '界'.repeat(
      3 * 1024 * 1024,
    );
  });
  const model = validateConversation(await page.evaluate(captureChatGPT));
  expect(model.source.capture.truncated).toBe(true);
  expect(model.verification.status).toBe('unverified');
  expect(model.verification.issues.some((issue) => issue.code === 'snapshot-limit')).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(model))).toBeLessThanOrEqual(8 * 1024 * 1024);
});
