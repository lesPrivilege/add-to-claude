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

/**
 * A recording React stand-in: elements are plain objects, function components are called in
 * place (so their hooks run on the stand-in), and the harness primitives are minimal stand-ins
 * that keep the props a test needs to read.
 */
function standIns() {
  const createElement = (type, props, ...children) => {
    const all = { ...(props ?? {}), children: children.flat() };
    if (typeof type === 'function') return type(all);
    return { type, props: props ?? {}, children: children.flat() };
  };
  const React = {
    createElement,
    useEffect() {},
    useRef: (value) => ({ current: value }),
    // `seeds` overrides the next useState initial values, in call order.
    seeds: [],
    useState: (value) => [React.seeds.length ? React.seeds.shift() : value, () => {}],
  };
  const primitives = {
    Button: ({ children, variant, ...props }) =>
      createElement('button', { ...props, 'data-variant': variant }, children),
    Switch: ({ checked, onChange, label, disabled }) =>
      createElement('button', {
        role: 'switch',
        'aria-checked': checked,
        'aria-label': label,
        disabled,
        onClick: () => onChange(!checked),
      }),
    Tag: ({ tone, children }) => createElement('tag', { tone }, children),
    Tooltip: ({ label, children }) => createElement('tooltip', { label }, children),
    Menu: ({ open, anchor, children, side, align, portal }) =>
      createElement('menu', { open, side, align, portal }, anchor, open ? children : null),
    MenuItemButton: ({ children, onSelect, disabled, icon }) =>
      createElement('menuitem', { onSelect, disabled }, icon, children),
    IconPlusOutlineRegular: () => createElement('icon', null),
    IconRightUpOutlineRegular: () => createElement('icon', null),
    IconBrowseOutlineRegular: () => createElement('icon', null),
  };
  return { React, primitives };
}

const MODULES = ['react', '@deepseek-ai/dsh-client-ui-primitives'];

/** The built client with stand-ins, its slot registrations, and a stubbed fetch. */
async function loadClient(responses = {}) {
  const requests = [];
  const loaded = [];
  const context = vm.createContext({
    window: { __ModuleLoader__: { load: (row) => loaded.push(row) } },
    console,
    fetch: async (url, init = {}) => {
      requests.push({ url, method: init.method ?? 'GET', body: init.body });
      const [status, value] = responses[url] ?? [404, {}];
      return { ok: status < 300, status, json: async () => value };
    },
  });
  vm.runInContext(await client(), context);
  assert.equal(loaded.length, 1);
  const { React, primitives } = standIns();
  const requested = [];
  const exports = loaded[0].factory((id) => {
    requested.push(id);
    if (id === 'react') return React;
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
    return assert.fail(`require(${id})`);
  });
  const tabs = [];
  const slots = new Map();
  const opened = [];
  exports.apply({
    effect: (fn) => fn(),
    locale: {
      register: () => () => {},
      bind: () => (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    },
    sidebarRightTabs: { register: (definition) => (tabs.push(definition), () => {}) },
    sidebarRight: { openTab: (kind, options) => opened.push([kind, options]) },
    slots: {
      inject: (_name, fn) => fn(),
      register: (options, component) => (slots.set(options.name, { options, component }), () => {}),
    },
  });
  return { loaded, exports, requested, tabs, slots, opened, requests, React };
}

const text = (node) =>
  node == null || typeof node === 'boolean'
    ? ''
    : typeof node !== 'object'
      ? String(node)
      : Array.isArray(node)
        ? node.map(text).join(' ')
        : node.type === 'style'
          ? ''
          : node.children.map(text).join(' ');
const find = (node, match) => {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, match);
      if (found) return found;
    }
    return null;
  }
  if (match(node)) return node;
  return find(node.children, match);
};
const button = (tree, label) =>
  find(
    tree,
    (node) => (node.type === 'button' || node.type === 'menuitem') && text(node).trim() === label,
  );

