import { connect, el, announce, formatSize } from './common.js';
const $ = (id) => document.getElementById(id);
const editor = $('editor'),
  status = $('composer-status');
let api,
  id = null,
  instance = crypto.randomUUID(),
  revision = 0,
  applying = false,
  registeredRevision = -1,
  attachments = [],
  heartbeat;
const title = new URLSearchParams(location.search).get('title')?.slice(0, 100) || 'Field notes';
$('composer-title').textContent = title;
document.title = `${title} · Local test composer`;
async function register() {
  const result = await api('/composers', {
    ...(id ? { id } : {}),
    title: $('composer-title').textContent,
    instance,
    ready: $('receiving').checked,
    revision,
    hasDraft: !!editor.value || attachments.length > 0,
  });
  id = result.id;
  $('window-identity').textContent = `Window ${id.slice(0, 8)}`;
  registeredRevision = revision;
  $('composer-state').textContent = $('receiving').checked
    ? 'Ready to receive'
    : 'Receiving paused';
}
function renderFiles() {
  $('composer-files').replaceChildren(
    ...attachments.map((file) =>
      el('p', { text: `↳ ${file.name} · ${formatSize(file.size)} · bytes verified` }),
    ),
  );
}
async function poll() {
  if (applying || !id || !$('receiving').checked) return;
  try {
    if (registeredRevision !== revision) await register();
    const { transfer } = await api(
      `/composers/${id}/pending?instance=${encodeURIComponent(instance)}`,
    );
    if (!transfer || $('hold-next').checked) return;
    applying = true;
    if (transfer.targetInstance !== instance || transfer.targetRevision !== revision)
      throw new Error('Conversation changed. Select this target again.');
    const old = editor.value,
      oldFiles = attachments;
    const claim = await api(`/transfers/${transfer.id}/claim`, { instance, revision });
    try {
      if ($('fail-next').checked) {
        $('fail-next').checked = false;
        throw new Error('Test insertion failed. Retry when the composer is ready.');
      }
      if (
        Date.now() >= claim.expiresAt ||
        transfer.targetInstance !== instance ||
        transfer.targetRevision !== revision ||
        !$('receiving').checked
      )
        throw new Error('The selected conversation is no longer ready. Choose it again.');
      const expected =
        transfer.mode === 'append' && old ? `${old}\n\n${transfer.text}` : transfer.text;
      const incoming = transfer.files.map((file) => {
        const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
        return new File([bytes], file.name, { type: file.type });
      });
      // Never synthesize keys. This adapter owns this exact textarea and File state.
      if (Date.now() >= Math.min(claim.expiresAt, transfer.expiresAt))
        throw new Error('The transfer expired before insertion. Select the composer and retry.');
      editor.focus();
      editor.value = expected;
      attachments = transfer.mode === 'append' ? [...oldFiles, ...incoming] : incoming;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      const writtenRevision = revision;
      if (document.activeElement !== editor || editor.value !== expected)
        throw new Error('Could not verify the composer text. Inspect its draft before retrying.');
      for (let i = 0; i < incoming.length; i++) {
        const bytes = new Uint8Array(await incoming[i].arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192)
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        if (btoa(binary) !== transfer.files[i].base64)
          throw new Error('Could not verify an attachment. Inspect the draft before retrying.');
      }
      if (editor.value !== expected || revision !== writtenRevision)
        throw new Error('The draft changed during verification. Inspect it before retrying.');
      renderFiles();
      await register();
      await api(`/transfers/${transfer.id}/ack`, {
        instance,
        claimToken: claim.claimToken,
        status: 'inserted',
        revision,
      });
      announce(status, 'Added. Review your draft when you’re ready.');
    } catch (error) {
      // A failed ACK can mean insertion succeeded. Do not promise rollback or safe retry.
      announce(status, error.message, 'error');
      try {
        await api(`/transfers/${transfer.id}/ack`, {
          instance,
          claimToken: claim.claimToken,
          status: 'failed',
          revision,
          error: error.message,
        });
      } catch {}
    }
  } catch (error) {
    announce(status, error.message, 'error');
  } finally {
    applying = false;
  }
}
editor.addEventListener('input', () => {
  revision++;
});
$('receiving').addEventListener('change', () =>
  register().catch((error) => announce(status, error.message, 'error')),
);
$('new-conversation').addEventListener('click', async () => {
  if (applying) return;
  // Keep window identity, advance revision, change visible conversation identity.
  revision++;
  editor.value = '';
  attachments = [];
  renderFiles();
  $('composer-title').textContent = `Another conversation ${revision}`;
  await register();
  announce(status, 'Conversation switched. Choose this window again in gpt-handoff.');
});
try {
  api = await connect();
  await register();
  heartbeat = setInterval(
    () =>
      register().catch(() => {
        $('composer-state').textContent = 'Disconnected';
      }),
    2500,
  );
  setInterval(poll, 300);
} catch (error) {
  announce(status, error.message, 'error');
}
window.addEventListener('pagehide', () => {
  clearInterval(heartbeat);
  editor.value = '';
  attachments = [];
});
