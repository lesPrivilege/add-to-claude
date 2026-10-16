'use strict';
// The ChatGPT window's preload, built by plugins/deepseek-harness/build.js. It runs sandboxed in
// Electron's isolated world, the counterpart of the macOS app's WebKit `defaultClient` world: the
// page shares the DOM but cannot see this code or the IPC channel.
//
// 1. A `webkit.messageHandlers.handoff` stand-in that forwards to the helper's main process, so the
//    unchanged bridge (src/bridge.js, bundled with the compiler by scripts/build-webkit.js) runs here.
// 2. The bridge bundle: it adopts the observer's private port and compiles its packets.
// 3. The page observer (src/page-observer.js), run in the page's main world at document start,
//    before any page script, through contextBridge.executeInMainWorld.
const { contextBridge, ipcRenderer } = require('electron');

const chatHosts = ['chatgpt.com', 'chat.openai.com'];
if (window === top && location.protocol === 'https:' && chatHosts.includes(location.hostname)) {
  globalThis.webkit = {
    messageHandlers: {
      handoff: { postMessage: (message) => ipcRenderer.send('add-to-claude:handoff', message) },
    },
  };
  __BRIDGE__;
  delete globalThis.webkit;
  // The helper asks, from its main process only, for links to the files it is about to download.
  ipcRenderer.on('add-to-claude:resolve', (_event, files) =>
    globalThis.addToClaudeResolve?.(files),
  );
  contextBridge.executeInMainWorld({ func: __OBSERVER__ });
}
