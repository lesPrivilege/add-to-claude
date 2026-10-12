import { connect, el, icon, formatSize, announce } from './common.js';
import { validateConversation, projectMarkdown, demoConversation } from '/src/model.js';
import { listConversations, importConversation } from '/src/import.js';
import { receiveBrowserSource } from './browser-source.js';

const $ = (id) => document.getElementById(id);
let model = null,
  selected = null,
  api,
  busy = false,
  activeTransfer = null,
  readingFiles = false,
  sourceGeneration = 0;
let exportData = null,
  exportChoices = [],
  targets = [],
  agentChoices = [],
  files = [],
  attachmentToBind = null;
const status = $('status');
const PASSIVE = /\.(txt|md|json|csv|pdf|png|jpe?g|webp)$/i;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dialogs = [...document.querySelectorAll('dialog')];
let pendingBrowserSource = false;
dialogs.forEach((dialog) =>
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && event.offsetX < 0) dialog.close();
  }),
);

function ready() {
  return (
    model &&
    selected &&
    !busy &&
    !readingFiles &&
    (model.verification.status === 'verified' || $('accept-unverified').checked)
  );
}
function updateAction() {
  $('transfer-btn').disabled = !ready();
  $('transfer-label').textContent = busy
    ? 'Adding…'
    : selected?.kind === 'clipboard'
      ? `Copy for ${selected.name}`
      : 'Add to composer';
  $('transfer-caption').textContent =
    selected?.kind === 'clipboard'
      ? 'Copy here, then paste into your chosen composer.'
      : 'Your draft stays yours. Nothing is sent.';
}
function setSource(next) {
  sourceGeneration++;
  model = next ? validateConversation(next) : null;
  // A JSON reference never restores file bytes. Require a new explicit local selection.
  if (model)
    for (const attachment of model.attachments) {
      if (attachment.status === 'available') {
        attachment.status = 'download-needed';
        delete attachment.localFileId;
        model.verification.status = 'partial';
        model.verification.issues.push({
          code: 'file-not-loaded',
          message: `${attachment.name}: select the local file again; JSON contains its reference only.`,
          sourceLocator: attachment.sourceLocator,
        });
      }
    }
  files = [];
  $('accept-unverified').checked = false;
  $('source-checks').open = false;
  $('source-empty').hidden = !!model;
  $('source-loaded').hidden = !model;
  $('unverified-confirm').hidden = !model || model.verification.status === 'verified';
  announce(status, '');
  announce($('source-notice'), '');
  renderSource();
  updateAction();
}
receiveBrowserSource(
  async (next, expires) => {
    if (busy || readingFiles || pendingBrowserSource || dialogs.some((dialog) => dialog.open))
      throw new Error('Finish the current action.');
    pendingBrowserSource = true;
    try {
      if (model) {
        $('incoming-title').textContent = next.source.title;
        const dialog = $('incoming-dialog');
        dialog.returnValue = '';
        const decision = await new Promise((resolve) => {
          const timer = setTimeout(
            () => dialog.close('expired'),
            Math.max(0, expires - Date.now()),
          );
          dialog.addEventListener(
            'close',
            () => {
              clearTimeout(timer);
              resolve(dialog.returnValue);
            },
            { once: true },
          );
          dialog.showModal();
        });
        if (decision !== 'use') return decision === 'expired' ? 'expired' : 'kept';
      }
      if (busy || readingFiles || Date.now() >= expires) throw new Error('Try again.');
      setSource(next);
      announce(status, 'Current chat loaded. Review the captured turns before adding.');
      $('preview-btn').focus();
    } finally {
      pendingBrowserSource = false;
    }
  },
  (reason) =>
    announce(
      $('source-notice'),
      reason === 'kept'
        ? 'Kept existing source. Nothing changed.'
        : reason === 'expired'
          ? 'This handoff expired. Choose the chat again in Chrome.'
          : 'Source unchanged. Finish any open action, then choose the chat again in Chrome.',
    ),
);
function renderSource() {
  if (!model) return;
  $('conversation-title').textContent = model.source.title;
  const branch = model.branches?.availableLeaves?.length || 1;
  $('conversation-meta').textContent =
    `${model.turns.length} turns · ${formatSize(new TextEncoder().encode(projectMarkdown(model)).length)}${branch > 1 ? ` · ${branch} branches, one selected` : ''}`;
  $('verification').textContent =
    model.verification.status === 'verified'
      ? '✓ Selected branch verified'
      : model.verification.status === 'partial'
        ? 'Partial · review gaps'
        : 'Completeness unverified';
  $('verification').className = `tag ${model.verification.status === 'verified' ? '' : 'warning'}`;
  const issues = model.verification.issues;
  $('source-checks').hidden = !issues.length;
  $('source-checks-title').textContent =
    `Review ${issues.length} content check${issues.length === 1 ? '' : 's'}`;
  $('source-issues').replaceChildren(...issues.map((issue) => el('li', { text: issue.message })));
  const list = $('attachment-list');
  $('attach-btn').textContent = model.attachments.some((item) => item.download && !item.localFileId)
    ? 'Select downloaded files'
    : '+ Add downloaded files';
  list.replaceChildren();
  for (const attachment of model.attachments || []) {
    const local = files.find((file) => file.localFileId === attachment.localFileId);
    const row = el('div', { class: 'attachment' }, [
      icon('turn'),
      el('span', { text: attachment.name }),
    ]);
    if (!local && attachment.url && /^https?:/.test(attachment.url))
      row.append(
        el('a', {
          href: attachment.url,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: 'Open source',
        }),
      );
    row.append(
      el('span', {
        class: 'file-state',
        text: local
          ? `${formatSize(local.size)} · selected`
          : attachment.download
            ? 'Downloaded · select file'
            : attachment.status === 'expired'
              ? 'Expired'
              : attachment.status === 'inaccessible'
                ? 'Unavailable'
                : 'File needed',
      }),
    );
    if (!local)
      row.append(
        el('button', {
          class: 'text-button',
          text: 'Select file',
          'aria-label': `Select downloaded file for ${attachment.name}`,
          onclick: () => {
            attachmentToBind = attachment.id;
            $('attachment-files').multiple = false;
            $('attachment-files').click();
          },
        }),
      );
    else
      row.append(
        el('button', {
          class: 'icon-button',
          text: '×',
          'aria-label': `Remove ${local.name}`,
          onclick: () => removeFile(local),
        }),
      );
    list.append(row);
  }
}
function removeFile(file) {
  if (busy || readingFiles) return;
  files = files.filter((item) => item !== file);
  const attachment = model.attachments.find((item) => item.localFileId === file.localFileId);
  if (attachment) {
    model.attachments = file.originalReference
      ? model.attachments.map((item) =>
          item === attachment ? { ...file.originalReference } : item,
        )
      : model.attachments.filter((item) => item !== attachment);
  }
  renderSource();
}
function choose(target) {
  selected = target;
  $('target-name').textContent = target.name;
  $('target-logo').replaceChildren(
    target.kind === 'live' ? icon('turn') : document.createTextNode(target.mark || target.name[0]),
  );
  $('target-detail').textContent =
    target.kind === 'live'
      ? `${target.hasDraft ? 'Draft present · ' : ''}Local test composer · insertion verified`
      : target.detail;
  $('draft-controls').hidden = target.kind !== 'live';
  document.querySelector('[name="draft-mode"][value="append"]').checked = true;
  $('target-dialog').close();
  announce(status, '');
  updateAction();
}
async function refreshTargets() {
  if (!api) return [];
  const result = await api('/targets');
  targets = result.targets;
  return targets;
}
async function openTargets() {
  const list = $('targets-list');
  list.replaceChildren(el('p', { class: 'empty-targets', text: 'Finding open composers…' }));
  $('target-dialog').showModal();
  try {
    await refreshTargets();
  } catch (error) {
    targets = [];
    announce(status, error.message, 'error');
  }
  list.replaceChildren(el('p', { class: 'target-group', text: 'Open local composers' }));
  if (!targets.length)
    list.append(
      el('p', {
        class: 'empty-targets',
        text: 'No local test composer is open. Other apps use the clipboard choices below.',
      }),
    );
  for (const target of targets) {
    const duplicates = targets.filter((item) => item.title === target.title).length > 1;
    const identity = {
      ...target,
      kind: 'live',
      name: duplicates ? `${target.title} · ${target.id.slice(0, 8)}` : target.title,
    };
    const button = targetButton(
      identity,
      target.ready
        ? `${target.hasDraft ? 'Draft present · ' : ''}Ready to add`
        : 'Paused · enable receiving in the composer',
    );
    button.disabled = !target.ready;
    list.append(button);
  }
  let group = '';
  for (const target of agentChoices) {
    if (target.group !== group) {
      group = target.group;
      list.append(el('p', { class: 'target-group', text: group }));
    }
    list.append(targetButton({ ...target, kind: 'clipboard' }, target.detail));
  }
}
function targetButton(target, detail) {
  return el('button', { class: 'target-option', onclick: () => choose(target) }, [
    el('span', { class: 'target-logo', 'aria-hidden': 'true' }, [
      target.kind === 'live'
        ? icon('turn')
        : document.createTextNode(target.mark || target.name[0]),
    ]),
    el('div', {}, [el('strong', { text: target.name }), el('small', { text: detail })]),
    el('span', {
      class: 'target-check',
      text: selected?.id === target.id ? '✓' : '',
      'aria-hidden': 'true',
    }),
  ]);
}
function save(contents, name, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = el('a', { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function parsePaste(text) {
  let fence = null,
    role = null,
    buffer = [],
    turns = [];
  function flush() {
    if (buffer.join('\n').trim())
      turns.push({
        id: `paste-${turns.length + 1}`,
        role: role || 'user',
        markdown: buffer.join('\n').trim(),
        sourceLocator: `manual-paste/turn/${turns.length + 1}`,
        contentFidelity: 'partial',
        citations: [],
      });
    buffer = [];
  }
  for (const line of text.split('\n')) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
    }
    const heading = !fence && line.match(/^##\s+(User|Assistant)\s*$/i);
    if (heading) {
      flush();
      role = heading[1].toLowerCase();
    } else buffer.push(line);
  }
  flush();
  return turns;
}
function pasteSource() {
  try {
    const text = $('paste-content').value;
    if (!text.trim()) throw new Error('Paste the selected conversation first.');
    if (new TextEncoder().encode(text).length > 8 * 1024 * 1024)
      throw new Error('This text exceeds 8 MB. Use a smaller selected branch.');
    const url = $('paste-source').value.trim();
    if (url && !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\/(c|share)\/[\w-]+$/.test(url))
      throw new Error('Use a ChatGPT conversation or share link, or leave the source link blank.');
    const turns = parsePaste(text);
    if (!turns.length) throw new Error('Paste content below the turn headings.');
    const leaf = turns.at(-1).id;
    setSource({
      schemaVersion: 1,
      source: {
        type: 'imported',
        id: crypto.randomUUID(),
        title: $('paste-title').value.trim() || 'Current ChatGPT conversation',
        url,
        locator: 'manual-paste',
      },
      turns,
      branches: {
        selectedLeaf: leaf,
        availableLeaves: [{ id: leaf, turnCount: turns.length }],
        selection: 'single-path',
      },
      verification: {
        status: 'unverified',
        issues: [
          {
            code: 'MANUAL_PASTE',
            message:
              'Pasted turns cannot prove the full conversation or branch. Check for missing turns and files.',
          },
        ],
      },
      attachments: [],
    });
    $('paste-content').value = '';
    $('paste-dialog').close();
  } catch (error) {
    announce($('paste-error'), error.message, 'error');
  }
}
function renderBranches() {
  const choice = exportChoices.find((item) => item.id === $('conversation-select').value);
  const select = $('branch-select');
  select.replaceChildren();
  if (!choice) return;
  const leaves = [...new Set([choice.currentNode, ...choice.leafIds].filter(Boolean))];
  for (const [index, leaf] of leaves.entries())
    select.append(
      el('option', {
        value: leaf,
        text:
          leaf === choice.currentNode
            ? 'Current selected branch'
            : `Alternate branch ${index + 1} · ${leaf.slice(0, 12)}`,
      }),
    );
}
async function importFile(file) {
  try {
    if (!file) return;
    if (file.size > 64 * 1024 * 1024)
      throw new Error('Export is larger than 64 MB. Select a smaller JSON export locally.');
    const raw = JSON.parse(await file.text());
    if (raw.schemaVersion === 1) {
      setSource(raw);
      return;
    }
    exportData = raw;
    exportChoices = listConversations(raw);
    if (!exportChoices.length)
      throw new Error(
        'No conversations found. Choose conversations.json from your ChatGPT export.',
      );
    $('conversation-select').replaceChildren(
      ...exportChoices.map((item) =>
        el('option', { value: item.id, text: `${item.title} · ${item.turnCount} turns` }),
      ),
    );
    renderBranches();
    announce($('import-error'), '');
    $('import-dialog').showModal();
  } catch (error) {
    exportData = null;
    exportChoices = [];
    announce(status, error.message, 'error');
  } finally {
    $('import-file').value = '';
  }
}
async function attachFiles(incoming) {
  if (busy || readingFiles || !model) return;
  const generation = sourceGeneration;
  const binding = attachmentToBind;
  readingFiles = true;
  updateAction();
  try {
    const additions = [];
    let total = files.reduce((sum, f) => sum + f.size, 0);
    if (files.length + incoming.length > 10) throw new Error('Add up to 10 files at a time.');
    for (const file of incoming) {
      if (!PASSIVE.test(file.name) || /[\x00-\x1f/\\]/.test(file.name) || file.name.length > 180)
        throw new Error(
          'Use text, Markdown, JSON, CSV, PDF, PNG, JPEG, or WebP files with plain filenames.',
        );
      if (file.size > 5 * 1024 * 1024)
        throw new Error(`${file.name} exceeds 5 MB. Add a smaller file.`);
      total += file.size;
      if (total > 10 * 1024 * 1024)
        throw new Error('Files exceed 10 MB in total. Remove a file first.');
      if (files.concat(additions).some((f) => f.name === file.name))
        throw new Error(`${file.name} is already attached. Remove it before adding a replacement.`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('');
      if (generation !== sourceGeneration)
        throw new Error('Conversation changed while reading files. Select the files again.');
      const matches = model.attachments.filter(
        (item) =>
          !item.localFileId &&
          item.download?.name === file.name &&
          item.download?.size === file.size,
      );
      if (!binding && matches.length > 1)
        throw new Error(
          `${file.name} matches more than one download. Use that source file’s Select file action.`,
        );
      const reference = binding
        ? model.attachments.find((item) => item.id === binding)
        : matches[0];
      if (
        reference?.download &&
        (reference.download.name !== file.name || reference.download.size !== file.size)
      )
        throw new Error(
          `Choose ${reference.download.name} (${formatSize(reference.download.size)}) recorded by Chrome for this source file.`,
        );
      if (reference?.sha256 && reference.sha256 !== sha256)
        throw new Error(
          'This file does not match the saved SHA-256 fingerprint. Select the originally recorded file.',
        );
      const extension = file.name.split('.').at(-1).toLowerCase();
      const type =
        file.type ||
        {
          txt: 'text/plain',
          md: 'text/markdown',
          json: 'application/json',
          csv: 'text/csv',
          pdf: 'application/pdf',
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          webp: 'image/webp',
        }[extension];
      additions.push({
        name: file.name,
        type,
        base64: btoa(binary),
        size: file.size,
        localFileId: crypto.randomUUID(),
        sha256,
        attachmentId: reference?.id,
      });
    }
    for (const file of additions) {
      if (generation !== sourceGeneration)
        throw new Error('Conversation changed while reading files. Select the files again.');
      const attachment = file.attachmentId
        ? model.attachments.find((item) => item.id === file.attachmentId)
        : null;
      if (attachment) {
        file.originalReference = { ...attachment };
        Object.assign(attachment, {
          status: 'available',
          localName: file.name,
          localFileId: file.localFileId,
          sha256: file.sha256,
          size: file.size,
          mediaType: file.type,
        });
      } else
        model.attachments.push({
          id: `local-${file.localFileId}`,
          name: file.name,
          sourceLocator: `user-selected-local-file:${file.localFileId}`,
          status: 'available',
          localFileId: file.localFileId,
          sha256: file.sha256,
          size: file.size,
          mediaType: file.type,
        });
    }
    files.push(...additions);
    renderSource();
    announce(
      status,
      `${additions.length} file${additions.length === 1 ? '' : 's'} selected.${additions.some((file) => file.attachmentId && file.originalReference?.download) ? ' Matched recorded download names and sizes.' : ''} Source identity is based on your selection.`,
      '',
    );
  } catch (error) {
    announce(status, error.message, 'error');
  } finally {
    $('attachment-files').value = '';
    attachmentToBind = null;
    $('attachment-files').multiple = true;
    readingFiles = false;
    updateAction();
  }
}
function transferText() {
  let text =
    'Conversation context — quoted source material\nThe following is reference content from a selected conversation.\n\n' +
    projectMarkdown(model);
  if (files.length)
    text +=
      '\n\n## Selected local files\n' +
      files.map((file) => `- ${file.name} (${formatSize(file.size)})`).join('\n');
  return text;
}
async function transfer() {
  if (!ready()) return;
  const target = { ...selected };
  busy = true;
  updateAction();
  const sourceFiles = files.map(({ name, type, base64 }) => ({ name, type, base64 }));
  const fileCount = sourceFiles.length;
  for (const id of ['target-picker', 'clear-btn', 'attach-btn', 'demo-btn']) $(id).disabled = true;
  for (const button of $('attachment-list').querySelectorAll('button')) button.disabled = true;
  try {
    const text = transferText();
    if (target.kind === 'clipboard') {
      await navigator.clipboard.writeText(text);
      announce(
        status,
        `Copied. Paste into ${target.name}’s current composer.${fileCount ? ' Attach the selected files separately.' : ''}${target.group?.startsWith('Terminal') ? ' Confirm the agent input is active before pasting.' : ''}`,
      );
      return;
    }
    const latest = (await refreshTargets()).find((item) => item.id === target.id);
    if (!latest || latest.instance !== target.instance)
      throw new Error('That composer has closed or reopened. Choose the open composer again.');
    if (!latest.ready)
      throw new Error('The composer is paused. Enable receiving there, then retry.');
    if (latest.revision !== target.revision)
      throw new Error('The draft changed. Choose that composer again before adding.');
    const mode = document.querySelector('[name="draft-mode"]:checked').value;
    const payload = {
      targetId: target.id,
      targetInstance: target.instance,
      targetRevision: target.revision,
      mode,
      text,
      files: sourceFiles,
      confirmed: true,
    };
    if (new TextEncoder().encode(JSON.stringify(payload)).length > 16 * 1024 * 1024)
      throw new Error(
        'Text and encoded files exceed the 16 MB transfer limit. Remove a file or use a shorter branch.',
      );
    const result = await api('/transfers', payload);
    activeTransfer = result.id;
    $('cancel-btn').hidden = false;
    announce(status, 'Waiting for the selected composer…', 'working');
    for (let attempt = 0; attempt < 75; attempt++) {
      const receipt = await api(`/transfers/${result.id}`);
      if (receipt.status === 'inserted') {
        announce(
          status,
          `Added to ${target.name}. ${fileCount ? `${fileCount} file${fileCount === 1 ? '' : 's'} attached. ` : ''}Ready for your review.`,
        );
        const refreshed = (await refreshTargets()).find((item) => item.id === target.id);
        if (refreshed) selected = { ...target, ...refreshed };
        return;
      }
      if (receipt.status === 'cancelled') {
        announce(status, 'Cancelled. Nothing was added.');
        return;
      }
      if (['failed', 'expired'].includes(receipt.status))
        throw new Error(
          receipt.error ||
            'The composer did not confirm insertion. Check its draft before retrying.',
        );
      if (receipt.status === 'applying') {
        $('cancel-btn').hidden = true;
        announce(status, 'Verifying the inserted draft…', 'working');
      }
      await delay(500);
    }
    throw new Error('No receipt arrived. Check the composer before retrying.');
  } catch (error) {
    announce(
      status,
      target.kind === 'clipboard'
        ? 'Clipboard access was blocked. Allow copying in this browser, then retry.'
        : error.name === 'TimeoutError'
          ? 'The local bridge did not respond. Inspect the selected composer before retrying.'
          : error.message ||
            'Could not add the content. Choose a composer or use a clipboard choice, then retry.',
      'error',
    );
  } finally {
    busy = false;
    activeTransfer = null;
    $('cancel-btn').hidden = true;
    for (const id of ['target-picker', 'clear-btn', 'attach-btn', 'demo-btn'])
      $(id).disabled = false;
    for (const button of $('attachment-list').querySelectorAll('button')) button.disabled = false;
    updateAction();
  }
}
$('target-picker').addEventListener('click', openTargets);
$('transfer-btn').addEventListener('click', transfer);
$('cancel-btn').addEventListener('click', async () => {
  if (!activeTransfer) return;
  try {
    await api(`/transfers/${activeTransfer}`, undefined, 'DELETE');
  } catch (error) {
    announce(status, error.message, 'error');
  }
});
$('accept-unverified').addEventListener('change', updateAction);
$('import-btn').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', (event) => importFile(event.target.files[0]));
$('paste-btn').addEventListener('click', () => {
  announce($('paste-error'), '');
  $('paste-dialog').showModal();
});
$('browser-help-btn').addEventListener('click', () => $('browser-help-dialog').showModal());
$('use-paste').addEventListener('click', pasteSource);
$('demo-btn').addEventListener('click', () => {
  if (!busy) setSource(demoConversation());
});
$('clear-btn').addEventListener('click', () => setSource(null));
$('attach-btn').addEventListener('click', () => {
  attachmentToBind = null;
  $('attachment-files').multiple = true;
  $('attachment-files').click();
});
$('attachment-files').addEventListener('change', (event) => attachFiles([...event.target.files]));
$('conversation-select').addEventListener('change', renderBranches);
$('use-import').addEventListener('click', () => {
  try {
    setSource(
      importConversation(exportData, $('conversation-select').value, $('branch-select').value),
    );
    $('import-dialog').close();
  } catch (error) {
    announce($('import-error'), error.message, 'error');
  }
});
$('import-dialog').addEventListener('close', () => {
  exportData = null;
  exportChoices = [];
  $('conversation-select').replaceChildren();
  $('branch-select').replaceChildren();
});
$('preview-btn').addEventListener('click', () => {
  $('preview-content').textContent = projectMarkdown(model);
  $('preview-dialog').showModal();
});
$('preview-dialog').addEventListener('close', () => {
  $('preview-content').textContent = '';
});
$('save-btn').addEventListener('click', () =>
  save(JSON.stringify(model, null, 2), 'selected-conversation.json', 'application/json'),
);
$('save-markdown').addEventListener('click', () =>
  save(projectMarkdown(model), 'selected-conversation.md', 'text/markdown'),
);
$('register-btn').addEventListener('click', () => {
  const name = $('custom-name').value.trim();
  if (!name) return;
  const target = {
    id: `custom-${crypto.randomUUID()}`,
    name,
    detail: 'Copy, then paste into this app',
    group: 'Registered this session',
    mark: name[0].toUpperCase(),
    kind: 'clipboard',
  };
  agentChoices.push(target);
  $('custom-name').value = '';
  choose(target);
});
try {
  api = await connect();
  agentChoices = await (await fetch('/targets.json')).json();
} catch (error) {
  announce(status, error.message, 'error');
}
window.addEventListener('pagehide', () => {
  model = null;
  exportData = null;
  files = [];
});
