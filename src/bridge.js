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
    const port = event.ports[0];
    // The app asks, from this isolated world only, for links to the files it is about to download.
    globalThis.ferryResolve = (files) =>
      port.postMessage({
        kind: 'resolve',
        files: (Array.isArray(files) ? files : []).map((file) => ({
          id: String(file?.id ?? ''),
          messageId: String(file?.messageId ?? ''),
        })),
      });
    port.onmessage = ({ data: packet }) => {
      if (packet?.kind === 'trace')
        return handler.postMessage({
          kind: 'trace',
          page: String(packet.pageUrl),
          method: String(packet.method),
          path: String(packet.path),
        });
      if (packet?.kind === 'file')
        return handler.postMessage({
          kind: 'file',
          page: String(packet.pageUrl),
          id: String(packet.id),
          url: String(packet.url),
          name: String(packet.name),
        });
      if (packet?.kind === 'file-missing')
        return handler.postMessage({
          kind: 'file-missing',
          page: String(packet.pageUrl),
          id: String(packet.id),
          status: String(packet.status),
        });
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
