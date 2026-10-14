const $ = (id) => document.getElementById(id);
const hosts = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
let busy = false;
let lastRevision = null;
let lastOutcome = null;
const request = async (type, values = {}) => {
  const reply = await chrome.runtime.sendMessage({ type, ...values });
  if (!reply?.ok) throw new Error(reply?.error || reply?.message || 'Handoff is unavailable.');
  return reply;
};
function status(text) {
  $('status').textContent = text;
}
function showVerification(value) {
  const tag = $('verify');
  tag.hidden = !value;
  if (!value) return;
  const verified = value === 'verified';
  const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  glyph.classList.add('g');
  glyph.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', verified ? '#g-done' : '#g-unverified');
  glyph.append(use);
  tag.classList.toggle('dash', !verified);
  tag.replaceChildren(glyph, value[0].toUpperCase() + value.slice(1));
}
function showPreview(open) {
  $('preview-area').hidden = !open;
  $('preview').setAttribute('aria-pressed', String(open));
}
function render(state) {
  $('enable').hidden = state.enabled;
  $('source').textContent = state.ready
    ? `${state.turns} turns · ${state.files} file refs`
    : 'Open a conversation to prepare it.';
  showVerification(state.ready && state.verification.status);
  $('help').hidden = state.enabled;
  $('preview').disabled = !state.ready || busy;
  $('save').disabled = !state.ready || busy;
  $('add').disabled = !state.canAdd || busy;
  $('add-label').textContent = state.target ? `Add to ${state.target.name}` : 'Add to Agent';
  if (lastRevision !== state.revision) {
    showPreview(false);
    $('text').value = '';
    lastRevision = state.revision;
  }
  if (state.outcome && state.outcome.id !== lastOutcome) {
    status('Last handoff: ' + state.outcome.message);
    lastOutcome = state.outcome.id;
  }
}
async function refresh() {
  if (busy) return;
  try {
    render(await request('chatStatus'));
  } catch (error) {
    $('enable').hidden = false;
    $('source').textContent = error.message;
    showVerification(null);
    $('add').disabled = true;
    $('preview').disabled = true;
    $('save').disabled = true;
  }
}
async function run(action) {
  if (busy) return;
  busy = true;
  document.body.ariaBusy = 'true';
  for (const id of ['enable', 'targets', 'target', 'access', 'preview', 'save', 'add'])
    $(id).disabled = true;
  try {
    await action();
  } catch (error) {
    status(error.message);
  } finally {
    busy = false;
    document.body.ariaBusy = 'false';
    for (const id of ['enable', 'targets', 'target', 'access']) $(id).disabled = false;
    $('cancel').hidden = true;
    await refresh();
  }
}
$('enable').addEventListener('click', () => {
  // Keep permission acquisition directly in the user's gesture.
  const permission = chrome.permissions.request({ origins: hosts });
  void run(async () => {
    if (!(await permission)) throw new Error('Chat access was not granted.');
    render(await request('chatEnable'));
    status('Reader enabled. Open the conversation normally; Handoff does not refresh this page.');
  });
});
$('targets').addEventListener(
  'click',
  () =>
    void run(async () => {
      const response = await request('chatTargets');
      $('access').hidden = response.trusted;
      $('target').replaceChildren(
        new Option('Choose composer…', ''),
        ...(response.targets ?? []).map((row) => new Option(`${row.app} — ${row.window}`, row.id)),
      );
      status(
        response.trusted
          ? 'Focus the composer once, then pick its window.'
          : 'Allow Accessibility, then find windows again.',
      );
    }),
);
$('target').addEventListener('change', () => {
  if ($('target').value)
    void run(async () => {
      render(await request('chatSelect', { targetId: $('target').value }));
      status('Composer selected. Its draft is kept.');
    });
});
$('access').addEventListener(
  'click',
  () =>
    void run(async () => {
      await request('chatAccess');
      status('Finish the Accessibility grant in System Settings, then choose the composer.');
    }),
);
$('preview').addEventListener('click', () => {
  if (!$('preview-area').hidden) return showPreview(false);
  void run(async () => {
    const response = await request('chatPreview');
    render(response);
    $('text').value = response.markdown;
    showPreview(true);
  });
});
$('save').addEventListener(
  'click',
  () =>
    void run(async () => {
      const { markdown } = await request('chatPreview');
      const url = URL.createObjectURL(
        new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'context.md';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status('Markdown export requested. File references are not attachment delivery.');
    }),
);
$('add').addEventListener(
  'click',
  () =>
    void run(async () => {
      $('cancel').hidden = false;
      status('Adding to the selected composer…');
      const result = await request('chatAdd');
      status(result.message || 'Inspect the target draft.');
    }),
);
$('cancel').addEventListener('click', () => {
  void request('chatCancel').then(
    () => status('Cancelled. Nothing further will be added.'),
    (error) => status(error.message),
  );
});
await refresh();
setInterval(() => void refresh(), 1500);
