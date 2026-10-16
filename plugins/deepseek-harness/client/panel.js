// The DeepSeek Harness client half: a right-sidebar tab with the ChatGPT window's status, an Open
// control, and Add, which appends the prepared conversation to this session's draft. It never
// submits. The build turns this file into a module-loader factory; `require` is the loader's, and
// React comes from the host's shared module table.
//
// The shared append helpers (shared/append.js) are inlined ahead of this file by the build.

export function createClient(require) {
  const React = require('react');
  const h = React.createElement;
  const { useEffect, useRef, useState } = React;

  const ID = 'dsh-chatgpt-panel';
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
    open: 'Open ChatGPT',
    show: 'Show ChatGPT window',
    pin: 'Keep the ChatGPT window on top',
    windowVisible: 'ChatGPT window open',
    windowHidden: 'ChatGPT window hidden',
    windowStopped: 'ChatGPT window closed',
    unavailable: 'The ChatGPT window cannot start: {reason}',
    waiting: 'Open a conversation in the ChatGPT window.',
    unreadable: 'This conversation could not be read: {message}',
    counts: '{turns} turns · {files} files',
    saved: '{saved} of {files} files saved',
    verified: 'Verified',
    partial: 'Partial',
    verifiedWithFiles: 'Verified once its files are saved',
    downloadFiles: 'Download files on Add',
    add: 'Add to composer',
    adding: 'Preparing…',
    appended: 'Added to the end of the draft. Nothing was sent.',
    set: 'Added to the draft. Nothing was sent.',
    busy: 'The composer is busy. Add again when it is idle.',
    changed: 'The draft changed while adding. Click Add again.',
    failed: '{message}',
    offline: 'The panel is not reachable ({status}).',
  };
  const zh = {
    tab: 'ChatGPT',
    title: 'ChatGPT 面板',
    description: '把 ChatGPT 对话拉进 DeepSeek Harness。',
    tagline: '在 ChatGPT 里聊透，在 DeepSeek Harness 里完成。',
    open: '打开 ChatGPT',
    show: '显示 ChatGPT 窗口',
    pin: 'ChatGPT 窗口置顶',
    windowVisible: 'ChatGPT 窗口已打开',
    windowHidden: 'ChatGPT 窗口已隐藏',
    windowStopped: 'ChatGPT 窗口已关闭',
    unavailable: 'ChatGPT 窗口无法启动：{reason}',
    waiting: '请在 ChatGPT 窗口中打开一段对话。',
    unreadable: '无法读取这段对话：{message}',
    counts: '{turns} 轮 · {files} 个文件',
    saved: '已保存 {saved}/{files} 个文件',
    verified: 'Verified',
    partial: 'Partial',
    verifiedWithFiles: '文件保存后即为 Verified',
    downloadFiles: 'Add 时下载文件',
    add: '添加到输入框',
    adding: '正在准备…',
    appended: '已追加到草稿末尾，没有发送。',
    set: '已放入草稿，没有发送。',
    busy: '输入框正忙，请在空闲时再添加。',
    changed: '添加时草稿发生了变化，请再点一次 Add。',
    failed: '{message}',
    offline: '无法连接面板（{status}）。',
  };

  /** Polls the host's panel state while a tab shows it; a getSnapshot/subscribe source. */
  function createPanelSource() {
    let snapshot = { phase: 'loading' };
    const listeners = new Set();
    let timer = null;
    let generation = 0;
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
      publish(next);
      timer = setTimeout(() => void poll(mine), 1000);
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

  const styles = `
.dshcp{display:flex;flex-direction:column;gap:12px;padding:16px;height:100%;overflow:auto;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dshcp-tagline{color:var(--dsw-alias-label-secondary)}
.dshcp-card{display:flex;flex-direction:column;gap:6px;padding:12px;border-radius:12px;background:var(--dsw-alias-settings-card-fill);border:0.5px solid var(--dsw-alias-settings-card-stroke)}
.dshcp-title{font-weight:500;overflow-wrap:anywhere}
.dshcp-muted{color:var(--dsw-alias-label-tertiary)}
.dshcp-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshcp-badge{padding:0 8px;border-radius:999px;corner-shape:round;font-size:12px;line-height:20px}
.dshcp-verified{color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-tertiary)}
.dshcp-partial{color:var(--dsw-alias-state-warn-label);background:var(--dsw-alias-state-warn-tertiary)}
.dshcp-issues{margin:0;padding-left:18px;color:var(--dsw-alias-label-secondary)}
.dshcp button{font:inherit;padding:6px 12px;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}
.dshcp button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshcp button.dshcp-primary{border:0;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted)}
.dshcp button.dshcp-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dshcp button:disabled{opacity:.5;cursor:default}
.dshcp label{display:flex;align-items:center;gap:6px;cursor:pointer}
.dshcp-error{color:var(--dsw-alias-state-error-primary)}
`;

  function Panel({ usePanel, useInput, inputActions, t, actions }) {
    const panel = usePanel((value) => value);
    const input = useInput((value) => value);
    const latest = useRef(input);
    latest.current = input;
    const [downloadFiles, setDownloadFiles] = useState(true);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState(null);
    useEffect(() => {
      if (document.getElementById('dshcp-style')) return;
      const style = document.createElement('style');
      style.id = 'dshcp-style';
      style.textContent = styles;
      document.head.append(style);
    }, []);

    const run = async (task) => {
      setNotice(null);
      try {
        await task();
      } catch (error) {
        setNotice({ error: true, text: t('failed', { message: error?.message || String(error) }) });
      } finally {
        actions.refresh();
      }
    };
    const add = () => {
      setBusy(true);
      void run(async () => {
        const { markdown, note } = await post(ROUTES.add, { downloadFiles });
        const outcome = appendToComposer(inputActions, latest.current, markdown);
        const ok = outcome === 'appended' || outcome === 'set';
        setNotice({ error: !ok, text: [t(outcome), ok ? note : ''].filter(Boolean).join(' ') });
      }).finally(() => setBusy(false));
    };

    if (panel.phase === 'loading') return h('div', { className: 'dshcp' });
    if (panel.phase === 'offline')
      return h(
        'div',
        { className: 'dshcp' },
        h('div', { className: 'dshcp-error' }, t('offline', { status: String(panel.status) })),
      );

    const running = panel.helper === 'running';
    const windowLine =
      panel.helper === 'unavailable'
        ? t('unavailable', { reason: panel.reason || '' })
        : !running
          ? t('windowStopped')
          : panel.visible
            ? t('windowVisible')
            : t('windowHidden');
    const conversation = running && panel.source === 'ready' ? panel.conversation : null;

    return h(
      'div',
      { className: 'dshcp' },
      h('div', { className: 'dshcp-tagline' }, t('tagline')),
      h(
        'div',
        { className: 'dshcp-row' },
        h(
          'button',
          {
            type: 'button',
            disabled: panel.helper === 'unavailable',
            onClick: () => void run(() => post(ROUTES.open)),
          },
          running ? t('show') : t('open'),
        ),
        h(
          'label',
          null,
          h('input', {
            type: 'checkbox',
            checked: Boolean(panel.pinned),
            disabled: !running,
            onChange: (event) => void run(() => post(ROUTES.pin, { on: event.target.checked })),
          }),
          t('pin'),
        ),
      ),
      h('div', { className: 'dshcp-muted' }, windowLine),
      running
        ? h(
            'div',
            { className: 'dshcp-card' },
            conversation
              ? [
                  h('div', { key: 'title', className: 'dshcp-title' }, conversation.title),
                  h(
                    'div',
                    { key: 'counts', className: 'dshcp-row' },
                    h(
                      'span',
                      null,
                      t('counts', { turns: conversation.turns, files: conversation.files }),
                    ),
                    h(
                      'span',
                      {
                        className: `dshcp-badge ${conversation.verification === 'verified' ? 'dshcp-verified' : 'dshcp-partial'}`,
                      },
                      conversation.verification === 'verified' ? t('verified') : t('partial'),
                    ),
                  ),
                  conversation.files > 0
                    ? h(
                        'div',
                        { key: 'saved', className: 'dshcp-muted' },
                        t('saved', { saved: conversation.saved, files: conversation.files }),
                        conversation.verification !== 'verified' && conversation.verifiedWithFiles
                          ? ` · ${t('verifiedWithFiles')}`
                          : '',
                      )
                    : null,
                  conversation.issues.length
                    ? h(
                        'ul',
                        { key: 'issues', className: 'dshcp-issues' },
                        conversation.issues.map((issue, index) => h('li', { key: index }, issue)),
                      )
                    : null,
                ]
              : h(
                  'div',
                  { className: 'dshcp-muted' },
                  panel.source === 'unavailable'
                    ? t('unreadable', { message: panel.message })
                    : t('waiting'),
                ),
          )
        : null,
      h(
        'label',
        null,
        h('input', {
          type: 'checkbox',
          checked: downloadFiles,
          onChange: (event) => setDownloadFiles(event.target.checked),
        }),
        t('downloadFiles'),
      ),
      h(
        'div',
        { className: 'dshcp-row' },
        h(
          'button',
          {
            type: 'button',
            className: 'dshcp-primary',
            disabled: !conversation || busy,
            onClick: add,
          },
          busy ? t('adding') : t('add'),
        ),
      ),
      notice
        ? h(
            'div',
            { className: notice.error ? 'dshcp-error' : 'dshcp-muted', role: 'status' },
            notice.text,
          )
        : null,
    );
  }

  const name = 'chatgpt-panel';
  const inject = ['slots', 'locale', 'sidebarRightTabs'];

  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-chatgpt-panel: dictionaries');
    const t = ctx.locale.bind(NS);
    const source = createPanelSource();
    ctx.effect(() => () => source.dispose(), 'dsh-chatgpt-panel: state polling');
    const actions = { refresh: () => source.refresh() };
    ctx.effect(
      () =>
        ctx.sidebarRightTabs.register({
          id: ID,
          kind: 'chatgpt-panel',
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
    ctx.effect(
      () =>
        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.pane.tab',
              key: ID,
              inject: () => ({ t, actions, hooks: { panel: source } }),
            },
            Panel,
          ),
        ),
      'dsh-chatgpt-panel: tab body',
    );
  }

  return { name, inject, apply };
}
