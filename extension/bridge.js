/** Self-contained isolated-world function. No transcript in URL, storage or network calls. */
export async function deliverToDesk(model, requestId, deadline, readyNonce) {
  const origin = 'http://127.0.0.1:43119';
  if (location.origin !== origin || location.pathname !== '/' || location.hash !== '#capture')
    throw new Error('The local desk changed. Open it and try again.');
  if (!/^[a-f0-9]{32}$/u.test(requestId) || deadline <= Date.now())
    throw new Error('The handoff expired. Capture the conversation again.');
  return new Promise((resolve) => {
    let delivered = false;
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearInterval(helloTimer);
      clearTimeout(expiryTimer);
      window.removeEventListener('message', receive);
      model = null;
      resolve(result);
    };
    const sendModel = (nonce) => {
      delivered = true;
      clearInterval(helloTimer);
      window.postMessage({ type: 'GH_SOURCE_MODEL', requestId, nonce, model }, origin);
      model = null;
    };
    const hello = () => {
      if (!delivered) window.postMessage({ type: 'GH_SOURCE_HELLO', requestId }, origin);
    };
    const receive = (event) => {
      if (event.source !== window || event.origin !== origin) return;
      const data = event.data;
      if (!data || data.requestId !== requestId) return;
      if (location.origin !== origin || location.pathname !== '/' || location.hash !== '#capture') {
        finish({ ok: false, error: 'The local desk changed. Try again.' });
        return;
      }
      if (data.type === 'GH_SOURCE_READY' && !delivered && /^[a-f0-9]{32}$/u.test(data.nonce)) {
        sendModel(data.nonce);
      } else if (data.type === 'GH_SOURCE_ACCEPTED' && delivered && typeof data.ok === 'boolean') {
        finish({
          ok: data.ok,
          error: data.ok
            ? undefined
            : 'The desk did not accept the conversation. Capture it again.',
        });
      }
    };
    window.addEventListener('message', receive);
    const helloTimer = setInterval(hello, 400);
    const expiryTimer = setTimeout(
      () =>
        finish({ ok: false, error: 'The desk did not respond. Start gpt-handoff and try again.' }),
      Math.max(1, Math.min(40_000, deadline - Date.now())),
    );
    if (/^[a-f0-9]{32}$/u.test(readyNonce)) sendModel(readyNonce);
    else hello();
  });
}

/** Readiness probe contains no conversation. Leave the action popup visible on failure. */
export async function probeDesk(requestId, deadline) {
  const origin = 'http://127.0.0.1:43119';
  if (location.href !== `${origin}/#capture`) return null;
  return new Promise((resolve) => {
    const finish = (nonce) => {
      window.removeEventListener('message', receive);
      clearInterval(interval);
      clearTimeout(timeout);
      resolve(nonce);
    };
    const receive = (event) => {
      if (
        event.source !== window ||
        event.origin !== origin ||
        location.href !== `${origin}/#capture`
      )
        return;
      const packet = event.data;
      if (
        packet?.type === 'GH_SOURCE_READY' &&
        packet.requestId === requestId &&
        /^[a-f0-9]{32}$/u.test(packet.nonce)
      )
        finish(packet.nonce);
    };
    const hello = () => window.postMessage({ type: 'GH_SOURCE_HELLO', requestId }, origin);
    window.addEventListener('message', receive);
    const interval = setInterval(hello, 200);
    const timeout = setTimeout(
      () => finish(null),
      Math.max(1, Math.min(4000, deadline - Date.now())),
    );
    hello();
  });
}
