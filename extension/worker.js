import { installChatIntegration } from './chat-worker.js';
import { captureChatGPT } from './capture.js';
import { collectConversation } from './collect.js';
import { inspectConversationViewport, scrollConversationViewport } from './page-scroll.js';
import { validateConversation } from './model.js';
import { deliverToDesk, probeDesk } from './bridge.js';
import { createDownloadAssistance, CAPTURE_MAX_AGE } from './downloads.js';
import { captureOriginalConversation } from './original.js';

const deskUrl = 'http://127.0.0.1:43119/#capture';
const popupUrl = chrome.runtime.getURL('popup.html');
const chatOrigins = new Set(['https://chatgpt.com', 'https://chat.openai.com']);
let deliveryBusy = false;
let collectionJob = null;
const downloadAssistance = createDownloadAssistance({ chromeApi: chrome, inspect, boundedModel });

function guardSignal(signal) {
  if (signal?.aborted) throw new DOMException('Collection cancelled.', 'AbortError');
}

function boundedModel(input) {
  const model = validateConversation(input);
  if (new TextEncoder().encode(JSON.stringify(model)).length > 8 * 1024 * 1024)
    throw new Error('This snapshot is too large. Use a selected export instead.');
  return model;
}

function sourceUrl(value) {
  try {
    const url = new URL(value);
    return !url.username &&
      !url.password &&
      chatOrigins.has(url.origin) &&
      /^\/(?:(?:g\/[A-Za-z0-9_-]{1,200}\/)?c|share)\/[A-Za-z0-9_-]{1,200}\/?$/u.test(url.pathname)
      ? url
      : null;
  } catch {
    return null;
  }
}

function descriptor(value) {
  if (
    !value ||
    !Number.isInteger(value.tabId) ||
    !Number.isInteger(value.windowId) ||
    !sourceUrl(value.url)
  )
    throw new Error('Choose an open ChatGPT conversation.');
  return value;
}

async function inspect(selected) {
  descriptor(selected);
  const tab = await chrome.tabs.get(selected.tabId);
  if (tab.windowId !== selected.windowId || tab.url !== selected.url || tab.pendingUrl)
    throw new Error('The selected conversation changed. Select it again.');
  const [frame] = await chrome.scripting.executeScript({
    target: { tabId: selected.tabId, frameIds: [0] },
    world: 'ISOLATED',
    func: () => ({ url: location.href }),
  });
  if (!frame?.documentId || frame.result?.url !== selected.url)
    throw new Error('The selected page changed. Select it again.');
  if (selected.documentId && frame.documentId !== selected.documentId)
    throw new Error('The selected page reloaded. Capture it again.');
  return { ...selected, documentId: frame.documentId };
}

async function runSource(identity, func, command, signal, cleanup = false) {
  if (!cleanup) guardSignal(signal);
  await inspect(identity);
  if (!cleanup) guardSignal(signal);
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: identity.tabId, documentIds: [identity.documentId] },
    world: 'ISOLATED',
    func,
    args: [{ ...command, expectedUrl: identity.url }],
  });
  if (result?.error)
    throw new Error(result.error.message || 'The selected page could not be read.');
  if (result?.documentId !== identity.documentId || !result?.result)
    throw new Error('The selected page changed. Select the conversation again.');
  await inspect(identity);
  if (!cleanup) guardSignal(signal);
  return result.result;
}

async function capture(selected, signal) {
  guardSignal(signal);
  const identity = await inspect(selected);
  const result = await runSource(identity, captureChatGPT, {}, signal);
  const model = boundedModel(result);
  const url = sourceUrl(identity.url);
  if (model.source.type !== 'dom-snapshot' || model.source.url !== `${url.origin}${url.pathname}`)
    throw new Error('The captured source does not match the selected conversation.');
  return { model, identity, capturedAt: Date.now() };
}

