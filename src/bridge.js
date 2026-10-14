import { compile } from './compile.js';

// Runs in the app's own WebKit content world. The page shares the DOM but cannot see this code or
// the native handler. It compiles what the page observer reports and passes only the result on.
const handler = globalThis.webkit?.messageHandlers?.handoff;
if (handler && window === top)
  addEventListener('message', (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.type !== 'gpt-handoff/source'
    )
      return;
    const packet = event.data.packet;
    if (packet?.kind === 'changed' || packet?.kind === 'unavailable')
      return handler.postMessage({ kind: packet.kind, page: String(packet.pageUrl) });
    if (packet?.kind !== 'response') return;
    try {
      handler.postMessage({ kind: 'ready', page: String(packet.pageUrl), ...compile(packet) });
    } catch (error) {
      handler.postMessage({
        kind: 'invalid',
        page: String(packet.pageUrl),
        message: error.message || 'This conversation could not be read.',
      });
    }
  });
