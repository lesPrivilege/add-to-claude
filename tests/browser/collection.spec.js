import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { captureChatGPT } from '../../src/capture.js';
import { collectConversation, CollectionError } from '../../src/collect.js';
import { inspectConversationViewport, scrollConversationViewport } from '../../src/page-scroll.js';

const fixture = await readFile(
  new URL('../fixtures/chatgpt-virtualized.html', import.meta.url),
  'utf8',
);
const url = 'https://chatgpt.com/c/synthetic-virtualized';
const fast = {
  settleMs: 35,
  boundaryHoldMs: 150,
  boundarySamples: 3,
  stallMs: 450,
  maxDurationMs: 15000,
};
async function setup(page, configuration = {}) {
  await page.route('https://chatgpt.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: fixture }),
  );
  await page.goto(url);
  await page.evaluate((configuration) => window.fixture.configure(configuration), configuration);
  await page.waitForTimeout(40);
  return {
    snapshot: () => page.evaluate(captureChatGPT, { expectedUrl: url }),
    viewport: (options) =>
      page.evaluate(inspectConversationViewport, { expectedUrl: url, ...options }),
    scroll: (command) =>
      page.evaluate(scrollConversationViewport, { expectedUrl: url, ...command }),
    restore: (command) =>
      page.evaluate(scrollConversationViewport, { expectedUrl: url, ...command }),
  };
}

test('overlapping virtualized windows accumulate every observed ID in order and restore scroll', async ({
  page,
}) => {
  const driver = await setup(page);
  const original = (await driver.viewport()).scrollTop;
  const progress = [];
  const model = await collectConversation(driver, {
    ...fast,
    onProgress: (event) => progress.push(event),
  });
  expect(model.turns.map((turn) => turn.id)).toEqual(
    Array.from({ length: 18 }, (_, index) => `turn-${index}`),
  );
  expect(model.turns[7].markdown).toBe(model.turns[8].markdown);
  expect(model.turns[7].id).not.toBe(model.turns[8].id);
  expect(model.source.collection).toMatchObject({
    orderedTurns: 18,
    startObserved: true,
    endObserved: true,
    restoredScroll: true,
    stoppedReason: 'observed-boundaries',
    gaps: [],
  });
  expect(model.source.collection.reportedTotal).toBeUndefined();
  expect(model.verification.status).toBe('unverified');
  expect(model.verification.issues.some((issue) => issue.message.includes('do not prove'))).toBe(
    true,
  );
  expect((await driver.viewport()).scrollTop).toBe(original);
  expect(progress.some((event) => event.phase === 'up')).toBe(true);
  expect(progress.some((event) => event.phase === 'down')).toBe(true);
  expect(await page.evaluate(() => globalThis.__gptHandoffCollectionScroll)).toBeUndefined();
});

test('delayed head and tail loading are collected through normal scrolling without a reported total', async ({
  page,
}) => {
  const driver = await setup(page, { lazyHead: true, lazyTail: true, start: 300, delay: 180 });
  const originalAnchor = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-message-id]'))
      .find((node) => node.getBoundingClientRect().top >= 0)
      ?.getAttribute('data-message-id'),
  );
  const model = await collectConversation(driver, { ...fast, boundaryHoldMs: 250, stallMs: 700 });
  expect(model.turns.map((turn) => turn.renderedIndex)).toEqual(
    Array.from({ length: 18 }, (_, index) => index),
  );
  expect(model.source.collection.stoppedReason).toBe('observed-boundaries');
  expect(model.verification.status).toBe('unverified');
  await page.waitForTimeout(50);
  expect(
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-message-id]'))
        .find((node) => node.getBoundingClientRect().top >= 0)
        ?.getAttribute('data-message-id'),
    ),
  ).toBe(originalAnchor);
  expect(model.source.collection.restoredScroll).toBe(true);
});

test('branch and hidden-variant evidence survives when later windows no longer expose it', async ({
  page,
}) => {
  const driver = await setup(page);
  const snapshot = driver.snapshot;
  let reads = 0;
  driver.snapshot = async () => {
    const model = await snapshot();
    if (++reads === 1) {
      model.source.capture.branchControls = true;
      model.source.capture.hiddenTurns = 2;
    }
    return model;
  };
  const model = await collectConversation(driver, fast);
  expect(model.source.capture).toMatchObject({ branchControls: true, hiddenTurns: 2 });
});

test('structural source IDs are required even when diagnostic issues were capped or removed', async ({
  page,
}) => {
  const driver = await setup(page);
  const snapshot = driver.snapshot;
  driver.snapshot = async () => {
    const model = await snapshot();
    delete model.turns[1].sourceMessageId;
    model.verification.issues = [];
    return model;
  };
  await expect(collectConversation(driver, fast)).rejects.toMatchObject({
    code: 'unstable-identity',
  });
});

test('missing middle and reported missing end remain gaps after observed boundaries', async ({
  page,
}) => {
  const driver = await setup(page, { total: 20 });
  await page.evaluate(() => window.fixture.omit(8));
  const model = await collectConversation(driver, fast);
  expect(model.source.collection.gaps).toEqual([
    { from: 8, to: 8 },
    { from: 18, to: 19 },
  ]);
  expect(model.source.collection.stoppedReason).toBe('gaps');
  expect(model.source.collection.orderedTurns).toBe(17);
  expect(model.verification.status).toBe('unverified');
});

test('unindexed windows still require stable overlapping IDs and never claim service completeness', async ({
  page,
}) => {
  const driver = await setup(page, { indices: false });
  const model = await collectConversation(driver, fast);
  expect(model.turns).toHaveLength(18);
  expect(model.source.collection.indicesAvailable).toBe(false);
  expect(model.verification.status).toBe('unverified');
});

