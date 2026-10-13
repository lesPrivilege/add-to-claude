import { validateConversation } from '/src/model.js';

const HEX = /^[a-f0-9]{32}$/;
const MAX_BYTES = 8 * 1024 * 1024;

/** One explicit source handoff from the extension's isolated script.
 * No API capability, destination identity, or transfer action crosses this boundary.
 */
export function receiveBrowserSource(adopt, rejected = () => {}) {
  const origin = location.origin;
  const pending = new Map();
  const reply = (message) => window.postMessage(message, origin);
  const random = () =>
    [...crypto.getRandomValues(new Uint8Array(16))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  const listener = async (event) => {
    if (event.source !== window || event.origin !== origin) return;
    const packet = event.data;
    if (!packet || !HEX.test(packet.requestId)) return;
    if (packet.type === 'GH_SOURCE_HELLO') {
      for (const [id, entry] of pending) if (entry.expires <= Date.now()) pending.delete(id);
      if (pending.has(packet.requestId) || pending.size >= 4) return;
      const nonce = random();
      pending.set(packet.requestId, { nonce, expires: Date.now() + 35_000 });
      reply({ type: 'GH_SOURCE_READY', requestId: packet.requestId, nonce });
      return;
    }
    if (packet.type !== 'GH_SOURCE_MODEL') return;
    const entry = pending.get(packet.requestId);
    if (!entry || packet.nonce !== entry.nonce || entry.expires <= Date.now()) return;
    pending.delete(packet.requestId);
    try {
      if (new TextEncoder().encode(JSON.stringify(packet.model)).length > MAX_BYTES)
        throw new Error('This snapshot is too large. Use a selected export instead.');
      const model = validateConversation(packet.model);
      const url = new URL(model.source.url);
      if (
        !['dom-snapshot', 'chatgpt-response'].includes(model.source.type) ||
        url.protocol !== 'https:' ||
        !['chatgpt.com', 'chat.openai.com'].includes(url.hostname) ||
        url.port ||
        url.username ||
        url.password ||
        !/^\/(?:c\/[^/]+|share\/[^/]+|g\/[^/]+\/c\/[^/]+)\/?$/.test(url.pathname)
      )
        throw new Error('Choose a ChatGPT conversation tab, then try again.');
      const result = await adopt(model, entry.expires);
      if (result === 'kept' || result === 'expired') {
        rejected(result);
        reply({
          type: 'GH_SOURCE_ACCEPTED',
          requestId: packet.requestId,
          ok: false,
          error:
            result === 'kept'
              ? 'Kept existing source. Nothing changed.'
              : 'This handoff expired. Capture the conversation again.',
        });
        return;
      }
      reply({ type: 'GH_SOURCE_ACCEPTED', requestId: packet.requestId, ok: true });
    } catch {
      // Validation errors may contain source data. Return only a fixed actionable message.
      rejected('failed');
      reply({
        type: 'GH_SOURCE_ACCEPTED',
        requestId: packet.requestId,
        ok: false,
        error:
          'The desk did not accept this source. Finish the current action, check the selected chat, then retry.',
      });
    }
  };
  window.addEventListener('message', listener);
  return () => {
    pending.clear();
    window.removeEventListener('message', listener);
  };
}
