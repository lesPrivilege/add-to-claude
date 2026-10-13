/** One native connection owns one target registry. Source permits are operation-bound and never retried. */
export function createNativeConnection({ chromeApi, revalidate, disconnected }) {
  let port = null;
  const pending = new Map();
  function close(opened) {
    if (port !== opened) return;
    port = null;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(
        new Error(
          request.command === 'append'
            ? 'Native connection closed. Inspect the target draft before retrying.'
            : 'Native helper unavailable. Complete Handoff setup, then try again.',
        ),
      );
    }
    pending.clear();
    disconnected();
    try {
      opened.disconnect();
    } catch {}
  }
  function connect() {
    if (port) return port;
    const opened = chromeApi.runtime.connectNative('io.lesprivilege.gpt_handoff');
    port = opened;
    opened.onMessage.addListener((message) => {
      if (port !== opened) return;
      if (message?.event === 'source-check') {
        void revalidate(message)
          .then((current) => {
            if (port === opened)
              opened.postMessage({
                command: 'source-permit',
                operationId: message.operationId,
                ticket: message.ticket,
                revision: message.revision,
                hash: message.hash,
                current: current === true,
              });
          })
          .catch(() => {
            if (port === opened)
              opened.postMessage({
                command: 'source-permit',
                operationId: message.operationId,
                ticket: message.ticket,
                revision: message.revision,
                hash: message.hash,
                current: false,
              });
          });
        return;
      }
      const request = pending.get(message?.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(message.id);
      request.resolve(message);
    });
    opened.onDisconnect.addListener(() => {
      // Consume Chrome's error without logging paths or source data.
      void chromeApi.runtime.lastError;
      close(opened);
    });
    return opened;
  }
  function request(command, values = {}, id = crypto.randomUUID()) {
    if (pending.size >= 8 || pending.has(id))
      return Promise.reject(new Error('Finish the current native action first.'));
    return new Promise((resolve, reject) => {
      try {
        const active = connect();
        const packet = { ...values, id, command };
        if (new TextEncoder().encode(JSON.stringify(packet)).byteLength > 4 * 1024 * 1024)
          throw new Error('This context needs a file; it exceeds the native transport limit.');
        const timer = setTimeout(() => {
          pending.delete(id);
          close(active);
          reject(new Error('Native action timed out. Inspect the draft before retrying.'));
        }, 20000);
        pending.set(id, { resolve, reject, timer, command });
        active.postMessage(packet);
      } catch (error) {
        const previous = pending.get(id);
        if (previous) clearTimeout(previous.timer);
        pending.delete(id);
        reject(error);
      }
    });
  }
  return {
    request,
    disconnect() {
      if (port) close(port);
    },
  };
}