test('a page-reported total smaller than the observed conversation remains explicit conflicting evidence', async ({
  page,
}) => {
  const driver = await setup(page, { total: 12 });
  const model = await collectConversation(driver, fast);
  expect(model.turns).toHaveLength(18);
  expect(model.source.collection.reportedTotal).toBe(12);
  expect(
    model.verification.issues.some((issue) => issue.code === 'collection-count-conflict'),
  ).toBe(true);
  expect(model.verification.status).toBe('unverified');
});

test('same-ID content changes, contradictory order and disconnected branch windows abort', async ({
  page,
}) => {
  for (const kind of ['content', 'branch', 'order']) {
    const driver = await setup(page);
    const snapshot = driver.snapshot;
    let reads = 0;
    driver.snapshot = async () => {
      reads += 1;
      if (reads === 2 && kind !== 'order')
        await page.evaluate(
          (kind) =>
            kind === 'content'
              ? window.fixture.mutate(6, 'Changed content')
              : window.fixture.replaceIds(),
          kind,
        );
      const model = await snapshot();
      if (reads === 2 && kind === 'order') model.turns.reverse();
      return model;
    };
    await expect(collectConversation(driver, fast)).rejects.toMatchObject({
      name: 'CollectionError',
      code: kind === 'branch' ? 'disconnected' : 'conflict',
    });
  }
});

test('cancellation during the initial viewport return releases an already-created lease', async ({
  page,
}) => {
  const driver = await setup(page);
  const viewport = driver.viewport;
  const controller = new AbortController();
  driver.viewport = async (command) => {
    const value = await viewport(command);
    if (command?.begin) {
      controller.abort();
      await page.waitForTimeout(30);
    }
    return value;
  };
  await expect(
    collectConversation(driver, { ...fast, signal: controller.signal }),
  ).rejects.toMatchObject({ code: 'cancelled' });
  expect(await page.evaluate(() => globalThis.__gptHandoffCollectionScroll)).toBeUndefined();
});

test('even the first snapshot must match the pinned conversation route', async ({ page }) => {
  const driver = await setup(page);
  const snapshot = driver.snapshot;
  driver.snapshot = async () => {
    const model = await snapshot();
    model.source.url = 'https://chatgpt.com/c/wrong-route';
    return model;
  };
  await expect(collectConversation(driver, fast)).rejects.toMatchObject({ code: 'navigation' });
});

test('cancel stops future scrolling, restores position and releases page listeners', async ({
  page,
}) => {
  const driver = await setup(page);
  const original = (await driver.viewport()).scrollTop;
  const controller = new AbortController();
  let scrolls = 0;
  const scroll = driver.scroll;
  driver.scroll = (command) => {
    scrolls += 1;
    return scroll(command);
  };
  await expect(
    collectConversation(driver, {
      ...fast,
      signal: controller.signal,
      onProgress: (event) => {
        if (event.steps === 2) controller.abort();
      },
    }),
  ).rejects.toMatchObject({ code: 'cancelled' });
  const count = scrolls;
  await page.waitForTimeout(60);
  expect(scrolls).toBe(count);
  expect((await driver.viewport()).scrollTop).toBe(original);
  expect(await page.evaluate(() => globalThis.__gptHandoffCollectionScroll)).toBeUndefined();
});

test('streaming and navigation stop collection; a changed page is never restored', async ({
  page,
}) => {
  for (const kind of ['streaming', 'navigation']) {
    const driver = await setup(page);
    const snapshot = driver.snapshot;
    let reads = 0;
    driver.snapshot = async () => {
      if (++reads === 2)
        await page.evaluate((kind) => {
          if (kind === 'streaming')
            document
              .querySelector('[data-message-author-role="assistant"]')
              .setAttribute('aria-busy', 'true');
          else history.pushState({}, '', '/c/another-conversation');
        }, kind);
      return snapshot();
    };
    await expect(collectConversation(driver, fast)).rejects.toMatchObject({ code: kind });
    if (kind === 'navigation') expect(page.url()).toContain('/c/another-conversation');
  }
});

test('step, time, payload and stalled-scroll limits have explicit outcomes', async ({ page }) => {
  let driver = await setup(page);
  expect(
    (await collectConversation(driver, { ...fast, maxSteps: 2 })).source.collection.stoppedReason,
  ).toBe('step-limit');
  driver = await setup(page);
  expect(
    (await collectConversation(driver, { ...fast, maxDurationMs: 150 })).source.collection
      .stoppedReason,
  ).toBe('duration-limit');
  driver = await setup(page);
  await page.evaluate(() => window.fixture.enlarge());
  await expect(collectConversation(driver, { ...fast, maxBytes: 4000 })).rejects.toBeInstanceOf(
    CollectionError,
  );
  driver = await setup(page);
  driver.scroll = () => driver.viewport();
  expect((await collectConversation(driver, fast)).source.collection.stoppedReason).toBe('stalled');
});

test('trusted user scroll takeover stops collection and prevents automatic restoration', async ({
  page,
}) => {
  const driver = await setup(page);
  const snapshot = driver.snapshot;
  let reads = 0;
  driver.snapshot = async () => {
    if (++reads === 2) {
      await page.mouse.move(100, 150);
      await page.mouse.wheel(0, 100);
    }
    return snapshot();
  };
  await expect(collectConversation(driver, fast)).rejects.toMatchObject({
    code: 'user-intervened',
  });
  expect(await page.evaluate(() => globalThis.__gptHandoffCollectionScroll)).toBeUndefined();
});