const ready = {
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

/** Session props for a session-scoped surface: the slot's injection plus the session's input. */
function sessionProps(slot, state, calls, settings = { downloadFiles: true }) {
  const input = {
    draft: 'my notes',
    draftRev: 3,
    phase: 'plain',
    occurrences: [],
    attachmentIds: [],
  };
  return {
    ...slot.options.inject('session-1'),
    usePanel: (select) => select(state),
    useSettings: (select) => select(settings),
    useInput: (select) => select(input),
    inputActions: {
      captureInsertion: () => ({ start: 0, end: 0, draftRev: 3 }),
      insertText: (value, span) => (calls.push(['insertText', value, span]), true),
      setDraft: (value) => calls.push(['setDraft', value]),
      submit: () => calls.push(['submit']),
    },
  };
}

async function settle(calls) {
  for (let i = 0; i < 50 && calls.length === 0; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
}

test('the client bundle registers its tab type and four slot contributions', async () => {
  const { loaded, exports, requested, tabs, slots } = await loadClient();
  assert.equal(loaded[0].id, 'dsh-chatgpt-panel');
  assert.deepEqual(requested, MODULES, 'React and the primitives come from the shell');
  assert.equal(exports.name, 'chatgpt-panel');
  assert.deepEqual([...exports.inject], ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight']);
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].id, 'dsh-chatgpt-panel');
  assert.equal(tabs[0].kind, 'chatgpt-panel');
  assert.equal(tabs[0].guide[0].title(), 'title');
  assert.deepEqual([...slots.keys()].sort(), [
    'conversation.input.right',
    'main',
    'sidebar.panellist',
    'sidebar.right.pane.tab',
  ]);
  assert.equal(slots.get('sidebar.right.pane.tab').options.key, 'dsh-chatgpt-panel');
  assert.equal(slots.get('conversation.input.right').options.id, 'dsh-chatgpt-panel');
  assert.equal(slots.get('main').options.key, 'chatgpt-panel');
  assert.equal(slots.get('sidebar.panellist').options.id, 'chatgpt-panel');
  assert.equal(slots.get('sidebar.panellist').options.label(), 'title');
  const injected = slots.get('sidebar.right.pane.tab').options.inject('session-1');
  for (const hook of [injected.hooks.panel, injected.hooks.settings]) {
    assert.equal(typeof hook.subscribe, 'function');
    assert.equal(typeof hook.getSnapshot, 'function');
  }
  const icon = slots.get('sidebar.panellist').component({ size: 16 });
  assert.equal(icon.type, 'svg');
  assert.equal(icon.props.stroke, 'currentColor');
});

test('the tab renders the conversation and Add appends to the draft without submitting', async () => {
  const { slots, requests } = await loadClient({
    'api/chatgpt-panel.add': [200, { ok: true, markdown: '# Synthetic chat\n', note: '' }],
  });
  const calls = [];
  const tab = slots.get('sidebar.right.pane.tab');
  const tree = tab.component(sessionProps(tab, ready, calls));
  const shown = text(tree);
  assert.ok(shown.includes('Synthetic <b>chat</b>'), 'the title stays text');
  assert.ok(
    shown.includes('statusReady') && shown.includes('partial') && shown.includes('check me'),
  );
  assert.ok(shown.includes('turnsMany {"n":2}') && shown.includes('filesOne'), 'counts pluralize');
  assert.ok(find(tree, (node) => node.type === 'button' && node.props['aria-label'] === 'pin'));
  assert.ok(find(tree, (node) => node.props?.['aria-label'] === 'downloadFiles'));
  const add = button(tree, 'add');
  assert.equal(add.props['data-variant'], 'primary');
  assert.equal(add.props.disabled, false);
  add.props.onClick();
  await settle(calls);
  assert.deepEqual(requests.at(-1), {
    url: 'api/chatgpt-panel.add',
    method: 'POST',
    body: '{"downloadFiles":true}',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['insertText', '\n\n# Synthetic chat\n', { start: 8, end: 8, draftRev: 3 }],
  ]);
});

test('the tab offers Open when the window is closed and keeps Add disabled; Open is never disabled', async () => {
  const { slots } = await loadClient();
  const tab = slots.get('sidebar.right.pane.tab');
  for (const state of [
    { phase: 'ok', helper: 'stopped' },
    { phase: 'ok', helper: 'unavailable', reason: 'The ChatGPT window stopped.' },
  ]) {
    const tree = tab.component(sessionProps(tab, state, []));
    const open = button(tree, 'open');
    assert.ok(open);
    assert.ok(!open.props.disabled);
    assert.equal(button(tree, 'add').props.disabled, true);
  }
  const closed = text(tab.component(sessionProps(tab, { phase: 'ok', helper: 'stopped' }, [])));
  assert.ok(closed.includes('statusClosed') && closed.includes('windowStopped'));
  const failed = text(
    tab.component(
      sessionProps(
        tab,
        { phase: 'ok', helper: 'unavailable', reason: 'The ChatGPT window stopped.' },
        [],
      ),
    ),
  );
  assert.ok(failed.includes('"reason":"errStopped"'), 'a known host message is localized');
});

test('the composer button opens a closed window with one click', async () => {
  const { slots, requests } = await loadClient({ 'api/chatgpt-panel.open': [200, { ok: true }] });
  const slot = slots.get('conversation.input.right');
  const tree = slot.component(sessionProps(slot, { phase: 'ok', helper: 'stopped' }, []));
  const tooltip = find(tree, (node) => node.type === 'tooltip');
  assert.equal(tooltip.props.label, 'windowStopped');
  const trigger = find(tree, (node) => node.type === 'button');
  assert.equal(trigger.props['aria-haspopup'], undefined, 'a closed window opens; no menu');
  assert.ok(text(trigger).includes('trigger'), 'a text button');
  assert.equal(
    find(trigger, (node) => node.type === 'svg'),
    null,
    'no brand mark on the composer control',
  );
  trigger.props.onClick();
  for (let i = 0; i < 50 && requests.length === 0; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(requests.at(-1), { url: 'api/chatgpt-panel.open', method: 'POST', body: '{}' });
});

test('the composer button menu adds without submitting, shows the window and opens the tab', async () => {
  const { slots, requests, opened, React } = await loadClient({
    'api/chatgpt-panel.add': [
      200,
      {
        ok: true,
        markdown: '# Synthetic chat\n- a.pdf — `/x/a.pdf` · sha256 ' + 'a'.repeat(64) + '\n',
        note: '',
      },
    ],
    'api/chatgpt-panel.open': [200, { ok: true }],
  });
  const slot = slots.get('conversation.input.right');
  // The stand-in useState never re-renders, so render the open menu by seeding its state.
  const calls = [];
  const props = sessionProps(slot, ready, calls, { downloadFiles: false });
  const closed = slot.component(props);
  const trigger = find(closed, (node) => node.type === 'button');
  assert.equal(trigger.props['aria-haspopup'], 'menu');
  assert.ok(
    find(trigger, (node) => node.props?.className === 'dshcp-dot'),
    'a ready conversation shows a dot',
  );
  const menu = find(closed, (node) => node.type === 'menu');
  assert.equal(menu.props.side, 'top');
  assert.equal(menu.props.portal, true);

  React.seeds = [true]; // ComposerButton's first state is whether its menu is open.
  const openTree = slot.component(props);
  assert.ok(text(openTree).includes('Synthetic <b>chat</b>'));
  button(openTree, 'add').props.onSelect();
  await settle(calls);
  assert.deepEqual(requests.at(-1), {
    url: 'api/chatgpt-panel.add',
    method: 'POST',
    body: '{"downloadFiles":false}',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'insertText');
  assert.ok(!calls.some(([name]) => name === 'submit' || name === 'setDraft'));

  button(openTree, 'openTab').props.onSelect();
  assert.deepEqual(opened, [['chatgpt-panel', undefined]]);
  button(openTree, 'show').props.onSelect();
  for (let i = 0; i < 50 && requests.at(-1).url !== 'api/chatgpt-panel.open'; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(requests.at(-1).url, 'api/chatgpt-panel.open');
});

test('the home page shows the control plane without session input', async () => {
  const { slots } = await loadClient();
  const page = slots.get('main');
  const props = {
    ...page.options.inject(),
    usePanel: (select) => select(ready),
    useSettings: (select) => select({ downloadFiles: true }),
  };
  const tree = page.component(props);
  const shown = text(tree);
  for (const key of ['title', 'statusReady', 'show', 'pin', 'downloadFiles', 'how2', 'privacy'])
    assert.ok(shown.includes(key) || find(tree, (n) => n.props?.['aria-label'] === key), key);
  assert.ok(shown.includes('Synthetic <b>chat</b>'));
  assert.equal(button(tree, 'add'), null, 'Add stays in a session');
});
