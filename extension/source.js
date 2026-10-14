// Isolated-world bridge for one ChatGPT document. Keeps only the latest observed response in memory.
(() => {
  if (window !== top) return;
  let latest = null;
  const forward = (packet) =>
    void chrome.runtime.sendMessage({ type: 'source', packet }).catch(() => {});
  addEventListener('message', (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.type !== 'gpt-handoff/source'
    )
      return;
    const packet = event.data.packet;
    if (!packet || !['changed', 'response', 'unavailable'].includes(packet.kind)) return;
    latest = packet.kind === 'response' ? packet : null;
    forward(packet);
  });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    if (message?.type === 'replay') reply({ packet: latest, href: location.href });
    if (message?.type === 'where') reply({ href: location.href });
    return false;
  });
})();
