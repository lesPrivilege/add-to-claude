/** Self-contained ISOLATED-world helper. Only an explicit collection starts a 90s scroll lease. */
function conversationViewport(command = {}) {
  const key = '__gptHandoffCollectionScroll';
  const url = location.href;
  const parsed = new URL(url);
  if (command.expectedUrl !== undefined && command.expectedUrl !== url)
    throw new Error('The selected ChatGPT page changed.');
  if (
    parsed.protocol !== 'https:' ||
    !['chatgpt.com', 'chat.openai.com'].includes(parsed.hostname) ||
    parsed.port ||
    !/^\/(?:c|share)\/[A-Za-z0-9_-]{1,200}\/?$|^\/g\/[A-Za-z0-9_-]{1,200}\/c\/[A-Za-z0-9_-]{1,200}\/?$/u.test(
      parsed.pathname,
    )
  )
    throw new Error('Open the selected ChatGPT conversation.');
  const main = document.querySelector('main, [role="main"]');
  if (!main) throw new Error('The conversation area is no longer available.');
  const visible = (node) => {
    if (!node || node.closest('aside,nav,[aria-hidden="true"],[hidden],[inert]')) return false;
    for (let current = node; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };
  const first =
    Array.from(
      main.querySelectorAll(
        '[data-message-author-role],article[data-testid^="conversation-turn-"]',
      ),
    ).find(visible) ?? main;
  let scroller = null;
  for (let current = first; current && current !== document.body; current = current.parentElement) {
    if (/(auto|scroll)/u.test(getComputedStyle(current).overflowY) && current.clientHeight > 0) {
      scroller = current;
      break;
    }
  }
  scroller ??= document.scrollingElement;
  if (!scroller || !scroller.clientHeight)
    throw new Error('No usable conversation scroll area was found.');
  const path = [];
  for (let current = scroller; current && path.length < 10; current = current.parentElement) {
    if (current.id) {
      path.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter(
          (item) => item.tagName === current.tagName,
        )
      : [current];
    path.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(current) + 1})`);
  }
  const identity = `${url} :: ${path.join(' > ')}`;
  const cleanup = (state) => {
    if (!state) return;
    for (const type of state.events) window.removeEventListener(type, state.listener, true);
    clearTimeout(state.timer);
    if (globalThis[key] === state) delete globalThis[key];
  };
  if (command.begin) {
    cleanup(globalThis[key]);
    const frameTop =
      scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
    const anchor = Array.from(main.querySelectorAll('[data-message-id]')).find(
      (node) =>
        visible(node) &&
        node.getBoundingClientRect().top >= frameTop - 1 &&
        node.getBoundingClientRect().top < frameTop + scroller.clientHeight,
    );
    const state = {
      url,
      identity,
      scroller,
      userIntervened: false,
      anchorId: anchor?.getAttribute('data-message-id'),
      anchorOffset: anchor ? anchor.getBoundingClientRect().top - frameTop : undefined,
      anchorTop: anchor
        ? scroller.scrollTop + anchor.getBoundingClientRect().top - frameTop
        : undefined,
      events: ['wheel', 'touchstart', 'pointerdown', 'keydown'],
    };
    state.listener = (event) => {
      if (!event.isTrusted) return;
      if (
        event.type === 'keydown' &&
        !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
      )
        return;
      state.userIntervened = true;
    };
    for (const type of state.events)
      window.addEventListener(type, state.listener, { capture: true, passive: true });
    state.timer = setTimeout(() => cleanup(state), 90000);
    globalThis[key] = state;
  }
  const state = globalThis[key];
  const sameSession =
    state && state.url === url && state.identity === identity && state.scroller === scroller;
  const result = () => {
    if (sameSession && state.anchorId) {
      const anchor = Array.from(main.querySelectorAll('[data-message-id]')).find(
        (node) => node.getAttribute('data-message-id') === state.anchorId && visible(node),
      );
      if (anchor)
        state.anchorTop =
          scroller.scrollTop +
          anchor.getBoundingClientRect().top -
          (scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top);
    }
    return {
      url,
      identity,
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      atStart: scroller.scrollTop <= 2,
      atEnd: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2,
      pending: Array.from(
        main.querySelectorAll('[role="progressbar"],[data-testid*="loading"],[aria-busy="true"]'),
      ).some(visible),
      userIntervened: Boolean(state?.userIntervened),
    };
  };
  if (command.release) {
    const value = result();
    cleanup(state);
    return { ...value, restored: false };
  }
  if (command.identity !== undefined && command.identity !== identity) {
    if (command.restore) cleanup(state);
    throw new Error('The conversation scroll area changed.');
  }
  if (command.restore) {
    try {
      if (!sameSession || state.userIntervened || !Number.isFinite(command.scrollTop))
        return { ...result(), restored: false };
      result();
      const target =
        Number.isFinite(state.anchorTop) && Number.isFinite(state.anchorOffset)
          ? state.anchorTop - state.anchorOffset
          : command.scrollTop;
      scroller.scrollTo({ top: Math.max(0, target), behavior: 'instant' });
      return {
        ...result(),
        restored:
          Math.abs(
            scroller.scrollTop - Math.min(target, scroller.scrollHeight - scroller.clientHeight),
          ) <= 2,
      };
    } finally {
      cleanup(state);
    }
  }
  if (command.direction) {
    if (!sameSession) throw new Error('The explicit collection scroll session expired.');
    if (state.userIntervened)
      throw new Error('User took control of the conversation scroll position.');
    if (!['up', 'down'].includes(command.direction))
      throw new Error('Unsupported scroll direction.');
    const fraction = Number.isFinite(command.fraction)
      ? Math.min(0.75, Math.max(0.1, command.fraction))
      : 0.5;
    scroller.scrollTo({
      top:
        scroller.scrollTop +
        (command.direction === 'up' ? -1 : 1) * Math.max(1, scroller.clientHeight * fraction),
      behavior: 'instant',
    });
  }
  return result();
}

export const inspectConversationViewport = conversationViewport;
export const scrollConversationViewport = conversationViewport;
