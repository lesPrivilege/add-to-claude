// The ChatGPT panel helper: an Electron main process started by the plugin's host half, which it
// talks to only over the inherited Node IPC pipe. It quits when that pipe closes.
import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatWindow } from './chat.js';

const send = (message) => {
  try {
    process.send?.(message);
  } catch {
    /* The host is gone; the disconnect handler quits. */
  }
};

if (typeof process.send !== 'function') {
  process.stderr.write('The ChatGPT panel helper is started by the DeepSeek Harness plugin.\n');
  app.exit(1);
} else if (!app.requestSingleInstanceLock()) {
  send({ type: 'fatal', reason: 'Another ChatGPT panel window is already running.' });
  app.exit(0);
} else {
  process.on('disconnect', () => app.quit());
  // The window hides instead of closing; the helper lives until the host stops it or the user quits.
  app.on('window-all-closed', () => {});
  let chat = null;
  // Messages that arrive before the window exists wait for it.
  const early = [];
  process.on('message', (message) => (chat ? void handle(chat, message) : early.push(message)));
  app.on('before-quit', () => chat?.close());

  const icon = fileURLToPath(new URL('../icon.png', import.meta.url));
  void app.whenReady().then(() => {
    if (process.platform === 'darwin' && existsSync(icon)) app.dock?.setIcon(icon);
    chat = new ChatWindow({
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
      filesRoot: join(app.getPath('downloads'), 'Add to Claude'),
      onChange: (state) => send({ type: 'state', ...state }),
    });
    send({ type: 'state', ...chat.state() });
    for (const message of early.splice(0)) void handle(chat, message);
    app.on('activate', () => chat.show());
  });
}

async function handle(chat, message) {
  switch (message?.type) {
    case 'show':
      return chat.show();
    case 'pin':
      return chat.pin(message.on === true);
    case 'quit':
      return app.quit();
    case 'add': {
      if (!Number.isSafeInteger(message.id)) return;
      try {
        const { markdown, note } = await chat.handOff(message.downloadFiles === true);
        send({ type: 'reply', id: message.id, ok: true, markdown, note });
      } catch (error) {
        send({ type: 'reply', id: message.id, ok: false, error: error.message });
      }
    }
  }
}
