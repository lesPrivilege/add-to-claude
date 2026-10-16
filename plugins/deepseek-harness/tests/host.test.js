import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  HelperProcess,
  electronCandidates,
  helperEnv,
  locateElectron,
} from '../host/helper-process.js';
import { apply, inject, name } from '../host/index.js';

/** A child process stand-in: records what the host sends; the test emits what the helper says. */
function fakeChild() {
  const child = new EventEmitter();
  child.sent = [];
  child.exitCode = null;
  child.send = (message) => child.sent.push(message);
  child.kill = () => child.emit('exit', null, 'SIGTERM');
  return child;
}

function helperWithFake() {
  const launches = [];
  const child = fakeChild();
  const helper = new HelperProcess({
    helperDir: '/pkg/helper/',
    logger: {},
    locate: () => '/electron',
    launch: (command, args, options) => (launches.push({ command, args, options }), child),
  });
  return { helper, child, launches };
}

test('Electron comes from the explicit path or dsh-pet’s landing folder, never a download', () => {
  assert.deepEqual(
    electronCandidates({
      env: { DSH_CHATGPT_PANEL_ELECTRON: '/x/Electron' },
      home: '/h',
      platform: 'darwin',
    }),
    ['/x/Electron', '/h/.dsh/electron/Electron.app/Contents/MacOS/Electron'],
  );
  assert.deepEqual(electronCandidates({ env: { DSH_HOME: '/d' }, home: '/h', platform: 'linux' }), [
    '/d/electron/electron',
  ]);
  assert.equal(
    locateElectron({ env: {}, home: '/h', platform: 'darwin' }, () => false),
    undefined,
  );
  const env = helperEnv({
    ELECTRON_RUN_AS_NODE: '1',
    NODE_OPTIONS: '-r x',
    NODE_PATH: '/x',
    A: 'b',
  });
  assert.deepEqual(env, { A: 'b' });
});

test('the helper channel is the inherited IPC pipe: no port, no socket, stdout unused', () => {
  const { helper, launches, child } = helperWithFake();
  helper.open();
  assert.equal(launches.length, 1);
  const [{ command, args, options }] = launches;
  assert.equal(command, '/electron');
  assert.deepEqual(args, ['/pkg/helper/']);
  assert.deepEqual(options.stdio, ['ignore', 'ignore', 'pipe', 'ipc']);
  assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.deepEqual(child.sent, [{ type: 'show' }]);
  helper.open();
  assert.equal(launches.length, 1, 'a running helper is reused');
});

test('a missing Electron reports why, and Open fails without spawning', () => {
  const helper = new HelperProcess({
    helperDir: '/pkg/helper/',
    locate: () => undefined,
    launch: () => assert.fail(),
  });
  assert.throws(() => helper.open(), /Electron was not found/);
  assert.equal(helper.status().helper, 'unavailable');
});

test('Open retries after a helper reported fatal and exited', () => {
  const { helper, launches, child } = helperWithFake();
  helper.open();
  child.emit('message', { type: 'fatal', reason: 'Another window is running.' });
  child.emit('exit', 0, null);
  assert.deepEqual(helper.status(), {
    helper: 'unavailable',
    reason: 'Another window is running.',
  });
  helper.open();
  assert.equal(launches.length, 2);
  assert.equal(helper.status().helper, 'running');
});

test('state from the helper is validated before the client sees it', () => {
  const { helper, child } = helperWithFake();
  assert.deepEqual(helper.status(), { helper: 'stopped' });
  helper.open();
  child.emit('message', {
    type: 'state',
    visible: true,
    source: 'ready',
    conversation: {
      title: 'T',
      turns: 2,
      files: 0,
      saved: 0,
      verification: 'verified',
      issues: [],
      markdown: 'no',
    },
  });
  const status = helper.status();
  assert.equal(status.helper, 'running');
  assert.equal(status.visible, true);
  assert.equal(status.conversation.title, 'T');
  assert.equal('markdown' in status.conversation, false);
  child.emit('message', { type: 'state', source: 'ready', conversation: 'x' });
  assert.equal(helper.status().source, 'waiting');
});

test('Add waits for its own reply; malformed or foreign replies are ignored; exit rejects', async () => {
  const { helper, child } = helperWithFake();
  helper.open();
  const first = helper.add(true);
  const { id, downloadFiles } = child.sent.at(-1);
  assert.equal(downloadFiles, true);
  child.emit('message', { type: 'reply', id: id + 100, ok: true, markdown: 'other' });
  child.emit('message', { type: 'reply', id: String(id), ok: true, markdown: 'bad id' });
  child.emit('message', { type: 'reply', id, ok: true, markdown: '# T\n', note: 'n' });
  assert.deepEqual(await first, { markdown: '# T\n', note: 'n' });

  const second = helper.add(false);
  child.emit('message', { type: 'reply', id: child.sent.at(-1).id, ok: false, error: 'nope' });
  await assert.rejects(second, /nope/);

  const third = helper.add(false);
  child.emit('exit', 0, null);
  await assert.rejects(third, /closed/);
  assert.deepEqual(helper.status(), { helper: 'stopped' });
  await assert.rejects(helper.add(false), /closed/);
});

/** The host's Cordis surface with Connection's exact-route registry stubbed. */
function host() {
  const routes = new Map();
  const disposers = [];
  const ctx = {
    logger: {},
    effect: (fn) => disposers.push(fn()),
    connection: {
      fetch: {
        register: (route) => {
          routes.set(route.path, route);
          return async () => routes.delete(route.path);
        },
      },
    },
  };
  apply(ctx);
  const call = (path, method = 'GET', body, type = 'application/json') =>
    routes.get(path).fetch(
      new Request(`http://127.0.0.1/${path.slice(1)}`, {
        method,
        ...(body === undefined ? {} : { body, headers: { 'content-type': type } }),
      }),
    );
  return { routes, call, dispose: () => disposers.forEach((fn) => fn?.()) };
}

test('every host route sits on Connection’s authenticated /api channel and nowhere else', () => {
  assert.equal(name, 'dsh-chatgpt-panel');
  assert.deepEqual(inject, ['connection']);
  const { routes, dispose } = host();
  assert.deepEqual([...routes.keys()].sort(), [
    '/api/chatgpt-panel.add',
    '/api/chatgpt-panel.open',
    '/api/chatgpt-panel.pin',
    '/api/chatgpt-panel.state',
  ]);
  for (const route of routes.values()) {
    assert.equal(route.requestBody, 'buffered');
    assert.match(route.path, /^\/api\/[A-Za-z0-9_$.-]+$/u);
  }
  assert.deepEqual(routes.get('/api/chatgpt-panel.state').methods, ['GET']);
  dispose();
});

test('host routes refuse bodies that are not small JSON, and report a closed window', async () => {
  const { call, dispose } = host();
  const state = await call('/api/chatgpt-panel.state');
  assert.equal(state.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await state.json(), { helper: 'stopped' });
  assert.equal((await call('/api/chatgpt-panel.open', 'POST', 'x', 'text/plain')).status, 415);
  assert.equal((await call('/api/chatgpt-panel.add', 'POST', '[1]')).status, 400);
  assert.equal(
    (await call('/api/chatgpt-panel.add', 'POST', JSON.stringify({ pad: 'x'.repeat(2000) })))
      .status,
    400,
  );
  const closed = await call('/api/chatgpt-panel.add', 'POST', '{}');
  assert.equal(closed.status, 409);
  assert.match((await closed.json()).error, /closed/);
  assert.equal((await call('/api/chatgpt-panel.pin', 'POST', '{"on":true}')).status, 409);
  dispose();
});
