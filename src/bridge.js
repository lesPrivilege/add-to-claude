import { compile, compileModel, handoff } from './compile.js';

// Runs in the app's own WebKit content world. The page shares the DOM but cannot see this code or
// the native handler. The observer hands over one private port at document start, before any page
// script runs; only packets on that port are compiled, and only the result is passed on.
const handler = globalThis.webkit?.messageHandlers?.handoff;
if (handler && window === top) {
  const adopt = (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.type !== 'add-to-claude/port' ||
      !event.ports?.[0]
    )
      return;
    removeEventListener('message', adopt);
    const port = event.ports[0];
    // The app asks, from this isolated world only, for links to the files it is about to download.
    globalThis.addToClaudeResolve = (files) =>
      port.postMessage({
        kind: 'resolve',
        files: (Array.isArray(files) ? files : []).map((file) => ({
          id: String(file?.id ?? ''),
          messageId: String(file?.messageId ?? ''),
        })),
      });
    // The last conversation compiled, kept in this world only, so the app can ask for some of its
    // turns. The app names each turn with the hash it was shown; if the page has since changed any of
    // them, or shows another conversation, nothing is projected.
    let last = null;
    globalThis.addToClaudeProject = (page, turns, note) => {
      if (
        typeof page !== 'string' ||
        !Array.isArray(turns) ||
        !turns.length ||
        turns.length > 5000 ||
        turns.some(
          (turn) =>
            typeof turn?.id !== 'string' ||
            turn.id.length > 512 ||
            typeof turn.sha256 !== 'string' ||
            !/^[a-f0-9]{64}$/u.test(turn.sha256),
        ) ||
        typeof note !== 'string' ||
        note.length > 64
      )
        return { error: 'Invalid choice of turns.' };
      const current = new Map(last?.turnList.map((turn) => [turn.id, turn.sha256]) ?? []);
      if (!last || last.page !== page || turns.some((turn) => current.get(turn.id) !== turn.sha256))
        return { error: 'The conversation changed.' };
      try {
        return handoff(last.model, { turnIds: turns.map((turn) => turn.id), note });
      } catch (error) {
        return { error: error.message || 'These turns could not be prepared.' };
      }
    };
    port.onmessage = ({ data: packet }) => {
      if (packet?.kind === 'file')
        return handler.postMessage({
          kind: 'file',
          page: String(packet.pageUrl),
          id: String(packet.id),
          messageId: String(packet.messageId ?? ''),
          url: String(packet.url),
          name: String(packet.name),
        });
      if (packet?.kind === 'file-missing')
        return handler.postMessage({
          kind: 'file-missing',
          page: String(packet.pageUrl),
          id: String(packet.id),
          messageId: String(packet.messageId ?? ''),
          status: String(packet.status),
        });
      if (
        packet?.kind === 'changed' ||
        packet?.kind === 'unavailable' ||
        packet?.kind === 'replying'
      )
        return handler.postMessage({ kind: packet.kind, page: String(packet.pageUrl) });
      if (packet?.kind !== 'response') return;
      try {
        const model = compileModel(packet);
        const result = compile(packet, model);
        last = { page: String(packet.pageUrl), model, turnList: result.turnList };
        handler.postMessage({ kind: 'ready', page: String(packet.pageUrl), ...result });
      } catch (error) {
        last = null;
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
