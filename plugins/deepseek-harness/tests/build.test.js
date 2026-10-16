import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { client, preload } from '../build.js';
import { compile } from '../../../src/compile.js';
import { packet, plainBody } from './fixtures.js';

/**
 * Runs the built preload as Electron's sandboxed preload would, with `require('electron')` and the
 * window stubbed: what the bridge sends over IPC, and what goes to the page's main world.
 */
function runPreload(source, { hostname = 'chatgpt.com', frame = 'top' } = {}) {
  const sent = [];
  const ipcListeners = new Map();
  const mainWorld = [];
  const listeners = new Set();
  const electron = {
    ipcRenderer: {
      send: (channel, message) => sent.push([channel, message]),
      on: (channel, fn) => ipcListeners.set(channel, fn),
    },
    contextBridge: { executeInMainWorld: (script) => mainWorld.push(script) },
  };
  const context = vm.createContext({ TextEncoder, URL, console });
  context.require = (id) => (id === 'electron' ? electron : assert.fail(`require(${id})`));
  context.addEventListener = (type, fn) => type === 'message' && listeners.add(fn);
  context.removeEventListener = (_type, fn) => listeners.delete(fn);
  context.location = { protocol: 'https:', hostname, origin: `https://${hostname}` };
  vm.runInContext(
    `globalThis.window = globalThis; globalThis.top = ${frame === 'top' ? 'globalThis' : '{}'};`,
    context,
  );
  vm.runInContext(source, context);
  const self = vm.runInContext('window', context);
  const port = {};
  const offer = () =>
    [...listeners].forEach((fn) =>
      fn({
        source: self,
        origin: `https://${hostname}`,
        data: { type: 'add-to-claude/port' },
        ports: [port],
      }),
    );
  return { sent, ipcListeners, mainWorld, offer, port, context };
}

test('the preload compiles the observer’s packets with the shared compiler and sends them over IPC', async () => {
  const run = runPreload(await preload());
  assert.equal(run.mainWorld.length, 1, 'the observer is handed to the main world once');
  assert.equal(typeof run.mainWorld[0].func, 'function');
  assert.match(run.mainWorld[0].func.toString(), /add-to-claude\.passive-observer/u);
  assert.equal(
    vm.runInContext('typeof webkit', run.context),
    'undefined',
    'the stand-in is removed',
  );
  run.offer();
  const input = packet(plainBody, 'one');
  run.port.onmessage({ data: input });
  assert.equal(run.sent.length, 1);
  const [channel, message] = run.sent[0];
  assert.equal(channel, 'add-to-claude:handoff');
  const { kind, page, ...rest } = message;
  assert.equal(kind, 'ready');
  assert.equal(page, input.pageUrl);
  assert.deepEqual(JSON.parse(JSON.stringify(rest)), compile(input));
});

test('the preload forwards file-link requests to the observer’s port only', async () => {
  const run = runPreload(await preload());
  run.offer();
  const posted = [];
  run.port.postMessage = (message) => posted.push(message);
  run.ipcListeners.get('add-to-claude:resolve')({}, [{ id: 'file-1', messageId: 'm', extra: 1 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [
    { kind: 'resolve', files: [{ id: 'file-1', messageId: 'm' }] },
  ]);
});

test('the preload does nothing on sign-in hosts or in subframes', async () => {
  for (const options of [{ hostname: 'auth.openai.com' }, { frame: 'child' }]) {
    const run = runPreload(await preload(), options);
    assert.equal(run.mainWorld.length, 0);
    assert.equal(run.ipcListeners.size, 0);
  }
});

test('the client bundle registers a lazy factory with a right-sidebar tab and its body', async () => {
  const loaded = [];
  const context = vm.createContext({
    window: { __ModuleLoader__: { load: (row) => loaded.push(row) } },
  });
  vm.runInContext(await client(), context);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'dsh-chatgpt-panel');
  const requested = [];
  const exports = loaded[0].factory((id) => {
    requested.push(id);
    return {
      createElement: () => null,
      useEffect() {},
      useRef: () => ({}),
      useState: (v) => [v, () => {}],
    };
  });
  assert.deepEqual(requested, ['react'], 'React comes from the host; nothing else is required');
  assert.equal(exports.name, 'chatgpt-panel');
  assert.deepEqual([...exports.inject], ['slots', 'locale', 'sidebarRightTabs']);

  const tabs = [];
  const slots = [];
  const ctx = {
    effect: (fn) => fn(),
    locale: { register: () => () => {}, bind: () => (key) => key },
    sidebarRightTabs: { register: (definition) => (tabs.push(definition), () => {}) },
    slots: {
      inject: (name, fn) => fn(),
      register: (options, component) => (slots.push({ options, component }), () => {}),
    },
  };
  exports.apply(ctx);
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].id, 'dsh-chatgpt-panel');
  assert.equal(tabs[0].kind, 'chatgpt-panel');
  assert.equal(tabs[0].guide[0].title(), 'title');
  assert.equal(slots.length, 1);
  assert.equal(slots[0].options.name, 'sidebar.right.pane.tab');
  assert.equal(slots[0].options.key, 'dsh-chatgpt-panel');
  const injected = slots[0].options.inject('session-1');
  assert.equal(typeof injected.hooks.panel.subscribe, 'function');
  assert.equal(typeof injected.hooks.panel.getSnapshot, 'function');
});

