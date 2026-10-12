import { projectMarkdown, validateConversation } from './model.js';

const $ = (id) => document.getElementById(id);
const origins = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
let selected = null;
let captured = null;
let generation = 0;
let choices = [];
let busyKind = null;
let activeCollection = null;
function freezeControls(frozen, kind = null) {
  busyKind = frozen ? kind : null;
  for (const id of ['deliver', 'capture', 'snapshot', 'find', 'focus', 'choose', 'discard', 'copy'])
    $(id).disabled = frozen;
  if (!frozen) {
    $('capture').disabled = !selected;
    $('snapshot').disabled = !selected;
  }
  window.dispatchEvent(new CustomEvent('gh-busy', { detail: { busy: frozen, kind } }));
}
window.addEventListener('gh-download-busy', (event) => {
  if (event.detail?.busy && !busyKind) freezeControls(true, 'download');
  else if (!event.detail?.busy && busyKind === 'download') freezeControls(false);
});

function isConversation(url) {
  try {
    const parsed = new URL(url);
    return (
      ['https://chatgpt.com', 'https://chat.openai.com'].includes(parsed.origin) &&
      /^\/(?:(?:g\/[A-Za-z0-9_-]{1,200}\/)?c|share)\/[A-Za-z0-9_-]{1,200}\/?$/u.test(
        parsed.pathname,
      )
    );
  } catch {
    return false;
  }
}
function showStatus(message, error = false) {
  $('status').textContent = message;
  $('status').className = error ? 'error' : '';
  $('status').hidden = false;
}
function clearCapture() {
  generation += 1;
  captured = null;
  $('review').hidden = true;
  $('checks').replaceChildren();
  $('status').hidden = true;
  $('capture').disabled = !selected;
  $('snapshot').disabled = !selected;
  $('capture').firstChild.textContent = 'Use this conversation ';
  window.dispatchEvent(new CustomEvent('gh-capture-clear'));
}
function select(tab) {
  clearCapture();
  selected =
    tab && isConversation(tab.url) ? { tabId: tab.id, windowId: tab.windowId, url: tab.url } : null;
  $('source-title').textContent = selected
    ? tab.title || 'ChatGPT conversation'
    : 'Open a ChatGPT conversation';
  $('source-detail').textContent = selected
    ? `${new URL(tab.url).hostname} · window ${tab.windowId} · tab ${tab.id}`
    : 'Then open this extension from that tab.';
  $('capture').disabled = !selected;
  $('snapshot').disabled = !selected;
  $('focus').hidden = !selected;
}

function showCapture(result) {
  captured = {
    model: validateConversation(result.model),
    identity: result.identity,
    capturedAt: result.capturedAt,
  };
  $('counts').textContent =
    `${captured.model.turns.length} observed turns · ${captured.model.attachments.length} file ref${captured.model.attachments.length === 1 ? '' : 's'}`;
  const collection = captured.model.source.collection;
  $('capture-note').textContent = collection
    ? collection.stoppedReason === 'observed-boundaries'
      ? 'Reached the rendered start and end. Full history and original Markdown remain unverified.'
      : 'Collection stopped before both rendered boundaries were confirmed. Review the content checks.'
    : 'Visible turns only. Earlier or unloaded turns may be missing.';
  $('checks-label').textContent = `Content checks (${captured.model.verification.issues.length})`;
  $('checks').replaceChildren(
    ...captured.model.verification.issues.map((issue) => {
      const item = document.createElement('li');
      item.textContent = issue.message;
      return item;
    }),
  );
  $('review').hidden = false;
  $('capture').firstChild.textContent = 'Collect again ';
  window.dispatchEvent(new CustomEvent('gh-capture', { detail: captured }));
}

function collectSelected() {
  return new Promise((resolve, reject) => {
    const jobId = crypto.randomUUID().replaceAll('-', '');
    const port = chrome.runtime.connect({ name: 'collection' });
    const job = { port, jobId, cancelled: false };
    activeCollection = job;
    let settled = false;
    let lastProgress = 0;
    let lastPhase = '';
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (activeCollection === job) activeCollection = null;
      port.disconnect();
      if (error) reject(error);
      else resolve(result);
    };
    port.onMessage.addListener((message) => {
      if (message?.jobId !== jobId || settled) return;
      if (message.type === 'progress' && !job.cancelled) {
        const labels = {
          starting: 'Starting collection…',
          up: 'Finding earlier turns…',
          down: 'Collecting later turns…',
          restoring: 'Restoring your position…',
          done: 'Collection stopped',
        };
        if (
          labels[message.phase] &&
          (lastPhase !== message.phase || Date.now() - lastProgress >= 500)
        ) {
          lastProgress = Date.now();
          lastPhase = message.phase;
          $('collection-phase').textContent = labels[message.phase];
          $('collection-count').textContent =
            `${message.observedTurns} turns observed · ${Math.floor(message.elapsedMs / 1000)}s`;
        }
      } else if (message.type === 'done') {
        finish(
          job.cancelled ? new Error('Collection cancelled. Nothing was transferred.') : null,
          message,
        );
      } else if (message.type === 'error')
        finish(new Error(message.error || 'Collection stopped. Try again.'));
    });
    port.onDisconnect.addListener(() =>
      finish(
        new Error(
          job.cancelled
            ? 'Collection cancelled. Nothing was transferred.'
            : 'Collection disconnected. Keep the extension open and try again.',
        ),
      ),
    );
    try {
      port.postMessage({ type: 'collect', jobId, selected });
    } catch {
      finish(new Error('Collection could not start. Reopen the extension and try again.'));
    }
  });
}
async function request(type, data) {
  const result = await chrome.runtime.sendMessage({ type, ...data });
  if (!result?.ok)
    throw new Error(result?.error || 'The extension did not respond. Reopen it and try again.');
  return result;
}

