// The DeepSeek Harness host half (a Cordis plugin): it runs the ChatGPT helper window and answers
// the client half over exact Fetch routes on the harness's shared `/api` channel. Connection
// (`@deepseek-ai/dsh-client-connection`) applies its Host/Origin checks and browser-session
// authentication to every `/api` request before these handlers run; Desktop forwards the
// application window's requests to the Host with that session cookie.
import { fileURLToPath } from 'node:url';
import { HelperProcess } from './helper-process.js';
import { addRequest, fitsComposer, pinRequest } from '../shared/protocol.js';

export const name = 'dsh-chatgpt-panel';
export const inject = ['connection'];

const helperDir = fileURLToPath(new URL('../helper/', import.meta.url));
const json = (value, status = 200) =>
  Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const refuse = (status, error) => json({ ok: false, error }, status);

/** Reads a small JSON body; anything but `application/json` is refused before it is read. */
async function body(request) {
  const type = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (type !== 'application/json') return null;
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 1024) return null;
  const text = await request.text();
  return text.length > 1024 ? null : text;
}

export function apply(ctx) {
  // Only start-up failures are logged; nothing from the conversation is.
  const helper = new HelperProcess({ helperDir, logger: { warn: (line) => console.warn(line) } });
  ctx.effect(() => () => helper.dispose(), 'dsh-chatgpt-panel: helper');

  const route = (path, methods, fetch) =>
    ctx.connection.fetch.register({ path, methods, requestBody: 'buffered', fetch });

  route('/api/chatgpt-panel.state', ['GET'], async () => json(helper.status()));

  route('/api/chatgpt-panel.open', ['POST'], async (request) => {
    if ((await body(request)) === null) return refuse(415, 'Expected a JSON body.');
    try {
      helper.open();
      return json({ ok: true });
    } catch (error) {
      return refuse(503, error.message);
    }
  });

  route('/api/chatgpt-panel.pin', ['POST'], async (request) => {
    const pin = pinRequest(await body(request));
    if (!pin) return refuse(400, 'Expected { "on": true | false }.');
    try {
      helper.pin(pin.on);
      return json({ ok: true });
    } catch (error) {
      return refuse(409, error.message);
    }
  });

  route('/api/chatgpt-panel.add', ['POST'], async (request) => {
    const add = addRequest(await body(request));
    if (!add) return refuse(400, 'Expected { "downloadFiles": true | false }.');
    try {
      const { markdown, note } = await helper.add(add.downloadFiles);
      if (!fitsComposer(markdown))
        return refuse(413, 'This conversation is larger than 2 MiB, too large for the composer.');
      return json({ ok: true, markdown, note });
    } catch (error) {
      return refuse(409, error.message);
    }
  });
}