/** The client with a recording React stand-in, its Panel component, and a stubbed fetch. */
async function panel(responses) {
  const requests = [];
  const loaded = [];
  const context = vm.createContext({
    window: { __ModuleLoader__: { load: (row) => loaded.push(row) } },
    fetch: async (url, init = {}) => {
      requests.push({ url, method: init.method ?? 'GET', body: init.body });
      const [status, value] = responses[url] ?? [404, {}];
      return { ok: status < 300, status, json: async () => value };
    },
  });
  vm.runInContext(await client(), context);
  const React = {
    createElement: (type, props, ...children) => ({
      type,
      props: props ?? {},
      children: children.flat(),
    }),
    useEffect() {},
    useRef: (value) => ({ current: value }),
    useState: (value) => [value, () => {}],
  };
  const exports = loaded[0].factory(() => React);
  let Panel;
  exports.apply({
    effect: (fn) => fn(),
    locale: {
      register: () => () => {},
      bind: () => (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    },
    sidebarRightTabs: { register: () => () => {} },
    slots: {
      inject: (_name, fn) => fn(),
      register: (options, component) => ((Panel = { options, component }), () => {}),
    },
  });
  return { Panel, requests };
}

const text = (node) =>
  node == null || typeof node === 'boolean'
    ? ''
    : typeof node !== 'object'
      ? String(node)
      : node.children.map(text).join(' ');
const find = (node, match) => {
  if (!node || typeof node !== 'object') return null;
  if (match(node)) return node;
  for (const child of node.children) {
    const found = find(child, match);
    if (found) return found;
  }
  return null;
};

test('the panel renders the conversation summary and Add appends to the draft without submitting', async () => {
  const state = {
    phase: 'ok',
    helper: 'running',
    visible: true,
    pinned: false,
    source: 'ready',
    conversation: {
      title: 'Synthetic <b>chat</b>',
      turns: 2,
      files: 1,
      saved: 0,
      verification: 'partial',
      verifiedWithFiles: true,
      issues: ['check me'],
    },
  };
  const { Panel, requests } = await panel({
    'api/chatgpt-panel.add': [
      200,
      { ok: true, markdown: '# Synthetic chat\n', note: '1 file linked.' },
    ],
  });
  const calls = [];
  const input = {
    draft: 'my notes',
    draftRev: 3,
    phase: 'plain',
    occurrences: [],
    attachmentIds: [],
  };
  const props = {
    ...Panel.options.inject('session-1'),
    usePanel: (select) => select(state),
    useInput: (select) => select(input),
    inputActions: {
      captureInsertion: () => ({ start: 0, end: 0, draftRev: 3 }),
      insertText: (value, span) => (calls.push(['insertText', value, span]), true),
      setDraft: (value) => calls.push(['setDraft', value]),
      submit: () => calls.push(['submit']),
    },
  };
  const tree = Panel.component(props);
  const shown = text(tree);
  assert.ok(shown.includes('Synthetic <b>chat</b>'), 'the title stays text');
  assert.ok(shown.includes('partial') && shown.includes('check me'));
  const add = find(tree, (node) => node.type === 'button' && text(node) === 'add');
  assert.equal(add.props.disabled, false);
  add.props.onClick();
  for (let i = 0; i < 50 && calls.length === 0; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(requests.at(-1), {
    url: 'api/chatgpt-panel.add',
    method: 'POST',
    body: '{"downloadFiles":true}',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['insertText', '\n\n# Synthetic chat\n', { start: 8, end: 8, draftRev: 3 }],
  ]);
});

test('the panel offers Open when the window is closed and keeps Add disabled', async () => {
  const { Panel } = await panel({});
  const tree = Panel.component({
    ...Panel.options.inject('session-1'),
    usePanel: (select) => select({ phase: 'ok', helper: 'stopped' }),
    useInput: (select) => select({ draft: '', draftRev: 0, phase: 'plain', occurrences: [] }),
    inputActions: {},
  });
  assert.ok(find(tree, (node) => node.type === 'button' && text(node) === 'open'));
  const add = find(tree, (node) => node.type === 'button' && text(node) === 'add');
  assert.equal(add.props.disabled, true);
  assert.ok(text(tree).includes('windowStopped'));
});
