import http from 'node:http';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { BridgeError, createBridge, fail, LIMITS } from './bridge.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const STATIC = new Map([
  ['/', ['web/index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['web/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['web/app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['web/style.css', 'text/css; charset=utf-8']],
  ['/composer.html', ['web/composer.html', 'text/html; charset=utf-8']],
  ['/composer.js', ['web/composer.js', 'text/javascript; charset=utf-8']],
  ['/common.js', ['web/common.js', 'text/javascript; charset=utf-8']],
  ['/browser-source.js', ['web/browser-source.js', 'text/javascript; charset=utf-8']],
  ['/native-core.html', ['web/native-core.html', 'text/html; charset=utf-8']],
  ['/native-core.js', ['web/native-core.js', 'text/javascript; charset=utf-8']],
  ['/src/chatgpt-response.js', ['src/chatgpt-response.js', 'text/javascript; charset=utf-8']],
  ['/targets.json', ['web/targets.json', 'application/json; charset=utf-8']],
  ['/src/model.js', ['src/model.js', 'text/javascript; charset=utf-8']],
  ['/src/message-visibility.js', ['src/message-visibility.js', 'text/javascript; charset=utf-8']],
  ['/src/import.js', ['src/import.js', 'text/javascript; charset=utf-8']],
]);
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

async function readJSON(request) {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')
  ) {
    fail(415, 'json_required', 'Send application/json.');
  }
  const length = request.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > LIMITS.jsonBytes)) {
    fail(413, 'body_too_large', 'Use a request no larger than 16 MiB.');
  }
  const chunks = await new Promise((resolve, reject) => {
    let size = 0;
    let finished = false;
    const parts = [];
    request.on('data', (chunk) => {
      if (finished) return;
      size += chunk.length;
      if (size > LIMITS.jsonBytes) {
        finished = true;
        parts.length = 0;
        reject(new BridgeError(413, 'body_too_large', 'Use a request no larger than 16 MiB.'));
      } else parts.push(chunk);
    });
    request.once('end', () => {
      if (!finished) {
        finished = true;
        resolve(parts);
      }
    });
    request.once('error', () => {
      if (!finished) {
        finished = true;
        reject(new BridgeError(400, 'incomplete_body', 'Retry the complete request.'));
      }
    });
    request.once('aborted', () => {
      if (!finished) {
        finished = true;
        reject(new BridgeError(400, 'incomplete_body', 'Retry the complete request.'));
      }
    });
  });
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return JSON.parse(decoder.decode(Buffer.concat(chunks)));
  } catch {
    fail(400, 'invalid_json', 'Send valid UTF-8 JSON.');
  }
}

