// The DeepSeek Harness client half. Three surfaces share one panel state and one set of controls:
//
// - a ChatGPT button in the composer's tool row (`conversation.input.right`), where the user works;
// - a right-sidebar tab (`sidebar.right.pane.tab`, type registered with `ctx.sidebarRightTabs`);
// - a left-bar row (`sidebar.panellist`) opening the plugin's home page in the main column (`main`).
//
// Add appends the prepared conversation to the session's draft. It never submits. Only the two
// session-scoped surfaces (button and tab) receive the session's `inputActions`, so only they Add.
//
// The build turns this file into a module-loader factory; `require` is the loader's. React and the
// harness's UI primitives come from the shell's platform module table
// (packages/client/web/src/platform.ts in dsh 0.2.0-rc.2). The package pins that release exactly.
//
// The shared append helpers (shared/append.js) are inlined ahead of this file by the build.

export function createClient(require) {
  const React = require('react');
  const ui = require('@deepseek-ai/dsh-client-ui-primitives');
  const h = React.createElement;
  const { useEffect, useRef, useState } = React;
  const {
    Button,
    Switch,
    Tag,
    Tooltip,
    Menu,
    MenuItemButton,
    IconPlusOutlineRegular,
    IconRightUpOutlineRegular,
    IconBrowseOutlineRegular,
  } = ui;

  const ID = 'dsh-chatgpt-panel';
  const KIND = 'chatgpt-panel';
  const PANEL_ID = 'chatgpt-panel';
  const NS = 'dshChatgptPanel';
  // Document-relative, like the harness's own routes, so a mounted Web host keeps its prefix.
  const ROUTES = {
    state: 'api/chatgpt-panel.state',
    open: 'api/chatgpt-panel.open',
    pin: 'api/chatgpt-panel.pin',
    add: 'api/chatgpt-panel.add',
  };

  const en = {
    tab: 'ChatGPT',
    title: 'ChatGPT panel',
    description: 'Pull your ChatGPT conversation into DeepSeek Harness.',
    tagline: 'Talk it through in ChatGPT. Finish it in DeepSeek Harness.',
    statusClosed: 'Closed',
    statusWaiting: 'Waiting',
    statusReady: 'Ready',
    statusUnreadable: 'Unreadable',
    statusUnavailable: 'Unavailable',
    statusOffline: 'Offline',
    windowVisible: 'The ChatGPT window is open.',
    windowHidden: 'The ChatGPT window is hidden. A reply keeps streaming.',
    windowStopped: 'The ChatGPT window is closed.',
    unavailable: 'The ChatGPT window could not start: {reason}',
    waiting: 'Open a conversation in the ChatGPT window. Sign in there first if it asks.',
    unreadable: 'This conversation could not be read: {message}',
    open: 'Open ChatGPT',
    show: 'Show ChatGPT window',
    openTab: 'Open ChatGPT tab',
    trigger: 'Add from ChatGPT',
    pin: 'Keep window on top',
    downloadFiles: 'Download files on Add',
    downloadFilesHint: 'Into ~/Downloads/Add to Claude/<conversation title>/',
    turnsOne: '1 turn',
    turnsMany: '{n} turns',
    filesOne: '1 file',
    filesMany: '{n} files',
    linkedOne: '1 file linked',
    linkedMany: '{n} files linked',
    saved: '{saved} of {files} saved',
    verified: 'Verified',
    partial: 'Partial',
    verifiedWithFiles: 'Verified once its files are saved',
    add: 'Add to composer',
    adding: 'Preparing…',
    added: 'Added',
    notSent: 'not sent',
    busy: 'The composer is busy. Add again when it is idle.',
    changed: 'The draft changed while adding. Add again.',
    offline: 'The panel is not reachable ({status}).',
    sectionWindow: 'ChatGPT window',
    sectionConversation: 'Conversation',
    sectionFiles: 'Files',
    filesFolder: 'Files folder',
    sectionHow: 'Add a conversation',
    how1: 'Open a session.',
    how2: 'Click Add from ChatGPT beside the model selector in the composer, or open the ChatGPT tab from the + in the right sidebar.',
    how3: 'Choose Add to composer. The conversation goes to the end of the draft; nothing is sent.',
    sectionPrivacy: 'Privacy',
    privacy:
      'Reads only the conversation the ChatGPT window has loaded and keeps it in memory. No telemetry, no history archive, no server of its own.',
    errShuttingDown: 'The panel is shutting down.',
    errClosed: 'The ChatGPT window is closed.',
    errNoAnswer: 'The ChatGPT window did not answer.',
    errWindowClosed: 'The ChatGPT window closed.',
    errStopped: 'The ChatGPT window stopped.',
    errNotPrepared: 'The conversation could not be prepared.',
    errNotReady: 'No conversation is ready in the ChatGPT window.',
    errChanged: 'The conversation changed while its files were saved. Add again.',
    errTooLarge: 'This conversation is larger than 2 MiB, too large for the composer.',
    errAnother: 'Another ChatGPT panel window is already running.',
    errNoElectron:
      'Electron was not found. Install the dsh-pet plugin once (it keeps Electron in ~/.dsh/electron) or set DSH_CHATGPT_PANEL_ELECTRON.',
    errReloading: 'The page stopped. It is reloading.',
    errStoppedAgain: 'The page stopped again. Close and reopen the panel.',
    errNoOriginal: 'This page did not expose its original messages.',
  };
  const zh = {
    tab: 'ChatGPT',
    title: 'ChatGPT 面板',
    description: '把 ChatGPT 对话拉进 DeepSeek Harness。',
    tagline: '在 ChatGPT 里聊透，在 DeepSeek Harness 里完成。',
    statusClosed: '已关闭',
    statusWaiting: '等待中',
    statusReady: '就绪',
    statusUnreadable: '无法读取',
    statusUnavailable: '不可用',
    statusOffline: '离线',
    windowVisible: 'ChatGPT 窗口已打开。',
    windowHidden: 'ChatGPT 窗口已隐藏，正在生成的回复会继续。',
    windowStopped: 'ChatGPT 窗口已关闭。',
    unavailable: 'ChatGPT 窗口无法启动：{reason}',
    waiting: '请在 ChatGPT 窗口中打开一段对话。如有提示，先在那里登录。',
    unreadable: '无法读取这段对话：{message}',
    open: '打开 ChatGPT',
    show: '显示 ChatGPT 窗口',
    openTab: '打开 ChatGPT 标签页',
    trigger: '从 ChatGPT 添加',
    pin: '窗口置顶',
    downloadFiles: '添加时下载文件',
    downloadFilesHint: '保存到 ~/Downloads/Add to Claude/<对话标题>/',
    turnsOne: '1 轮',
    turnsMany: '{n} 轮',
    filesOne: '1 个文件',
    filesMany: '{n} 个文件',
    linkedOne: '已关联 1 个文件',
    linkedMany: '已关联 {n} 个文件',
    saved: '已保存 {saved}/{files}',
    verified: 'Verified',
    partial: 'Partial',
    verifiedWithFiles: '文件保存后即为 Verified',
    add: '添加到输入框',
    adding: '正在准备…',
    added: '已添加',
    notSent: '未发送',
    busy: '输入框正忙，请在空闲时再添加。',
    changed: '添加时草稿发生了变化，请再添加一次。',
    offline: '无法连接面板（{status}）。',
    sectionWindow: 'ChatGPT 窗口',
    sectionConversation: '对话',
    sectionFiles: '文件',
    filesFolder: '文件夹',
    sectionHow: '添加一段对话',
    how1: '打开一个会话。',
    how2: '点击输入框中模型选择器旁的“从 ChatGPT 添加”，或从右侧边栏的 + 打开 ChatGPT 标签页。',
    how3: '选择“添加到输入框”。对话追加到草稿末尾，不会发送。',
    sectionPrivacy: '隐私',
    privacy:
      '只读取 ChatGPT 窗口已加载的对话，并只保存在内存里。没有遥测，没有历史存档，也没有自己的服务器。',
    errShuttingDown: '面板正在关闭。',
    errClosed: 'ChatGPT 窗口已关闭。',
    errNoAnswer: 'ChatGPT 窗口没有响应。',
    errWindowClosed: 'ChatGPT 窗口已关闭。',
    errStopped: 'ChatGPT 窗口已停止。',
    errNotPrepared: '无法整理这段对话。',
    errNotReady: 'ChatGPT 窗口里还没有就绪的对话。',
    errChanged: '保存文件期间对话发生了变化，请再添加一次。',
    errTooLarge: '这段对话超过 2 MiB，输入框放不下。',
    errAnother: '已有另一个 ChatGPT 面板窗口在运行。',
    errNoElectron:
      '找不到 Electron。请先安装一次 dsh-pet 插件（它把 Electron 放在 ~/.dsh/electron），或设置 DSH_CHATGPT_PANEL_ELECTRON。',
    errReloading: '页面已停止，正在重新加载。',
    errStoppedAgain: '页面再次停止。请关闭并重新打开面板。',
    errNoOriginal: '这个页面没有提供原始消息。',
  };

  // The host and helper answer in English; known messages are shown in the user's language.
  const ERRORS = new Map(
    Object.keys(en)
      .filter((key) => key.startsWith('err'))
      .map((key) => [en[key], key]),
  );
  const localized = (t, message) => (ERRORS.has(message) ? t(ERRORS.get(message)) : message);
  const plural = (t, n, one, many) => (n === 1 ? t(one) : t(many, { n }));

  /** Polls the host's panel state while any surface shows it; a getSnapshot/subscribe source. */
  function createPanelSource() {
    let snapshot = { phase: 'loading' };
    const listeners = new Set();
    let timer = null;
    let generation = 0;
    // After an action, poll quickly for a few seconds so the window's state shows promptly.
    let fastUntil = 0;
    const delay = () => {
      if (Date.now() < fastUntil) return 250;
      return globalThis.document?.visibilityState === 'hidden' ? 5000 : 1500;
    };
    const publish = (next) => {
      snapshot = next;
      for (const listener of listeners) listener();
    };
    const poll = async (mine) => {
      let next;
      try {
        const response = await fetch(ROUTES.state, { cache: 'no-store' });
        const value = response.ok ? await response.json() : null;
        next =
          value && typeof value === 'object'
            ? { phase: 'ok', ...value }
            : { phase: 'offline', status: response.status };
      } catch {
        next = { phase: 'offline', status: 'network' };
      }
      if (mine !== generation) return;
      if (JSON.stringify(next) !== JSON.stringify(snapshot)) publish(next);
      timer = setTimeout(() => void poll(mine), delay());
    };
    return {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener);
        if (listeners.size === 1) void poll(++generation);
        return () => {
          listeners.delete(listener);
          if (listeners.size === 0) {
            generation++;
            clearTimeout(timer);
          }
        };
      },
      refresh() {
        fastUntil = Date.now() + 4000;
        if (listeners.size === 0) return;
        clearTimeout(timer);
        void poll(++generation);
      },
      dispose() {
        generation++;
        clearTimeout(timer);
        listeners.clear();
      },
    };
  }

  /** The one client-side preference, shared by every surface and kept per browser profile. */
  function createSettings() {
    const KEY = 'dsh-chatgpt-panel.downloadFiles';
    let snapshot = { downloadFiles: true };
    try {
      if (globalThis.localStorage?.getItem(KEY) === 'false') snapshot = { downloadFiles: false };
    } catch {
      /* Storage refused: keep the default. */
    }
    const listeners = new Set();
    return {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      setDownloadFiles(on) {
        snapshot = { downloadFiles: on };
        try {
          globalThis.localStorage?.setItem(KEY, String(on));
        } catch {
          /* Storage refused: the choice lasts for this page. */
        }
        for (const listener of listeners) listener();
      },
    };
  }

  async function post(route, body) {
    const response = await fetch(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const value = await response.json().catch(() => null);
    if (!response.ok || !value || value.ok !== true)
      throw new Error(value?.error || `HTTP ${response.status}`);
    return value;
  }

  // Layout only; every color, radius and type step is a harness token or a primitive's own.
  const styles = `
.dshcp-tab{display:flex;flex-direction:column;gap:16px;padding:16px;height:100%;overflow:auto;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dshcp-head{display:flex;align-items:center;gap:8px;min-width:0}
.dshcp-head-title{flex:1;min-width:0;font-weight:500;font-size:14px;line-height:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshcp-mark{flex:none;display:block;color:var(--dsw-alias-label-primary)}
.dshcp-muted{color:var(--dsw-alias-label-secondary)}
.dshcp-faint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dshcp-card{display:flex;flex-direction:column;gap:6px;padding:12px;border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-settings-card-fill);border:0.5px solid var(--dsw-alias-settings-card-stroke)}
.dshcp-convo-title{font-weight:500;overflow-wrap:anywhere}
.dshcp-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary)}
.dshcp-issues{margin:0;padding-left:18px;color:var(--dsw-alias-label-secondary)}
.dshcp-actions{display:flex;flex-direction:column;gap:8px}
.dshcp-actions>button{width:100%}
.dshcp-toggles{display:flex;flex-direction:column}
.dshcp-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:36px}
.dshcp-toggle-text{display:flex;flex-direction:column;min-width:0}
.dshcp-notice{color:var(--dsw-alias-label-secondary)}
.dshcp-notice[data-error]{color:var(--dsw-alias-state-error-primary)}
.dshcp-trigger{display:inline-flex;align-items:center;gap:6px;flex:none;height:28px;padding:0 8px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;font-weight:400;white-space:nowrap;cursor:pointer;outline:none}
.dshcp-trigger:hover:not(:disabled),.dshcp-trigger[aria-expanded='true']{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshcp-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.dshcp-dot{flex:none;width:6px;height:6px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-state-success-primary)}
.dshcp-menu{min-width:240px;max-width:320px}
.dshcp-menu-head{display:flex;flex-direction:column;gap:2px;padding:6px 8px 8px}
.dshcp-menu-title{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshcp-menu-notice{padding:6px 8px 4px;font-size:12px;line-height:18px}
.dshcp-page{display:flex;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.6}
.dshcp-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}
.dshcp-content{max-width:720px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}
.dshcp-page-head{display:flex;align-items:center;gap:12px;padding-top:28px;margin-bottom:8px}
:where([data-platform='darwin']) .dshcp-page-head{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.dshcp-page-head h1{flex:1;min-width:0;margin:0;font-size:20px;line-height:28px;font-weight:500}
.dshcp-lead{margin:0 0 24px;color:var(--dsw-alias-label-secondary)}
.dshcp-section{display:flex;flex-direction:column;gap:8px;margin-bottom:24px}
.dshcp-section h2{margin:0;font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.dshcp-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshcp-path{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:12px;overflow-wrap:anywhere}
.dshcp-steps{margin:0;padding-left:20px;color:var(--dsw-alias-label-secondary)}
`;
  const Style = () => h('style', null, styles);

  /** The brand mark (native/icons/brand.svg), drawn in the current text color. */
  function BrandMark({ size = 16, className = 'dshcp-mark' }) {
    return h(
      'svg',
      {
        className,
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
      h('path', { d: 'M5.8 2.5 10.2 12.6M18.2 2.5 13.8 12.6' }),
      h('path', { d: 'M8.6 11.5H7a5 5 0 0 0 0 10h10a5 5 0 0 0 0-10h-1.6' }),
      h('path', { d: 'M6 15h12M6 18.2h6.6M14.6 17.1v2.2' }),
    );
  }

  /** Everything the surfaces say about the panel state, derived once. */
  function describe(panel, t) {
    if (panel.phase === 'loading') return { status: null, running: false, conversation: null };
    if (panel.phase === 'offline')
      return {
        status: { tone: 'danger', label: t('statusOffline') },
        line: t('offline', { status: String(panel.status) }),
        running: false,
        conversation: null,
      };
    const running = panel.helper === 'running';
    const conversation = running && panel.source === 'ready' ? panel.conversation : null;
    const status =
      panel.helper === 'unavailable'
        ? { tone: 'danger', label: t('statusUnavailable') }
        : !running
          ? { tone: 'neutral', label: t('statusClosed') }
          : conversation
            ? { tone: 'success', label: t('statusReady') }
            : panel.source === 'unavailable'
              ? { tone: 'warning', label: t('statusUnreadable') }
              : { tone: 'neutral', label: t('statusWaiting') };
    const line =
      panel.helper === 'unavailable'
        ? t('unavailable', { reason: localized(t, panel.reason || '') })
        : !running
          ? t('windowStopped')
          : panel.visible
            ? t('windowVisible')
            : t('windowHidden');
    const waiting = running
      ? panel.source === 'unavailable'
        ? t('unreadable', { message: localized(t, panel.message || '') })
        : t('waiting')
      : '';
    return { status, line, running, visible: running && panel.visible, conversation, waiting };
  }

  const counts = (t, c) =>
    `${plural(t, c.turns, 'turnsOne', 'turnsMany')} · ${plural(t, c.files, 'filesOne', 'filesMany')}`;

  function StatusTag({ view }) {
    return view.status ? h(Tag, { tone: view.status.tone }, view.status.label) : null;
  }

  function VerificationTag({ conversation, t }) {
    return conversation.verification === 'verified'
      ? h(Tag, { tone: 'success' }, t('verified'))
      : h(Tag, { tone: 'warning' }, t('partial'));
  }

  function ConversationCard({ view, t }) {
    const c = view.conversation;
    if (!c) return h('div', { className: 'dshcp-card dshcp-muted' }, view.waiting || view.line);
    return h(
      'div',
      { className: 'dshcp-card' },
      h('div', { className: 'dshcp-convo-title' }, c.title),
      h(
        'div',
        { className: 'dshcp-meta' },
        h('span', null, counts(t, c)),
        h(VerificationTag, { conversation: c, t }),
      ),
      c.files > 0
        ? h(
            'div',
            { className: 'dshcp-faint' },
            t('saved', { saved: c.saved, files: c.files }),
            c.verification !== 'verified' && c.verifiedWithFiles
              ? ` · ${t('verifiedWithFiles')}`
              : '',
          )
        : null,
      c.issues.length
        ? h(
            'ul',
            { className: 'dshcp-issues' },
            c.issues.map((issue, index) => h('li', { key: index }, issue)),
          )
        : null,
    );
  }

  function Toggle({ label, hint, checked, disabled, onChange }) {
    return h(
      'div',
      { className: 'dshcp-toggle' },
      h(
        'div',
        { className: 'dshcp-toggle-text' },
        h('span', null, label),
        hint ? h('span', { className: 'dshcp-faint' }, hint) : null,
      ),
      h(Switch, { checked, disabled, label, onChange }),
    );
  }

  /** Window actions shared by every surface: open or show, and keep on top. */
  function useWindowActions({ actions, t }) {
    const [error, setError] = useState(null);
    const run = (task) =>
      task()
        .then(() => setError(null))
        .catch((e) => setError(localized(t, e?.message || String(e))))
        .finally(() => actions.refresh());
    return {
      error,
      open: () => run(() => post(ROUTES.open)),
      pin: (on) => run(() => post(ROUTES.pin, { on })),
    };
  }

  /** Add: fetch the hand-off text, append it to the draft, say what happened. */
  function useAdd({ useInput, inputActions, useSettings, actions, t, conversation }) {
    const input = useInput((value) => value);
    const latest = useRef(input);
    latest.current = input;
    const downloadFiles = useSettings((value) => value.downloadFiles);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState(null);
    // A result is read once: it clears after a few seconds, or when another conversation shows.
    useEffect(() => {
      if (!notice) return undefined;
      const timer = setTimeout(() => setNotice(null), notice.error ? 12000 : 6000);
      return () => clearTimeout(timer);
    }, [notice]);
    const title = conversation?.title;
    useEffect(() => setNotice(null), [title]);

    const add = () => {
      if (busy || !conversation) return;
      const turns = conversation.turns;
      setBusy(true);
      setNotice(null);
      void post(ROUTES.add, { downloadFiles })
        .then(({ markdown, note }) => {
          const outcome = appendToComposer(inputActions, latest.current, markdown);
          if (outcome !== 'appended' && outcome !== 'set')
            return setNotice({ error: true, text: t(outcome) });
          const linked = (markdown.match(/ · sha256 [0-9a-f]{64}$/gmu) ?? []).length;
          const parts = [t('added'), plural(t, turns, 'turnsOne', 'turnsMany')];
          if (linked > 0) parts.push(plural(t, linked, 'linkedOne', 'linkedMany'));
          parts.push(t('notSent'));
          setNotice({ error: false, text: parts.join(' · '), detail: note });
        })
        .catch((e) => setNotice({ error: true, text: localized(t, e?.message || String(e)) }))
        .finally(() => {
          setBusy(false);
          actions.refresh();
        });
    };
    return { busy, notice, add };
  }

  function Notice({ notice, className = 'dshcp-notice' }) {
    if (!notice) return null;
    return h(
      'div',
      { className, role: 'status', 'data-error': notice.error ? '' : undefined },
      notice.text,
      notice.detail ? h('div', { className: 'dshcp-faint' }, notice.detail) : null,
    );
  }

  /** The right-sidebar tab: status, Add, the window, and the two toggles. */
  function PanelTab(props) {
    const { usePanel, useSettings, settings, t, actions } = props;
    const panel = usePanel((value) => value);
    const view = describe(panel, t);
    const downloadFiles = useSettings((value) => value.downloadFiles);
    const win = useWindowActions(props);
    const adding = useAdd({ ...props, conversation: view.conversation });
    if (panel.phase === 'loading') return h('div', { className: 'dshcp-tab' }, h(Style));
    return h(
      'div',
      { className: 'dshcp-tab' },
      h(Style),
      h(
        'div',
        { className: 'dshcp-head' },
        h(BrandMark, { size: 18 }),
        h('span', { className: 'dshcp-head-title' }, t('title')),
        h(StatusTag, { view }),
      ),
      h(ConversationCard, { view, t }),
      h(
        'div',
        { className: 'dshcp-actions' },
        h(
          Button,
          {
            variant: 'primary',
            disabled: !view.conversation || adding.busy,
            onClick: adding.add,
          },
          adding.busy ? t('adding') : t('add'),
        ),
        h(Button, { variant: 'outline', onClick: win.open }, view.running ? t('show') : t('open')),
      ),
      h(Notice, { notice: adding.notice }),
      win.error ? h(Notice, { notice: { error: true, text: win.error } }) : null,
      h('div', { className: 'dshcp-faint' }, view.line),
      h(
        'div',
        { className: 'dshcp-toggles' },
        h(Toggle, {
          label: t('pin'),
          checked: Boolean(panel.pinned),
          disabled: !view.running,
          onChange: win.pin,
        }),
        h(Toggle, {
          label: t('downloadFiles'),
          checked: downloadFiles,
          onChange: (on) => settings.setDownloadFiles(on),
        }),
      ),
    );
  }

  /**
   * The composer's "Add from ChatGPT" text button, a quiet control like its neighbours in the tool
   * row (no brand mark, by the owner's decision). Closed window: one click opens it. Otherwise a small menu:
   * Add to composer (append, never submit), Show ChatGPT window, Open ChatGPT tab.
   */
  function ComposerButton(props) {
    const { usePanel, t, actions } = props;
    const panel = usePanel((value) => value);
    const view = describe(panel, t);
    const [open, setOpen] = useState(false);
    const win = useWindowActions(props);
    const adding = useAdd({ ...props, conversation: view.conversation });
    const notice = adding.notice ?? (win.error ? { error: true, text: win.error } : null);
    // A successful Add closes the menu shortly after saying so; a problem stays until dismissed.
    useEffect(() => {
      if (!open || !adding.notice || adding.notice.error) return undefined;
      const timer = setTimeout(() => setOpen(false), 1600);
      return () => clearTimeout(timer);
    }, [open, adding.notice]);
    if (panel.phase === 'loading' || panel.phase === 'offline') return null;

    const click = () => {
      if (view.running) setOpen(!open);
      else void win.open().then(() => setOpen(false));
    };
    const label = view.running ? `${t('trigger')} · ${view.status.label}` : t('trigger');
    const trigger = h(
      Tooltip,
      {
        // What a click will act on: the ready conversation, or why there is none yet.
        label: view.conversation
          ? `${view.conversation.title} · ${counts(t, view.conversation)}`
          : view.waiting || view.line,
        side: 'top',
        delayMs: 500,
        disabled: open,
      },
      h(
        'button',
        {
          type: 'button',
          className: 'dshcp-trigger',
          'aria-label': label,
          'aria-haspopup': view.running ? 'menu' : undefined,
          'aria-expanded': view.running ? open : undefined,
          onClick: click,
        },
        t('trigger'),
        view.conversation ? h('span', { className: 'dshcp-dot', 'aria-hidden': true }) : null,
      ),
    );
    const c = view.conversation;
    return h(
      'span',
      null,
      h(Style),
      h(
        Menu,
        {
          open: open && view.running,
          anchor: trigger,
          side: 'top',
          align: 'end',
          portal: true,
          onClose: () => setOpen(false),
          listClassName: 'dshcp-menu',
        },
        h(
          'div',
          { className: 'dshcp-menu-head' },
          h('div', { className: 'dshcp-menu-title' }, c ? c.title : t('title')),
          h(
            'div',
            { className: 'dshcp-faint' },
            c
              ? `${counts(t, c)} · ${c.verification === 'verified' ? t('verified') : t('partial')}`
              : view.waiting,
          ),
        ),
        h(
          MenuItemButton,
          {
            icon: h(IconPlusOutlineRegular, null),
            disabled: !c || adding.busy,
            onSelect: adding.add,
          },
          adding.busy ? t('adding') : t('add'),
        ),
        h(
          MenuItemButton,
          {
            icon: h(IconRightUpOutlineRegular, null),
            onSelect: () => {
              setOpen(false);
              void win.open();
            },
          },
          t('show'),
        ),
        h(
          MenuItemButton,
          {
            icon: h(IconBrowseOutlineRegular, null),
            onSelect: () => {
              setOpen(false);
              actions.openTab();
            },
          },
          t('openTab'),
        ),
        h(Notice, { notice, className: 'dshcp-notice dshcp-menu-notice' }),
      ),
    );
  }

  /** The left-bar row's icon; the sidebar owns the row and its label. */
  function PanelIcon({ size }) {
    return h(BrandMark, { size, className: '' });
  }

  /** The plugin's home page in the main column: the control plane without a session. */
  function HomePage(props) {
    const { usePanel, useSettings, settings, t } = props;
    const panel = usePanel((value) => value);
    const view = describe(panel, t);
    const downloadFiles = useSettings((value) => value.downloadFiles);
    const win = useWindowActions(props);
    const section = (title, ...children) =>
      h('section', { className: 'dshcp-section' }, h('h2', null, title), ...children);
    return h(
      'div',
      { className: 'dshcp-page' },
      h(Style),
      h(
        'div',
        { className: 'dshcp-scroll' },
        h(
          'div',
          { className: 'dshcp-content' },
          h(
            'div',
            { className: 'dshcp-page-head' },
            h(BrandMark, { size: 24 }),
            h('h1', null, t('title')),
            h(StatusTag, { view }),
          ),
          h('p', { className: 'dshcp-lead' }, t('tagline')),
          section(
            t('sectionWindow'),
            h('div', { className: 'dshcp-muted' }, view.line),
            h(
              'div',
              { className: 'dshcp-row' },
              h(
                Button,
                { variant: view.running ? 'outline' : 'primary', onClick: win.open },
                view.running ? t('show') : t('open'),
              ),
            ),
            win.error ? h(Notice, { notice: { error: true, text: win.error } }) : null,
            h(Toggle, {
              label: t('pin'),
              checked: Boolean(panel.pinned),
              disabled: !view.running,
              onChange: win.pin,
            }),
          ),
          view.running ? section(t('sectionConversation'), h(ConversationCard, { view, t })) : null,
          section(
            t('sectionFiles'),
            h(Toggle, {
              label: t('downloadFiles'),
              hint: t('downloadFilesHint'),
              checked: downloadFiles,
              onChange: (on) => settings.setDownloadFiles(on),
            }),
          ),
          section(
            t('sectionHow'),
            h(
              'ol',
              { className: 'dshcp-steps' },
              h('li', null, t('how1')),
              h('li', null, t('how2')),
              h('li', null, t('how3')),
            ),
          ),
          section(t('sectionPrivacy'), h('div', { className: 'dshcp-muted' }, t('privacy'))),
        ),
      ),
    );
  }

  const name = 'chatgpt-panel';
  const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'];

  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-chatgpt-panel: dictionaries');
    const t = ctx.locale.bind(NS);
    const source = createPanelSource();
    const settings = createSettings();
    ctx.effect(() => () => source.dispose(), 'dsh-chatgpt-panel: state polling');
    const actions = {
      refresh: () => source.refresh(),
      // The tab type deduplicates within its pane, so this opens it or brings it forward.
      openTab: () => {
        try {
          ctx.sidebarRight.openTab(KIND);
        } catch (error) {
          console.warn(`[dsh-chatgpt-panel] cannot open the tab: ${error?.message ?? error}`);
        }
      },
    };
    const shared = () => ({ t, actions, settings, hooks: { panel: source, settings } });
    ctx.effect(
      () =>
        ctx.sidebarRightTabs.register({
          id: ID,
          kind: KIND,
          title: () => t('tab'),
          guide: [
            {
              id: 'open',
              order: 90,
              title: () => t('title'),
              description: () => t('description'),
            },
          ],
        }),
      'dsh-chatgpt-panel: tab type',
    );
    ctx.slots.inject('sidebar.right.pane.tab', () =>
      ctx.slots.register({ name: 'sidebar.right.pane.tab', key: ID, inject: shared }, PanelTab),
    );
    ctx.slots.inject('conversation.input.right', () =>
      ctx.slots.register(
        { name: 'conversation.input.right', id: ID, order: 10, inject: shared },
        ComposerButton,
      ),
    );
    ctx.slots.inject('main', () =>
      ctx.slots.register({ name: 'main', key: PANEL_ID, inject: shared }, HomePage),
    );
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        { name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => t('title') },
        PanelIcon,
      ),
    );
  }

  return { name, inject, apply };
}
