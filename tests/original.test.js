import test from 'node:test';
import assert from 'node:assert/strict';
import { captureOriginalConversation } from '../src/original.js';

const selected = { tabId: 7, windowId: 3, url: 'https://chatgpt.com/c/original-test' };
const responseUrl = 'https://chatgpt.com/backend-api/conversation/original-test';
function event() {
  const listeners = new Set();
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    emit: (...args) => {
      for (const fn of listeners) fn(...args);
    },
    get size() {
      return listeners.size;
    },
  };
}
function harness(options = {}) {
  const calls = [],
    inspections = [];
  const onEvent = event(),
    onDetach = event(),
    onRemoved = event(),
    onUpdated = event();
  let reloaded = false;
  const raw = {
    conversation_id: 'original-test',
    title: 'Synthetic original',
    current_node: 'a',
    mapping: {
      root: { parent: null, message: null },
      u: {
        parent: 'root',
        message: {
          author: { role: 'user' },
          status: 'finished_successfully',
          content: { content_type: 'text', parts: ['Synthetic question.'] },
        },
      },
      a: {
        parent: 'u',
        message: {
          author: { role: 'assistant' },
          status: 'finished_successfully',
          content: { content_type: 'text', parts: [' **Exact** 中文 ✓\n'] },
        },
      },
    },
  };
  const emitResponse = (override = {}) => {
    onEvent.emit({ tabId: 7 }, 'Network.responseReceived', {
      requestId: 'response-1',
      frameId: 'main',
      response: { url: responseUrl, status: 200, mimeType: 'application/json' },
      ...override,
    });
    onEvent.emit({ tabId: 7 }, 'Network.loadingFinished', {
      requestId: 'response-1',
      encodedDataLength: 800,
    });
  };
  const chromeApi = {
    scripting: {
      executeScript: async () => [
        {
          documentId: 'before',
          result: {
            draft: false,
            streaming: false,
            ...(typeof options.preflight === 'function' ? options.preflight() : options.preflight),
          },
        },
      ],
    },
    tabs: { onRemoved, onUpdated },
    debugger: {
      onEvent,
      onDetach,
      attach: async (...args) => {
        calls.push(['attach', ...args]);
        await options.attach?.();
      },
      detach: async (...args) => {
        calls.push(['detach', ...args]);
      },
      sendCommand: async (target, method, params) => {
        calls.push([method, target, params]);
        if (method === 'Page.getFrameTree')
          return { frameTree: { frame: { id: 'main', url: selected.url } } };
        if (method === 'Page.reload') {
          reloaded = true;
          onEvent.emit({ tabId: 7 }, 'Page.frameNavigated', {
            frame: { id: 'main', url: selected.url },
          });
          if (options.reload)
            options.reload({ onEvent, onDetach, onRemoved, onUpdated, emitResponse });
          else emitResponse();
        }
        if (method === 'Network.getResponseBody') {
          await options.bodyWait?.();
          const body = JSON.stringify(options.raw ?? raw);
          return (
            options.body ?? { body: Buffer.from(body).toString('base64'), base64Encoded: true }
          );
        }
        return {};
      },
    },
  };
  const inspect = async (value) => {
    inspections.push(value);
    if (options.inspect) await options.inspect(value, reloaded);
    return { ...value, documentId: reloaded ? 'after' : 'before' };
  };
  return {
    calls,
    inspections,
    chromeApi,
    read: (settings = {}) =>
      captureOriginalConversation(
        {
          chromeApi,
          inspect,
          now: () => Date.parse('2026-10-12T14:00:00.000Z'),
          timeoutMs: 20,
          ...options.dependencies,
        },
        selected,
        settings,
      ),
    cleanup: () => {
      assert.equal(onEvent.size + onDetach.size + onRemoved.size + onUpdated.size, 0);
    },
  };
}

