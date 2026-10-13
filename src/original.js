import { importBrowserResponse, isSelectedResponse, originalSource } from './chatgpt-response.js';
import { LIMITS } from './model.js';

const cancelled = () => new DOMException('Original capture cancelled.', 'AbortError');

/** Selected-page browser adapter; the injected Chrome API keeps it independently testable. */
export async function captureOriginalConversation(
  { chromeApi, inspect, now = Date.now, timeoutMs = 45_000 },
  selected,
  { signal, onProgress = () => {} } = {},
) {
  originalSource(selected.url);
  const check = () => {
    if (signal?.aborted) throw cancelled();
  };
  check();
  const before = await inspect(selected);
  check();
  const ensureReloadSafe = async () => {
    const [preflight] = await chromeApi.scripting.executeScript({
      target: { tabId: before.tabId, documentIds: [before.documentId] },
      world: 'ISOLATED',
      func: () => {
        const composer = document.querySelector('#prompt-textarea');
        return {
          draft: Boolean((composer?.value ?? composer?.textContent ?? '').trim()),
          streaming: Boolean(
            document.querySelector(
              '[data-testid="stop-button"],button[aria-label="Stop generating"]',
            ),
          ),
        };
      },
    });
    if (preflight?.documentId !== before.documentId || !preflight.result)
      throw new Error('The selected page changed. Select it again.');
    if (preflight.result.draft || preflight.result.streaming)
      throw new Error(
        'Save your unsent draft and wait for the answer to finish before reloading this conversation.',
      );
  };
  await ensureReloadSafe();
  check();
  const target = { tabId: selected.tabId };
  const expectedPage = new URL(selected.url);
  expectedPage.hash = '';
  let attached = false;
  let settled = false;
  let timer;
  let mainFrame;
  let reloadStarted = false;
  let reloaded = false;
  const requests = new Set();
  let resolve, reject;
  const result = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // Cancellation can arrive during attach/enable, before the result is awaited.
  void result.catch(() => {});
  const fail = (error) => {
    if (settled) return;
    settled = true;
    reject(error);
  };
  const abort = () => fail(cancelled());
  const detached = (source) => {
    if (source.tabId !== target.tabId || source.sessionId) return;
    attached = false;
    fail(
      new Error('Chrome disconnected the original-message reader. Close DevTools and try again.'),
    );
  };
  const removed = (tabId) => {
    if (tabId === target.tabId) fail(new Error('The selected conversation was closed.'));
  };
  const updated = (tabId, change, tab) => {
    if (tabId !== target.tabId || settled) return;
    if (
      (change.url && change.url !== selected.url) ||
      (tab.windowId !== undefined && tab.windowId !== selected.windowId)
    )
      fail(new Error('The selected conversation changed. Select it again.'));
  };
  const event = (source, method, params = {}) => {
    if (source.tabId !== target.tabId || source.sessionId || settled || !reloadStarted) return;
    if (method === 'Page.frameNavigated' && !params.frame?.parentId) {
      const frame = params.frame;
      if (!frame || frame.url !== expectedPage.href || reloaded) {
        fail(new Error('The selected page navigated during original capture. Select it again.'));
        return;
      }
      reloaded = true;
      mainFrame = frame.id;
    }
    if (method === 'Network.responseReceived') {
      if (params.frameId !== mainFrame || !isSelectedResponse(params.response?.url, selected.url))
        return;
      if (
        params.response.status !== 200 ||
        !/^(application\/json|text\/json)(?:;|$)/iu.test(params.response.mimeType ?? '')
      ) {
        fail(
          new Error(
            'The page did not supply original conversation data. Reopen it in ChatGPT and try again.',
          ),
        );
        return;
      }
      if (requests.size >= 8) {
        fail(
          new Error('Too many conversation responses arrived. Try again after the page settles.'),
        );
        return;
      }
      requests.add(params.requestId);
    }
    if (method === 'Network.loadingFailed' && requests.delete(params.requestId))
      fail(new Error('The conversation response failed to load. Reopen the source and try again.'));
    if (method !== 'Network.loadingFinished' || !requests.delete(params.requestId)) return;
    if (params.encodedDataLength > LIMITS.maxImportBytes) {
      fail(new Error('The conversation response exceeds the 64 MiB limit.'));
      return;
    }
    void (async () => {
      try {
        const body = await chromeApi.debugger.sendCommand(target, 'Network.getResponseBody', {
          requestId: params.requestId,
        });
        if (settled) return;
        check();
        if (
          typeof body?.body !== 'string' ||
          body.body.length > Math.ceil((LIMITS.maxImportBytes * 4) / 3)
        )
          throw new Error(
            'The conversation response is unavailable or exceeds the supported limit.',
          );
        const text = body.base64Encoded
          ? new TextDecoder('utf-8', { fatal: true }).decode(
              Uint8Array.from(atob(body.body), (char) => char.charCodeAt(0)),
            )
          : body.body;
        const capturedAt = now();
        const model = importBrowserResponse(text, {
          pageUrl: selected.url,
          responseUrl: originalSource(selected.url).responseUrl,
          capturedAt: new Date(capturedAt).toISOString(),
        });
        // The one deliberate reload gets a new document identity. Pin that new document for delivery.
        const identity = await inspect({
          tabId: selected.tabId,
          windowId: selected.windowId,
          url: selected.url,
        });
        if (settled) return;
        check();
        settled = true;
        resolve({ model, identity, capturedAt });
      } catch (error) {
        fail(error);
      }
    })();
  };
  chromeApi.debugger.onEvent.addListener(event);
  chromeApi.debugger.onDetach.addListener(detached);
  chromeApi.tabs.onRemoved.addListener(removed);
  chromeApi.tabs.onUpdated.addListener(updated);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    check();
    onProgress({ phase: 'attaching', observedTurns: 0, elapsedMs: 0 });
    try {
      await chromeApi.debugger.attach(target, '1.3');
    } catch {
      throw new Error(
        'Chrome could not read original messages. Close DevTools or check the extension permission, then try again.',
      );
    }
    attached = true;
    check();
    if (settled) return await result;
    await chromeApi.debugger.sendCommand(target, 'Page.enable');
    const frames = await chromeApi.debugger.sendCommand(target, 'Page.getFrameTree');
    mainFrame = frames?.frameTree?.frame?.id;
    if (!mainFrame || frames.frameTree.frame.url !== expectedPage.href)
      throw new Error('The selected page changed before capture. Select it again.');
    await chromeApi.debugger.sendCommand(target, 'Network.enable', {
      maxTotalBufferSize: LIMITS.maxImportBytes,
      maxResourceBufferSize: LIMITS.maxImportBytes,
    });
    check();
    if (settled) return await result;
    await inspect(before);
    await ensureReloadSafe();
    check();
    timer = setTimeout(
      () =>
        fail(
          new Error(
            'No original conversation response arrived. Reopen the source or choose the explicit rendered/export alternative.',
          ),
        ),
      timeoutMs,
    );
    reloadStarted = true;
    onProgress({ phase: 'reading', observedTurns: 0, elapsedMs: 0 });
    await chromeApi.debugger.sendCommand(target, 'Page.reload', { ignoreCache: true });
    return await result;
  } finally {
    settled = true;
    clearTimeout(timer);
    requests.clear();
    signal?.removeEventListener('abort', abort);
    chromeApi.debugger.onEvent.removeListener(event);
    chromeApi.debugger.onDetach.removeListener(detached);
    chromeApi.tabs.onRemoved.removeListener(removed);
    chromeApi.tabs.onUpdated.removeListener(updated);
    if (attached) await chromeApi.debugger.detach(target).catch(() => {});
  }
}
