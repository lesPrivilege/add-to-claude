import { compile } from './compile.js';

// Runs in the app's own WebKit content world. The page shares the DOM but cannot see this code or
// the native handler. The observer hands over one private port at document start, before any page
// script runs; only packets on that port are compiled, and only the result is passed on.
const handler = globalThis.webkit?.messageHandlers?.handoff;
if (handler && window === top) {
  const adopt = (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.type !== 'gpt-handoff/port' ||
      !event.ports?.[0]
    )
      return;
    removeEventListener('message', adopt);
    event.ports[0].onmessage = ({ data: packet }) => {
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
    };
  };
  addEventListener('message', adopt);
}
