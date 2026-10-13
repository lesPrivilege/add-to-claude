/** A bounded incremental SSE decoder. It does not fetch, reconnect, or retain a history. */
export function createEventStreamDecoder({ onEvent, maxEventBytes = 8 * 1024 * 1024 }) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoder = new TextEncoder();
  let buffer = '',
    scan = 0,
    data = [],
    event = '',
    bytes = 0,
    ended = false;
  const line = (value) => {
    bytes += encoder.encode(value).byteLength + 1;
    if (bytes > maxEventBytes)
      throw new RangeError('A source stream event exceeds the supported size.');
    if (value === '') {
      if (data.length) onEvent({ event: event || 'message', data: data.join('\n') });
      data = [];
      event = '';
      bytes = 0;
      return;
    }
    if (value.startsWith(':')) return;
    const separator = value.indexOf(':');
    const field = separator < 0 ? value : value.slice(0, separator);
    let content = separator < 0 ? '' : value.slice(separator + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (field === 'data') data.push(content);
    else if (field === 'event') event = content;
  };
  const consume = (text, final = false) => {
    buffer += text;
    let start = 0;
    for (; scan < buffer.length; scan++) {
      const char = buffer[scan];
      if (char !== '\n' && char !== '\r') continue;
      if (char === '\r' && scan === buffer.length - 1 && !final) break;
      line(buffer.slice(start, scan));
      if (char === '\r' && buffer[scan + 1] === '\n') scan++;
      start = scan + 1;
    }
    buffer = buffer.slice(start);
    scan -= start;
    if (bytes + encoder.encode(buffer).byteLength > maxEventBytes)
      throw new RangeError('A source stream event exceeds the supported size.');
  };
  return {
    push(chunk) {
      if (ended) throw new Error('The source stream has already ended.');
      consume(decoder.decode(chunk, { stream: true }));
    },
    finish() {
      if (ended) return;
      ended = true;
      consume(decoder.decode(), true);
      if (buffer) line(buffer);
      buffer = '';
      if (data.length) throw new Error('The source stream ended in an incomplete event.');
    },
  };
}
