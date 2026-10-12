// Optional download assistance; selected bytes still enter through the desk's File picker.
let capture = null;
let busy = false;
let sourceBusy = false;
let generation = 0;
const section = document.createElement('section');
section.id = 'download-assistance';
section.hidden = true;
document.getElementById('review').after(section);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const supported = (file) =>
  file.status === 'download-needed' &&
  /^https:\/\//u.test(file.url || '') &&
  /\.(?:txt|md|json|csv|pdf|png|jpe?g|webp)$/iu.test(file.name);
async function request(type, data) {
  const result = await chrome.runtime.sendMessage({ type, ...data });
  if (!result?.ok) throw new Error(result?.error || 'Check Chrome Downloads, then retry.');
  return result.receipt;
}
function lock(value) {
  busy = value;
  window.dispatchEvent(new CustomEvent('gh-download-busy', { detail: { busy: value } }));
  for (const button of section.querySelectorAll('button[data-start]'))
    button.disabled = value || sourceBusy;
}
function render() {
  section.replaceChildren();
  const files = capture?.model.attachments.filter(supported) || [];
  section.hidden = !files.length;
  if (!files.length) return;
  const heading = document.createElement('strong');
  heading.textContent = 'Files';
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    'Download to Chrome’s folder, then select the files together in the desk. No file is opened.';
  section.append(heading, hint);
  for (const file of files) {
    const row = document.createElement('div');
    const label = document.createElement('span');
    label.textContent = file.name;
    const button = document.createElement('button');
    button.className = 'text-button';
    button.dataset.start = '';
    button.textContent = file.download ? 'Download again' : 'Download';
    button.disabled = busy || sourceBusy;
    const state = document.createElement('p');
    state.className = 'hint';
    state.setAttribute('role', 'status');
    state.textContent = file.download
      ? `Downloaded as ${file.download.name}. Select it in the desk.`
      : '';
    const cancel = document.createElement('button');
    cancel.className = 'text-button';
    cancel.textContent = 'Cancel download';
    cancel.hidden = true;
    row.append(label, button, cancel, state);
    section.append(row);
    button.addEventListener('click', async () => {
      if (busy || sourceBusy || !capture) return;
      const selected = capture,
        current = generation;
      let receipt = null,
        cancelled = false;
      lock(true);
      state.textContent = 'Waiting for download permission…';
      cancel.onclick = async () => {
        cancelled = true;
        cancel.disabled = true;
        if (receipt) {
          try {
            await request('downloadCancel', { receiptId: receipt.receiptId });
          } catch {}
        }
      };
      try {
        if (!(await chrome.permissions.request({ permissions: ['downloads'] })))
          throw new Error(
            'Download assistance was not allowed. Use Download in the original conversation.',
          );
        if (current !== generation) return;
        receipt = await request('downloadStart', { ...selected, attachmentId: file.id });
        cancel.hidden = false;
        state.textContent = receipt.message;
        const deadline = Date.now() + 120_000;
        while (
          receipt.status === 'pending' &&
          current === generation &&
          !cancelled &&
          Date.now() < deadline
        ) {
          await delay(750);
          receipt = await request('downloadStatus', { receiptId: receipt.receiptId });
          if (current === generation) state.textContent = receipt.message;
        }
        if (receipt.status === 'pending')
          receipt = await request('downloadCancel', { receiptId: receipt.receiptId });
        if (current !== generation) return;
        state.textContent = receipt.message;
        if (receipt.status === 'complete') {
          file.download = { name: receipt.name, size: receipt.size };
          button.textContent = 'Download again';
        }
      } catch (error) {
        if (current === generation) state.textContent = error.message;
      } finally {
        cancel.hidden = true;
        if (current === generation) lock(false);
      }
    });
  }
}
window.addEventListener('gh-capture', (event) => {
  capture = event.detail;
  generation++;
  render();
});
window.addEventListener('gh-capture-clear', () => {
  capture = null;
  generation++;
  busy = false;
  render();
});
window.addEventListener('gh-busy', (event) => {
  sourceBusy = event.detail.busy && event.detail.kind !== 'download';
  for (const button of section.querySelectorAll('button[data-start]'))
    button.disabled = busy || sourceBusy;
});
window.addEventListener('pagehide', () => {
  capture = null;
  generation++;
});