async function collect(selected, signal, onProgress) {
  guardSignal(signal);
  const identity = await inspect(selected);
  const model = boundedModel(
    await collectConversation(
      {
        snapshot: async () => (await capture(identity, signal)).model,
        viewport: (command = {}) =>
          runSource(identity, inspectConversationViewport, command, signal),
        scroll: (command) => runSource(identity, scrollConversationViewport, command, signal),
        // Restore may run after cancellation, but never on another URL/document.
        restore: (command) =>
          runSource(
            identity,
            scrollConversationViewport,
            command.release ? command : { ...command, restore: true },
            signal,
            true,
          ),
      },
      {
        signal,
        onProgress,
        maxDurationMs: 90_000,
        maxSteps: 200,
        maxTurns: 5000,
        maxBytes: 8 * 1024 * 1024,
      },
    ),
  );
  guardSignal(signal);
  await inspect(identity);
  const url = sourceUrl(identity.url);
  if (model.source.type !== 'dom-snapshot' || model.source.url !== `${url.origin}${url.pathname}`)
    throw new Error('The collected source does not match the selected conversation.');
  return { model, identity, capturedAt: Date.now() };
}

function trustedPopup(sender) {
  return sender?.id === chrome.runtime.id && sender.url === popupUrl && !sender.tab;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'collection' || !trustedPopup(port.sender)) {
    port.disconnect();
    return;
  }
  let job = null;
  let disconnected = false;
  const post = (message) => {
    if (disconnected) return false;
    try {
      port.postMessage(message);
      return true;
    } catch {
      job?.controller.abort();
      return false;
    }
  };
  port.onDisconnect.addListener(() => {
    disconnected = true;
    job?.controller.abort();
  });
  port.onMessage.addListener((message) => {
    if (message?.type === 'cancel' && message.jobId === job?.id) {
      job.controller.abort();
      return;
    }
    if (!['collect', 'original'].includes(message?.type) || !/^[a-f0-9]{32}$/u.test(message.jobId))
      return;
    if (
      message.type === 'original' &&
      chrome.runtime.getManifest?.().permissions?.includes('debugger') !== true
    ) {
      post({
        type: 'error',
        jobId: message.jobId,
        code: 'unavailable',
        error:
          'This build uses passive capture. Open the conversation normally in the signed-in chat.',
      });
      return;
    }
    if (job || collectionJob || deliveryBusy) {
      post({
        type: 'error',
        jobId: message.jobId,
        code: 'busy',
        error: 'Finish the current collection or handoff first.',
      });
      return;
    }
    // Lock before the first await. No second popup can start another scroll pass.
    job = { id: message.jobId, controller: new AbortController() };
    collectionJob = job;
    const deadline = setTimeout(() => {
      job.timedOut = true;
      job.controller.abort();
    }, 95_000);
    const phases = new Set(['starting', 'up', 'down', 'restoring', 'done', 'attaching', 'reading']);
    const progress = (value) => {
      if (!phases.has(value?.phase) || job.controller.signal.aborted) return;
      if (
        !post({
          type: 'progress',
          jobId: job.id,
          phase: value.phase,
          observedTurns: Math.max(0, Math.min(5000, Number(value.observedTurns) || 0)),
          steps: Math.max(0, Math.min(200, Number(value.steps) || 0)),
          elapsedMs: Math.max(0, Math.min(95_000, Number(value.elapsedMs) || 0)),
          startObserved: value.startObserved === true,
          endObserved: value.endObserved === true,
        })
      )
        job.controller.abort();
    };
    const reading =
      message.type === 'original'
        ? captureOriginalConversation({ chromeApi: chrome, inspect }, message.selected, {
            signal: job.controller.signal,
            onProgress: progress,
          }).then((result) => ({ ...result, model: boundedModel(result.model) }))
        : collect(message.selected, job.controller.signal, progress);
    reading
      .then(
        (result) => {
          if (!job.controller.signal.aborted) post({ type: 'done', jobId: job.id, ...result });
          else
            post({
              type: 'error',
              jobId: job.id,
              code: 'cancelled',
              error: 'Collection cancelled. Nothing was transferred.',
            });
        },
        (error) =>
          post({
            type: 'error',
            jobId: job.id,
            code: job.timedOut
              ? 'duration-limit'
              : job.controller.signal.aborted
                ? 'cancelled'
                : String(error.code || 'collection-failed'),
            error: job.timedOut
              ? 'Collection reached its time limit. Try again or capture visible turns only.'
              : job.controller.signal.aborted
                ? 'Collection cancelled. Nothing was transferred.'
                : error.message || 'Collection stopped. Check the selected chat and try again.',
          }),
      )
      .finally(() => {
        clearTimeout(deadline);
        if (collectionJob === job) collectionJob = null;
      });
  });
});