$('find').addEventListener('click', async () => {
  if (busyKind) return;
  const operation = generation;
  try {
    // Call request directly in the user gesture; never on popup boot.
    const allowed = await chrome.permissions.request({ origins });
    if (busyKind || operation !== generation) return;
    if (!allowed) {
      showStatus(
        'Tab discovery was not allowed. Open the conversation and use this extension there.',
        true,
      );
      return;
    }
    const found = await chrome.tabs.query({ url: origins });
    if (busyKind || operation !== generation) return;
    choices = found.filter((tab) => isConversation(tab.url));
    if (!choices.length) {
      showStatus('No open ChatGPT conversations found. Open one in Chrome, then try again.', true);
      return;
    }
    choices.sort(
      (a, b) => Number(b.active) - Number(a.active) || a.windowId - b.windowId || a.index - b.index,
    );
    $('choose').replaceChildren(
      ...choices.map((tab, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `${tab.title || 'ChatGPT conversation'} · window ${tab.windowId} · tab ${tab.id}`;
        return option;
      }),
    );
    const index = Math.max(
      0,
      choices.findIndex((tab) => tab.id === selected?.tabId),
    );
    $('choose').value = String(index);
    $('choose-label').hidden = false;
    select(choices[index]);
  } catch {
    if (busyKind || operation !== generation) return;
    showStatus(
      'Could not list open tabs. Open the conversation and use this extension there.',
      true,
    );
  }
});
$('choose').addEventListener('change', () => select(choices[Number($('choose').value)]));
$('focus').addEventListener('click', async () => {
  if (busyKind) return;
  try {
    await request('focus', { selected });
  } catch (error) {
    showStatus(error.message, true);
  }
});
$('capture').addEventListener('click', async () => {
  if (busyKind || !selected) return;
  clearCapture();
  const operation = generation;
  freezeControls(true, 'collection');
  $('capture').hidden = true;
  $('collection-help').hidden = true;
  $('snapshot').hidden = true;
  $('collection-progress').hidden = false;
  $('collection-phase').textContent = 'Starting collection…';
  $('collection-count').textContent = '0 turns observed · 0s';
  $('cancel-collection').disabled = false;
  try {
    const result = await collectSelected();
    if (operation !== generation) return;
    showCapture(result);
  } catch (error) {
    if (operation === generation) showStatus(error.message, true);
  } finally {
    if (operation === generation) {
      $('capture').hidden = false;
      $('collection-help').hidden = false;
      $('snapshot').hidden = false;
      $('collection-progress').hidden = true;
      freezeControls(false);
      if (captured) $('deliver').focus();
      else $('capture').focus();
    }
  }
});
$('cancel-collection').addEventListener('click', () => {
  if (!activeCollection || activeCollection.cancelled) return;
  activeCollection.cancelled = true;
  $('cancel-collection').disabled = true;
  $('collection-phase').textContent = 'Stopping collection…';
  try {
    activeCollection.port.postMessage({ type: 'cancel', jobId: activeCollection.jobId });
  } catch {
    activeCollection.port.disconnect();
  }
});
$('snapshot').addEventListener('click', async () => {
  if (busyKind || !selected) return;
  clearCapture();
  const operation = generation;
  freezeControls(true, 'snapshot');
  showStatus('Reading visible turns only…');
  try {
    const result = await request('capture', { selected });
    if (operation !== generation) return;
    showCapture(result);
    $('status').hidden = true;
  } catch (error) {
    if (operation === generation) showStatus(error.message, true);
  } finally {
    if (operation === generation) {
      freezeControls(false);
      if (captured) $('deliver').focus();
    }
  }
});
$('deliver').addEventListener('click', async () => {
  if (!captured || $('deliver').disabled) return;
  freezeControls(true, 'delivery');
  try {
    if (!(await chrome.permissions.request({ origins: ['http://127.0.0.1/*'] }))) {
      showStatus('Local desk access was not allowed. Copy Markdown, or try again.', true);
      return;
    }
    const payload = captured;
    showStatus('Opening the local desk. Review the conversation there.');
    await request('deliver', payload);
    clearCapture();
    showStatus('Received by the local desk. Choose a composer there.');
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    freezeControls(false);
  }
});
$('copy').addEventListener('click', async () => {
  if (!captured) return;
  try {
    await navigator.clipboard.writeText(projectMarkdown(captured.model));
    showStatus('Copied. Paste into your chosen composer.');
  } catch {
    showStatus(
      'Clipboard write failed. Keep this open and try again, or use the local desk.',
      true,
    );
  }
});
$('discard').addEventListener('click', clearCapture);
window.addEventListener('pagehide', () => {
  captured = null;
  generation += 1;
  if (activeCollection) {
    try {
      activeCollection.port.postMessage({ type: 'cancel', jobId: activeCollection.jobId });
    } catch {
      /* Disconnect also cancels the worker job. */
    }
    activeCollection.port.disconnect();
  }
});

try {
  const bootGeneration = generation;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (bootGeneration === generation && !busyKind) select(tab);
} catch {
  if (!selected && !busyKind) select(null);
}
