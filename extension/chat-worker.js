import { importBrowserResponse } from './chatgpt-response.js';
import { projectMarkdown } from './model.js';
import { createNativeConnection } from './chat-native.js';

export function installChatIntegration(chromeApi) {
  if (!chromeApi.storage?.session) return; // Legacy API-only harnesses do not implement the new Chrome path.
  const popupURL = chromeApi.runtime.getURL('chat.html');
  const hosts = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
  let selection = null,
    source = null,
    revision = crypto.randomUUID(),
    target = null,
    operation = null,
    targetSequence = 0,
    outcome = null,
    sourceSequence = 0,
    recovery = null,
    addSequence = 0;
  const ready = chromeApi.storage.session.get('chatSelection').then((value) => {
    selection = value.chatSelection ?? null;
  });
  const native = createNativeConnection({
    chromeApi,
    revalidate,
    disconnected() {
      target = null;
      operation = null;
      targetSequence++;
    },
  });
  const normalize = (text) => {
    const url = new URL(text);
    if (
      !['https://chatgpt.com', 'https://chat.openai.com'].includes(url.origin) ||
      url.username ||
      url.password
    )
      throw new Error('Choose a ChatGPT page.');
    return url.origin + url.pathname;
  };
  const popup = (sender) =>
    sender?.id === chromeApi.runtime.id && sender.url === popupURL && !sender.tab;
  function selectedSender(sender) {
    return (
      sender?.id === chromeApi.runtime.id &&
      sender.frameId === 0 &&
      typeof sender.documentId === 'string' &&
      sender.tab?.id === selection?.tabId &&
      sender.tab?.windowId === selection?.windowId &&
      (!selection.documentId || selection.documentId === sender.documentId)
    );
  }
  async function sourceSender(sender, newDocument = false) {
    await ready;
    const pinned = selection;
    if (
      sender?.id !== chromeApi.runtime.id ||
      sender.frameId !== 0 ||
      typeof sender.documentId !== 'string' ||
      sender.tab?.id !== pinned?.tabId ||
      sender.tab?.windowId !== pinned?.windowId ||
      (!newDocument && pinned.documentId && pinned.documentId !== sender.documentId)
    )
      return false;
    const tab = await chromeApi.tabs.get(sender.tab.id);
    return selection === pinned && !tab.pendingUrl && normalize(sender.url) === normalize(tab.url);
  }
  async function inspect(identity) {
    const tab = await chromeApi.tabs.get(identity.tabId);
    if (tab.pendingUrl || tab.windowId !== identity.windowId || normalize(tab.url) !== identity.url)
      throw new Error('The selected chat changed.');
    const [frame] = await chromeApi.scripting.executeScript({
      target: { tabId: identity.tabId, frameIds: [0] },
      world: 'ISOLATED',
      func: () => location.href,
    });
    if (frame?.documentId !== identity.documentId || normalize(frame.result) !== identity.url)
      throw new Error('The selected document changed.');
    return true;
  }
  function invalidate(advanceReceipt = true) {
    if (advanceReceipt) sourceSequence++;
    revision = crypto.randomUUID();
    source = null;
    outcome = null;
    if (operation) {
      operation = null;
      target = null;
      void native.request('cancel').catch(() => {});
    }
  }
  function receipt() {
    const order = ++sourceSequence;
    invalidate(false);
    return { order, revision };
  }
  async function accept(packet, sender, token) {
    if (
      !(await sourceSender(sender)) ||
      sourceSequence !== token.order ||
      revision !== token.revision
    )
      return false;
    if (
      !packet ||
      new TextEncoder().encode(JSON.stringify(packet)).byteLength > 16 * 1024 * 1024 ||
      normalize(packet.pageUrl) !== normalize(sender.url)
    )
      throw new Error('Invalid selected-source packet.');
    if (packet.kind !== 'response') return true;
    const model = importBrowserResponse(packet.body, packet);
    if (
      Date.now() - Date.parse(packet.capturedAt) > 15 * 60_000 ||
      Date.parse(packet.capturedAt) > Date.now() + 1000
    )
      throw new Error('The source capture expired.');
    const identity = {
      ...selection,
      documentId: sender.documentId,
      url: normalize(packet.pageUrl),
    };
    const stamp = revision;
    await inspect(identity);
    if (revision !== stamp || sourceSequence !== token.order) return false;
    const markdown = projectMarkdown(model);
    if (new TextEncoder().encode(markdown).byteLength > 16 * 1024 * 1024)
      throw new Error('The source exceeds the context limit.');
    selection = { ...selection, documentId: sender.documentId };
    source = { identity, model, markdown };
    return true;
  }
  async function beginDocument(sender) {
    if (!(await sourceSender(sender, true))) return { allowed: false };
    const identity = {
      tabId: sender.tab.id,
      windowId: sender.tab.windowId,
      documentId: sender.documentId,
      url: normalize(sender.url),
    };
    await inspect(identity);
    if (selection?.tabId !== sender.tab.id || selection?.windowId !== sender.tab.windowId)
      return { allowed: false };
    if (selection.documentId === sender.documentId) return { allowed: true };
    invalidate();
    selection = {
      tabId: sender.tab.id,
      windowId: sender.tab.windowId,
      documentId: sender.documentId,
    };
    await chromeApi.storage.session.set({
      chatSelection: { tabId: selection.tabId, windowId: selection.windowId },
    });
    await chromeApi.tabs.sendMessage(
      sender.tab.id,
      { type: 'chatStart' },
      { documentId: sender.documentId },
    );
    await chromeApi.scripting.executeScript({
      target: { tabId: sender.tab.id, documentIds: [sender.documentId] },
      world: 'MAIN',
      files: ['chat-observer.js'],
    });
    return { allowed: true };
  }
  async function revalidate(message) {
    const frozen = operation;
    if (
      !frozen ||
      frozen.id !== message.operationId ||
      frozen.revision !== message.revision ||
      frozen.hash !== message.hash ||
      revision !== frozen.revision ||
      target?.token !== frozen.targetToken ||
      source !== frozen.source
    )
      return false;
    await inspect(frozen.source.identity);
    return (
      operation === frozen &&
      source === frozen.source &&
      revision === frozen.revision &&
      target?.token === frozen.targetToken
    );
  }
  function state() {
    return {
      enabled: Boolean(selection),
      ready: Boolean(source),
      revision,
      target,
      outcome,
      verification: source?.model.verification,
      turns: source?.model.turns.length ?? 0,
      files: source?.model.attachments.length ?? 0,
      canAdd: Boolean(
        source &&
          target &&
          !operation &&
          source.model.verification.status === 'verified' &&
          new TextEncoder().encode(source.markdown).byteLength <= 2 * 1024 * 1024,
      ),
    };
  }
  async function activeTab() {
    const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.pendingUrl) throw new Error('Open the intended Chrome ChatGPT window first.');
    normalize(tab.url);
    return tab;
  }
  async function requireSelectedTab() {
    const tab = await activeTab();
    if (tab.id !== selection?.tabId || tab.windowId !== selection?.windowId)
      throw new Error('Enable Handoff for this chat window first.');
  }
  async function recover() {
    if (source || !selection || selection.documentId) return;
    if (recovery) return recovery;
    const task = (async () => {
      const token = receipt();
      const tab = await chromeApi.tabs.get(selection.tabId);
      const [frame] = await chromeApi.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        world: 'ISOLATED',
        func: () => location.href,
      });
      const result = await chromeApi.tabs
        .sendMessage(tab.id, { type: 'chatReplay' }, { documentId: frame.documentId })
        .catch(() => null);
      if (result?.packet)
        await accept(
          result.packet,
          {
            id: chromeApi.runtime.id,
            tab,
            frameId: 0,
            documentId: frame.documentId,
            url: frame.result,
          },
          token,
        );
    })();
    recovery = task;
    try {
      await task;
    } finally {
      if (recovery === task) recovery = null;
    }
  }
  const actions = {
    async chatEnable() {
      if (!(await chromeApi.permissions.contains({ origins: hosts })))
        throw new Error('Allow access to the selected ChatGPT page first.');
      const tab = await activeTab();
      const scripts = await chromeApi.scripting.getRegisteredContentScripts({
        ids: ['handoff-selected-bootstrap'],
      });
      if (!scripts.length)
        await chromeApi.scripting.registerContentScripts([
          {
            id: 'handoff-selected-bootstrap',
            matches: hosts,
            js: ['chat-source.js'],
            runAt: 'document_start',
            allFrames: false,
            world: 'ISOLATED',
          },
        ]);
      if (selection)
        await chromeApi.tabs.sendMessage(selection.tabId, { type: 'chatStop' }).catch(() => {});
      invalidate();
      target = null;
      selection = { tabId: tab.id, windowId: tab.windowId };
      await chromeApi.storage.session.set({ chatSelection: selection });
      await chromeApi.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        world: 'ISOLATED',
        files: ['chat-source.js'],
      });
      const [frame] = await chromeApi.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        world: 'ISOLATED',
        func: () => location.href,
      });
      await beginDocument({
        id: chromeApi.runtime.id,
        tab,
        frameId: 0,
        documentId: frame.documentId,
        url: frame.result,
      });
      await chromeApi.tabs.sendMessage(
        tab.id,
        { type: 'chatStart' },
        { documentId: frame.documentId },
      );
      return state();
    },
    async chatStatus() {
      await requireSelectedTab();
      await recover();
      return state();
    },
    async chatPreview() {
      await requireSelectedTab();
      const selected = source;
      if (!selected)
        throw new Error('Open a conversation normally to prepare its original messages.');
      await inspect(selected.identity);
      if (source !== selected) throw new Error('The source changed.');
      return { ...state(), markdown: selected.markdown };
    },
    async chatTargets() {
      await requireSelectedTab();
      targetSequence++;
      if (operation) throw new Error('Finish the current handoff first.');
      target = null;
      return await native.request('targets');
    },
    async chatSelect(message) {
      await requireSelectedTab();
      if (operation) throw new Error('Finish the current handoff first.');
      target = null;
      const sequence = ++targetSequence;
      const result = await native.request('select', { targetId: message.targetId });
      if (!result.ok) throw new Error(result.error);
      if (sequence !== targetSequence) throw new Error('The target selection changed.');
      target = { token: result.targetToken, name: result.name };
      return state();
    },
    async chatAccess() {
      await requireSelectedTab();
      return await native.request('access');
    },
    async chatAdd() {
      if (!state().canAdd)
        throw new Error('Choose a composer and wait for verified current context.');
      const frozen = {
        id: crypto.randomUUID(),
        sequence: ++addSequence,
        source,
        revision,
        targetToken: target.token,
      };
      operation = frozen;
      try {
        await requireSelectedTab();
        await inspect(frozen.source.identity);
        frozen.hash = [
          ...new Uint8Array(
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode(frozen.source.markdown)),
          ),
        ]
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('');
        if (
          operation !== frozen ||
          source !== frozen.source ||
          revision !== frozen.revision ||
          target?.token !== frozen.targetToken
        )
          throw new Error('Source or target changed. Nothing was added.');
        const result = await native.request(
          'append',
          {
            text: frozen.source.markdown,
            targetToken: frozen.targetToken,
            revision: frozen.revision,
            hash: frozen.hash,
          },
          frozen.id,
        );
        if (frozen.sequence === addSequence)
          outcome = {
            id: frozen.id,
            inserted: result.inserted === true,
            message: result.message || result.error || 'Insertion not verified; inspect the draft.',
          };
        return result;
      } catch (error) {
        if (frozen.sequence === addSequence)
          outcome = {
            id: frozen.id,
            inserted: false,
            message: error.message || 'Insertion not verified; inspect the draft.',
          };
        throw error;
      } finally {
        if (operation === frozen) {
          operation = null;
          target = null;
        }
      }
    },
    async chatCancel() {
      operation = null;
      target = null;
      return await native.request('cancel');
    },
  };
  chromeApi.runtime.onMessage.addListener((message, sender, reply) => {
    if (['chatHello', 'chatSource'].includes(message?.type)) {
      const task = ready.then(() => {
        if (message.type === 'chatHello') return beginDocument(sender);
        if (!selectedSender(sender)) return { accepted: false };
        const token = receipt(); // Revoke the old source/permit before the first async page check.
        return accept(message.packet, sender, token).then((accepted) => ({ accepted }));
      });
      task.then(reply, () => reply({ allowed: false, accepted: false }));
      return true;
    }
    if (!popup(sender) || !Object.hasOwn(actions, message?.type)) return false;
    ready
      .then(() => actions[message.type](message))
      .then(
        (value) => reply({ ok: true, ...value }),
        (error) => reply({ ok: false, error: error.message || 'Handoff unavailable.' }),
      );
    return true;
  });
  chromeApi.tabs.onRemoved.addListener((tabId) => {
    if (selection?.tabId === tabId) {
      invalidate();
      selection = null;
      target = null;
      void chromeApi.storage.session.remove('chatSelection');
      native.disconnect();
    }
  });
  chromeApi.tabs.onUpdated.addListener((tabId, change) => {
    if (selection?.tabId === tabId && (change.url || change.status === 'loading')) invalidate();
  });
  chromeApi.permissions.onRemoved.addListener(() => {
    void chromeApi.permissions.contains({ origins: hosts }).then(async (allowed) => {
      if (allowed) return;
      if (selection)
        await chromeApi.tabs.sendMessage(selection.tabId, { type: 'chatStop' }).catch(() => {});
      invalidate();
      selection = null;
      target = null;
      await chromeApi.storage.session.remove('chatSelection');
      native.disconnect();
    });
  });
}
