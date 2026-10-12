export async function connect() {
  const response = await fetch('/api/session', {
    headers: { 'X-Add-It-Client': 'desk' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('The local bridge is unavailable. Restart gpt-handoff.');
  const { token } = await response.json();
  return async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`/api${path}`, {
      method,
      headers: {
        'X-Add-It-Token': token,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(10000),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.message || result.error || 'The local bridge could not complete this step.',
      );
    return result;
  };
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== false)
      node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) node.append(child);
  return node;
}

export function icon(name = 'arrow') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ui-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute(
    'd',
    name === 'turn'
      ? 'M5 4v10h14m-5-5 5 5-5 5'
      : name === 'check'
        ? 'm5 12 4 4L19 6'
        : 'M6 18 18 6M6 6h12v12',
  );
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

export function formatSize(bytes) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(0)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function announce(node, message, kind = '') {
  node.textContent = message;
  node.className = `notice ${kind}`;
  node.hidden = !message;
}