test('reads only the selected response, decodes UTF-8 and pins the reloaded document', async () => {
  const h = harness({
    reload: ({ onEvent, emitResponse }) => {
      onEvent.emit({ tabId: 999 }, 'Network.responseReceived', {
        requestId: 'foreign',
        frameId: 'main',
        response: { url: responseUrl, status: 200, mimeType: 'application/json' },
      });
      emitResponse({ frameId: 'iframe' });
      emitResponse({
        response: {
          url: 'https://chatgpt.com/api/auth/session',
          status: 200,
          mimeType: 'application/json',
        },
      });
      emitResponse();
    },
  });
  const result = await h.read();
  assert.equal(result.model.turns[1].markdown, ' **Exact** 中文 ✓\n');
  assert.equal(result.identity.documentId, 'after');
  assert.equal(h.calls.filter((call) => call[0] === 'Network.getResponseBody').length, 1);
  assert.ok(h.calls.every((call) => call[1]?.tabId === 7));
  assert.equal(h.calls.filter((call) => call[0] === 'detach').length, 1);
  assert.equal(h.inspections.at(-1).documentId, undefined);
  h.cleanup();
});

test('an unsent draft or streaming answer prevents attach and reload', async () => {
  for (const preflight of [{ draft: true }, { streaming: true }]) {
    const h = harness({ preflight });
    await assert.rejects(h.read(), /unsent draft/u);
    assert.deepEqual(h.calls, []);
    h.cleanup();
  }
});

test('a draft created while debugger attachment is pending prevents reload', async () => {
  let draft = false;
  const h = harness({
    attach: () => {
      draft = true;
    },
    preflight: () => ({ draft }),
  });
  await assert.rejects(h.read(), /unsent draft/u);
  assert.equal(
    h.calls.some((call) => call[0] === 'Page.reload'),
    false,
  );
  assert.equal(h.calls.filter((call) => call[0] === 'detach').length, 1);
  h.cleanup();
});

test('attach refusal has an actionable error and no owned debugger to detach', async () => {
  const h = harness({
    attach: () => {
      throw Error('Another debugger');
    },
  });
  await assert.rejects(h.read(), /Close DevTools/u);
  assert.deepEqual(
    h.calls.map((call) => call[0]),
    ['attach'],
  );
  h.cleanup();
});

test('cancellation during an in-flight attach still detaches when that attach finishes', async () => {
  const controller = new AbortController();
  const h = harness({ attach: () => controller.abort() });
  await assert.rejects(h.read({ signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(
    h.calls.map((call) => call[0]),
    ['attach', 'detach'],
  );
  h.cleanup();
});

test('timeout, navigation and tab closure reject and release the owned debugger', async () => {
  for (const [reload, error] of [
    [() => {}, /No original conversation response/u],
    [
      ({ onUpdated }) => onUpdated.emit(7, { url: 'https://chatgpt.com/c/other' }, { windowId: 3 }),
      /conversation changed/u,
    ],
    [({ onRemoved }) => onRemoved.emit(7), /conversation was closed/u],
    [
      ({ onEvent }) =>
        onEvent.emit({ tabId: 7 }, 'Page.frameNavigated', {
          frame: { id: 'main', url: selected.url },
        }),
      /navigated/u,
    ],
  ]) {
    const h = harness({ reload });
    await assert.rejects(h.read(), error);
    assert.equal(h.calls.filter((call) => call[0] === 'detach').length, 1);
    h.cleanup();
  }
});

test('Chrome detachment is terminal and does not detach somebody else later', async () => {
  const h = harness({ reload: ({ onDetach }) => onDetach.emit({ tabId: 7 }, 'canceled_by_user') });
  await assert.rejects(h.read(), /disconnected/u);
  assert.equal(h.calls.filter((call) => call[0] === 'detach').length, 0);
  h.cleanup();
});

test('bad response identity, non-JSON and invalid UTF-8 never produce a successful capture', async () => {
  for (const options of [
    { raw: { conversation_id: 'another-chat' } },
    { body: { body: '<html>Login required</html>' } },
    { body: { body: '/w==', base64Encoded: true } },
  ]) {
    const h = harness(options);
    await assert.rejects(h.read());
    assert.equal(h.calls.filter((call) => call[0] === 'detach').length, 1);
    h.cleanup();
  }
});

test('a late body after cancellation cannot turn failure into success', async () => {
  const controller = new AbortController();
  let release;
  const h = harness({
    bodyWait: () =>
      new Promise((resolve) => {
        release = resolve;
        controller.abort();
      }),
  });
  await assert.rejects(h.read({ signal: controller.signal }), { name: 'AbortError' });
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.calls.filter((call) => call[0] === 'detach').length, 1);
  h.cleanup();
});
