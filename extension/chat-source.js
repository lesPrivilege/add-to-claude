// Dormant until the worker authorizes this exact selected top-level tab/document.
(() => {
  if (window !== top || globalThis.__handoffChromeBridge) return;
  globalThis.__handoffChromeBridge = true;
  let active = false;
  let latest = null;
  const control = (enabled) => {
    active = enabled;
    if (!enabled) latest = null;
    window.postMessage({ type: 'GH_CHROME_SOURCE-control', active: enabled }, location.origin);
  };
  addEventListener('message', (event) => {
    if (
      !active ||
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.type !== 'GH_CHROME_SOURCE'
    )
      return;
    const packet = event.data.packet;
    if (!packet || !['changed', 'response', 'unavailable'].includes(packet.kind)) return;
    try {
      if (new TextEncoder().encode(JSON.stringify(packet)).byteLength > 16 * 1024 * 1024)
        throw new Error('size');
      latest = packet.kind === 'response' ? packet : null;
      void chrome.runtime.sendMessage({ type: 'chatSource', packet }).catch(() => {
        control(false);
      });
    } catch {
      latest = null;
      void chrome.runtime
        .sendMessage({
          type: 'chatSource',
          packet: { kind: 'unavailable', pageUrl: location.href },
        })
        .catch(() => {});
    }
  });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    if (message.type === 'chatStop') {
      control(false);
      reply({ stopped: true });
    }
    if (message.type === 'chatStart') {
      control(true);
      reply({ started: true });
    }
    if (message.type === 'chatReplay') reply({ packet: active ? latest : null });
    return false;
  });
  void chrome.runtime
    .sendMessage({ type: 'chatHello' })
    .then((result) => {
      if (result?.allowed) control(true);
    })
    .catch(() => {});
})();
