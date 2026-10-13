/** Installed only in the app's visible ChatGPT webview. Never makes a network request. */
export function installEmbeddedSourceObserver({ maxBytes = 64 * 1024 * 1024 } = {}) {
  const channel = window.webkit?.messageHandlers?.handoffSource;
  if (!channel) return;
  let generation = 0;
  const identify = () => {
    const url = new URL(location.href);
    const id = /^\/(?:g\/[A-Za-z0-9_-]+\/)?c\/([A-Za-z0-9_-]+)\/?$/u.exec(url.pathname)?.[1];
    if (
      url.protocol !== 'https:' ||
      !['chatgpt.com', 'chat.openai.com'].includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      !id
    )
      return null;
    return {
      pageUrl: url.origin + url.pathname,
      responseUrl: `${url.origin}/backend-api/conversation/${id}`,
    };
  };
  const post = (value) => {
    try {
      channel.postMessage(value);
    } catch {}
  };
  const clear = () => {
    generation++;
    post({ kind: 'changed', pageUrl: location.href });
  };
  const fetchOriginal = window.fetch;
  window.fetch = function (...args) {
    const promise = Reflect.apply(fetchOriginal, this, args);
    let requested;
    try {
      requested = new URL(
        typeof args[0] === 'string' || args[0] instanceof URL ? args[0] : args[0].url,
        location.href,
      );
    } catch {
      return promise;
    }
    const method = String(args[1]?.method ?? args[0]?.method ?? 'GET').toUpperCase();
    // A newly sent/regenerated answer invalidates a previous snapshot immediately.
    if (
      requested.origin === location.origin &&
      requested.pathname === '/backend-api/conversation' &&
      method !== 'GET'
    )
      clear();
    if (method !== 'GET') return promise;
    // Every newer selected response supersedes readers still finishing the previous one.
    // This also disables Add while the site's own refresh/branch change is in flight.
    if (requested.href === identify()?.responseUrl) clear();
    const started = generation;
    void promise
      .then(async (response) => {
        const selected = identify();
        if (
          !selected ||
          started !== generation ||
          requested.href !== selected.responseUrl ||
          response.url !== selected.responseUrl ||
          response.status !== 200
        )
          return;
        const reader = response.clone().body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder('utf-8', { fatal: true });
        const parts = [];
        let bytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (started !== generation || identify()?.pageUrl !== selected.pageUrl) {
              void reader.cancel();
              return;
            }
            if (done) break;
            bytes += value.byteLength;
            if (bytes > maxBytes) {
              void reader.cancel();
              throw new Error('size');
            }
            parts.push(decoder.decode(value, { stream: true }));
          }
          parts.push(decoder.decode());
          post({
            kind: 'response',
            ...selected,
            body: parts.join(''),
            capturedAt: new Date().toISOString(),
          });
        } catch {
          if (started === generation && identify()?.pageUrl === selected.pageUrl)
            post({ kind: 'unavailable', pageUrl: selected.pageUrl });
        } finally {
          reader.releaseLock();
        }
      })
      .catch(() => {});
    return promise;
  };
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name];
    history[name] = function (...args) {
      const before = location.href;
      const result = Reflect.apply(original, this, args);
      if (location.href !== before) clear();
      return result;
    };
  }
  addEventListener('popstate', clear);
  addEventListener('pagehide', clear);
}