function tokenMatches(actual, expected) {
  return (
    typeof actual === 'string' &&
    /^[a-f0-9]{64}$/.test(actual) &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}

/** Starts the loopback-only UI/bridge. No API supports send/execute or disk transcript storage.
 * Browser session: GET /api/session + X-Add-It-Client: desk; subsequent requests use
 * X-Add-It-Token. Writes also require the exact runtime Origin returned by this function.
 */
export async function startServer({
  port = Number(process.env.PORT || 43119),
  root = ROOT,
  nativeInstance = process.env.ADD_IT_NATIVE_INSTANCE,
  bridge = createBridge(),
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('PORT must be an integer from 0 to 65535.');
  const token = randomBytes(32).toString('hex');
  let origin;
  let host;
  const server = http.createServer(async (request, response) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
    const send = (status, value, type = 'application/json; charset=utf-8') => {
      response.statusCode = status;
      response.setHeader('Content-Type', type);
      response.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
    };
    try {
      if (request.headers.host !== host || request.headersDistinct.host?.length !== 1)
        fail(403, 'invalid_host', 'Open this utility using its loopback address.');
      if (request.headers.origin !== undefined && request.headers.origin !== origin) {
        fail(403, 'invalid_origin', 'Open this utility directly to continue.');
      }
      const fetchSite = request.headers['sec-fetch-site'];
      if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
        fail(403, 'cross_site_request', 'Open this utility directly to continue.');
      }
      const rawPath = (request.url || '').split('?')[0];
      if (
        !rawPath.startsWith('/') ||
        rawPath.startsWith('//') ||
        rawPath.includes('%') ||
        rawPath.includes('\\') ||
        rawPath.split('/').some((part) => part === '.' || part === '..')
      ) {
        fail(404, 'not_found', 'This resource is not available.');
      }
      const url = new URL(request.url, origin);
      if (url.origin !== origin)
        fail(403, 'invalid_origin', 'Open this utility directly to continue.');
      if (rawPath === '/health' && request.method === 'GET') {
        send(200, {
          app: 'gpt-handoff',
          protocol: 1,
          ...(nativeInstance ? { nativeInstance } : {}),
        });
        return;
      }
      if (rawPath.startsWith('/api/')) {
        if (rawPath === '/api/session' && request.method === 'GET') {
          if (
            request.headers['x-add-it-client'] !== 'desk' ||
            (fetchSite && fetchSite !== 'same-origin')
          ) {
            fail(403, 'invalid_client', 'Reload the utility to reconnect.');
          }
          send(200, { token });
          return;
        }
        if (!tokenMatches(request.headers['x-add-it-token'], token)) {
          fail(403, 'invalid_token', 'Reload the utility to reconnect.');
        }
        if (fetchSite && fetchSite !== 'same-origin')
          fail(403, 'cross_site_request', 'Reload the utility to reconnect.');
        if (request.method !== 'GET' && request.headers.origin !== origin) {
          fail(403, 'origin_required', 'Open this utility directly before making changes.');
        }
        let match;
        if (rawPath === '/api/targets' && request.method === 'GET') send(200, bridge.targets());
        else if (rawPath === '/api/composers' && request.method === 'POST')
          send(200, bridge.register(await readJSON(request)));
        else if (rawPath === '/api/transfers' && request.method === 'POST')
          send(201, bridge.stage(await readJSON(request)));
        else if (
          (match = rawPath.match(/^\/api\/composers\/([a-zA-Z0-9_-]+)\/pending$/)) &&
          request.method === 'GET'
        ) {
          send(200, bridge.pending(match[1], url.searchParams.get('instance')));
        } else if (
          (match = rawPath.match(/^\/api\/transfers\/([a-zA-Z0-9_-]+)\/claim$/)) &&
          request.method === 'POST'
        ) {
          send(200, bridge.claim(match[1], await readJSON(request)));
        } else if (
          (match = rawPath.match(/^\/api\/transfers\/([a-zA-Z0-9_-]+)\/ack$/)) &&
          request.method === 'POST'
        ) {
          send(200, bridge.ack(match[1], await readJSON(request)));
        } else if (
          (match = rawPath.match(/^\/api\/transfers\/([a-zA-Z0-9_-]+)$/)) &&
          request.method === 'GET'
        ) {
          send(200, bridge.status(match[1]));
        } else if (match && request.method === 'DELETE') send(200, bridge.cancel(match[1]));
        else fail(404, 'not_found', 'This action is not available.');
        return;
      }
      const resource = STATIC.get(rawPath);
      if (!resource || (request.method !== 'GET' && request.method !== 'HEAD'))
        fail(404, 'not_found', 'This resource is not available.');
      let content;
      try {
        content = await readFile(path.join(root, resource[0]));
      } catch (error) {
        if (error.code === 'ENOENT') fail(404, 'not_found', 'This resource is not available.');
        throw error;
      }
      response.statusCode = 200;
      response.setHeader('Content-Type', resource[1]);
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;
      const known = error instanceof BridgeError;
      // No exception text, request body, token, filename, or transcript enters logs or errors.
      if (request.method !== 'GET' && request.method !== 'HEAD' && !request.complete) {
        response.setHeader('Connection', 'close');
        request.resume();
      }
      send(known ? error.status : 500, {
        error: known ? error.code : 'internal_error',
        message: known
          ? error.message
          : 'The local bridge could not complete this action. Retry or restart it.',
      });
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 20_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 40;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  host = `127.0.0.1:${server.address().port}`;
  origin = `http://${host}`;
  const timer = setInterval(() => bridge.prune(), 1000);
  timer.unref();
  const close = async () => {
    clearInterval(timer);
    bridge.close();
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };
  server.once('close', () => {
    clearInterval(timer);
    bridge.close();
  });
  return { server, origin, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer()
    .then(({ origin, close }) => {
      process.stdout.write(`gpt-handoff is ready at ${origin}\n`);
      let stopping = false;
      const stop = () => {
        if (stopping) return;
        stopping = true;
        close().then(
          () => process.exit(0),
          () => process.exit(1),
        );
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    })
    .catch(() => {
      process.stderr.write('The local bridge could not start. Check that its port is available.\n');
      process.exitCode = 1;
    });
}