async function waitForDesk(tabId, deadline) {
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url !== deskUrl && tab.pendingUrl !== deskUrl)
      throw new Error('The local desk navigated away. Try again.');
    if (tab.status === 'complete' && tab.url === deskUrl) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Start gpt-handoff, then try again.');
}

async function deliver(message) {
  if (collectionJob) throw new Error('Wait for collection to finish, or cancel it first.');
  if (deliveryBusy) throw new Error('A handoff is already waiting in the local desk.');
  deliveryBusy = true;
  let model = null;
  try {
    if (
      !Number.isSafeInteger(message.capturedAt) ||
      Date.now() - message.capturedAt > CAPTURE_MAX_AGE ||
      message.capturedAt > Date.now()
    )
      throw new Error('The capture expired. Capture the conversation again.');
    await inspect(message.identity);
    model = boundedModel(message.model);
    const url = sourceUrl(message.identity.url);
    if (
      !['dom-snapshot', 'chatgpt-response'].includes(model.source.type) ||
      model.source.url !== `${url.origin}${url.pathname}`
    )
      throw new Error('The source changed. Capture the conversation again.');
    if (!(await chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] })))
      throw new Error('Allow access to the local desk, then try again.');
    const deadline = Date.now() + 45_000;
    const matching = (await chrome.tabs.query({ url: 'http://127.0.0.1/*' })).filter(
      (tab) => tab.url === deskUrl || tab.url === 'http://127.0.0.1:43119/',
    );
    // Reuse one exact desk. Never select a port, path, or title lookalike.
    const existing = matching.find((tab) => tab.active) || matching[0];
    const tab = existing
      ? await chrome.tabs.update(existing.id, { url: deskUrl })
      : await chrome.tabs.create({ url: deskUrl, active: false });
    await waitForDesk(tab.id, Math.min(deadline, Date.now() + 10_000));
    await inspect(message.identity);
    const requestId = crypto.randomUUID().replaceAll('-', '');
    const [ready] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      world: 'ISOLATED',
      func: probeDesk,
      args: [requestId, deadline],
    });
    if (!ready?.documentId || !/^[a-f0-9]{32}$/u.test(ready.result))
      throw new Error('The local desk is not ready. Start gpt-handoff and try again.');
    await inspect(message.identity);
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    const [receipt] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, documentIds: [ready.documentId] },
      world: 'ISOLATED',
      func: deliverToDesk,
      args: [model, requestId, deadline, ready.result],
    });
    model = null;
    if (!receipt?.result?.ok)
      throw new Error(receipt?.result?.error || 'The desk did not confirm receipt. Try again.');
    return { accepted: true };
  } finally {
    model = null;
    deliveryBusy = false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Web pages/content scripts cannot invoke this boundary, even inside an allowed host.
  if (!trustedPopup(sender)) return false;
  const actions = {
    downloadStart: async () => {
      if (collectionJob || deliveryBusy)
        throw new Error('Finish the current collection or handoff first.');
      return { receipt: await downloadAssistance.start(message) };
    },
    downloadStatus: async () => ({ receipt: await downloadAssistance.status(message) }),
    downloadCancel: async () => ({ receipt: await downloadAssistance.cancel(message) }),
    capture: async () => {
      if (collectionJob || deliveryBusy)
        throw new Error('Finish the current collection or handoff first.');
      return capture(message.selected);
    },
    deliver: () => deliver(message),
    focus: async () => {
      if (collectionJob || deliveryBusy)
        throw new Error('Finish the current collection or handoff first.');
      const selected = await inspect(message.selected);
      await chrome.tabs.update(selected.tabId, { active: true });
      await chrome.windows.update(selected.windowId, { focused: true });
      await inspect(selected);
      return { focused: true };
    },
  };
  if (!Object.hasOwn(actions, message?.type)) return false;
  actions[message.type]().then(
    (value) => respond({ ok: true, ...value }),
    (error) =>
      respond({ ok: false, error: error.message || 'Try again from the selected conversation.' }),
  );
  return true;
});

installChatIntegration(chrome);
