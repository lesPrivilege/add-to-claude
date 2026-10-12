/**
 * Rendered-DOM adapter, tested only against synthetic fixtures. This is deliberately
 * self-contained so Chrome can serialize it into an ISOLATED executeScript world.
 * Selectors are the unstable boundary; never read private API/React state, credentials,
 * scroll, open branch controls, click downloads, or infer that mounted turns are complete.
 */
export async function captureChatGPT(options = {}) {
  const startUrl = location.href;
  if (options.expectedUrl !== undefined && options.expectedUrl !== startUrl)
    throw new Error('The selected ChatGPT page changed. Select the conversation again.');
  const pageUrl = new URL(startUrl);
  const route =
    pageUrl.pathname.match(/^\/(?:c|share)\/([A-Za-z0-9_-]{1,200})\/?$/u) ??
    pageUrl.pathname.match(/^\/g\/[A-Za-z0-9_-]{1,200}\/c\/([A-Za-z0-9_-]{1,200})\/?$/u);
  if (
    pageUrl.protocol !== 'https:' ||
    !['chatgpt.com', 'chat.openai.com'].includes(pageUrl.hostname) ||
    pageUrl.port ||
    pageUrl.username ||
    pageUrl.password ||
    !route
  )
    throw new Error(
      'Open a selected ChatGPT conversation or shared conversation before capturing.',
    );
  const sourceUrl = `${pageUrl.origin}${pageUrl.pathname}`;
  const main = document.querySelector('main, [role="main"]');
  if (!main)
    throw new Error('No conversation area is rendered. Open the conversation and try again.');

  const selectors = {
    role: '[data-message-author-role]',
    article: 'article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]',
    body: '.markdown, [data-message-content], [data-testid="user-message"], .whitespace-pre-wrap',
    controls: 'button, [role="button"]',
    file: '[data-file-id], [data-testid*="attachment"], [data-testid*="file-card"]',
  };
  const MAX_TURNS = 5000;
  const MAX_NODES = 50000;
  const MAX_TEXT = 7 * 1024 * 1024; // Leaves room inside the model's 8 MiB limit for metadata.
  const encoder = new TextEncoder();
  const issues = [];
  const issueKeys = new Set();
  let visited = 0;
  let rawBudget = MAX_TEXT;
  let truncated = false;
  const sourceLocator = (suffix = '') => `${sourceUrl}${suffix}`;
  const issue = (code, message, locator = sourceUrl) => {
    const key = `${code}\u0000${locator}`;
    if (issueKeys.has(key) || issues.length >= 1000) return;
    issueKeys.add(key);
    issues.push({ code, message, sourceLocator: locator });
  };
  const truncate = () => {
    truncated = true;
    issue(
      'snapshot-limit',
      'This rendered snapshot reached its size limit. Use the conversation export to recover the omitted content.',
    );
  };
  const clean = (value) =>
    String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
  const boundedText = (value) => {
    const text = clean(value);
    if (text.length > rawBudget) {
      const prefix = text.slice(0, rawBudget);
      rawBudget = 0;
      truncate();
      return prefix;
    }
    rawBudget -= text.length;
    return text;
  };
  const shortText = (value, maximum = 500) =>
    clean(value).replace(/\s+/gu, ' ').trim().slice(0, maximum);
  const safeId = (value) =>
    typeof value === 'string' &&
    value.trim() &&
    value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/u.test(value);
  const safeUrl = (value) => {
    if (
      typeof value !== 'string' ||
      !value ||
      value.length > 8192 ||
      /[\u0000-\u0020\u007f]/u.test(value)
    )
      return null;
    try {
      const url = new URL(value, sourceUrl);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
        ? url.href
        : null;
    } catch {
      return null;
    }
  };
  const inConversation = (element) =>
    !element.closest(
      'nav, aside, header, footer, [role="navigation"], [data-testid="history-sidebar"]',
    );
  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    if (!inConversation(element)) return false;
    for (
      let current = element;
      current && current !== main.parentElement;
      current = current.parentElement
    ) {
      if (
        current.hidden ||
        current.hasAttribute('inert') ||
        current.getAttribute('aria-hidden') === 'true'
      )
        return false;
      if (current.classList.contains('sr-only')) return false;
      const style = getComputedStyle(current);
      if (
        style.display === 'none' ||
        ['hidden', 'collapse'].includes(style.visibility) ||
        style.contentVisibility === 'hidden' ||
        style.opacity === '0'
      )
        return false;
      if (current.tagName === 'DETAILS' && !current.open) {
        const summary = element.closest('summary');
        if (!summary || summary.parentElement !== current) return false;
      }
    }
    return true;
  };
  const integer = (value) =>
    /^\d{1,7}$/u.test(value ?? '') && Number(value) <= 1000000 ? Number(value) : null;
  const escapeText = (text) => text.replace(/[\\`*_[\]<>]/gu, '\\$&');
  const inlineCode = (text) => {
    let run = 0;
    for (const match of text.matchAll(/`+/gu)) run = Math.max(run, match[0].length);
    const fence = '`'.repeat(run + 1);
    const pad = /^[` ]|[` ]$/u.test(text) ? ' ' : '';
    return `${fence}${pad}${text}${pad}${fence}`;
  };
  const fencedCode = (text, language) => {
    let run = 2;
    for (const match of text.matchAll(/`+/gu)) run = Math.max(run, match[0].length);
    const fence = '`'.repeat(run + 1);
    const info = /^[a-zA-Z0-9_+.#-]{0,64}$/u.test(language) ? language : '';
    return `\n\n${fence}${info}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}\n\n`;
  };
  const plainCode = (node, depth = 0) => {
    if (depth > 80 || ++visited > MAX_NODES) {
      truncate();
      return '';
    }
    if (node.nodeType === Node.TEXT_NODE) return boundedText(node.nodeValue);
    if (
      !(node instanceof Element) ||
      !visible(node) ||
      node.matches('button, [role="button"], script, style, svg')
    )
      return '';
    return Array.from(node.childNodes, (child) => plainCode(child, depth + 1)).join('');
  };
  const render = (node, locator, depth = 0, preserveSpace = false) => {
    if (depth > 80 || ++visited > MAX_NODES || !rawBudget) {
      truncate();
      return '';
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = boundedText(node.nodeValue);
      return escapeText(preserveSpace ? text : text.replace(/\s+/gu, ' '));
    }
    if (!(node instanceof Element) || !visible(node)) return '';
    const tag = node.tagName;
    if (
      node.matches(
        'script, style, template, noscript, button, [role="button"], input, textarea, select, svg, [role="toolbar"]',
      )
    )
      return '';
    if (tag === 'PRE') {
      const code = node.querySelector('code') ?? node;
      const text = plainCode(code);
      const language =
        code.getAttribute('data-language') ??
        code.className.match?.(/(?:^|\s)language-([^\s]+)/u)?.[1] ??
        node.getAttribute('data-language') ??
        '';
      return fencedCode(text, language);
    }
    if (tag === 'CODE') return inlineCode(plainCode(node));
    if (
      ['IMG', 'VIDEO', 'AUDIO', 'IFRAME', 'CANVAS', 'MATH'].includes(tag) ||
      node.classList.contains('katex')
    ) {
      issue(
        'unsupported-rendered-content',
        'An image, media item, formula, or embedded component cannot be reconstructed as text. Review it in the original conversation.',
        locator,
      );
      const label = shortText(
        node.getAttribute('alt') ?? node.getAttribute('aria-label') ?? 'Non-text content',
        300,
      );
      return `[${escapeText(label)}]`;
    }
    const children = () =>
      Array.from(node.childNodes, (child) => render(child, locator, depth + 1, preserveSpace)).join(
        '',
      );
    if (tag === 'BR') return '  \n';
    if (tag === 'HR') return '\n\n---\n\n';
    if (tag === 'UL' || tag === 'OL') {
      let number = integer(node.getAttribute('start')) ?? 1;
      const lines = [];
      for (const child of node.children) {
        if (child.tagName !== 'LI' || !visible(child)) continue;
        const marker = tag === 'OL' ? `${number++}. ` : '- ';
        const content = Array.from(child.childNodes, (part) =>
          render(part, locator, depth + 1, preserveSpace),
        )
          .join('')
          .trim();
        lines.push(`${marker}${content.replace(/\n/gu, `\n${' '.repeat(marker.length)}`)}`);
      }
      return `\n\n${lines.join('\n')}\n\n`;
    }
    if (tag === 'TABLE') {
      const rows = Array.from(node.querySelectorAll('tr')).filter(
        (row) => visible(row) && row.closest('table') === node,
      );
      const values = rows.map((row) =>
        Array.from(row.children)
          .filter((cell) => ['TD', 'TH'].includes(cell.tagName) && visible(cell))
          .map((cell) => {
            if (
              (integer(cell.getAttribute('colspan')) ?? 1) > 1 ||
              (integer(cell.getAttribute('rowspan')) ?? 1) > 1
            )
              issue(
                'table-spans',
                'A table contains merged cells. Its visible text is included; review the original layout.',
                locator,
              );
            return Array.from(cell.childNodes, (part) => render(part, locator, depth + 1))
              .join('')
              .trim()
              .replace(/\|/gu, '\\|')
              .replace(/\s*\n\s*/gu, ' ');
          }),
      );
      if (!values.length) return '';
      const width = Math.max(...values.map((row) => row.length));
      const line = (row) =>
        `| ${Array.from({ length: width }, (_, index) => row[index] ?? '').join(' | ')} |`;
      return `\n\n${line(values[0])}\n${line(Array(width).fill('---'))}\n${values.slice(1).map(line).join('\n')}\n\n`;
    }
    const content = children();
    if (tag === 'A') {
      const href = node.getAttribute('href');
      const url = safeUrl(href);
      if (url) return `[${content.trim() || escapeText(url)}](<${url}>)`;
      if (href?.startsWith('sandbox:/'))
        return `[${content.trim() || 'Attachment'}](${href.replace(/[\s()<>]/gu, (character) => encodeURIComponent(character))})`;
      if (href && !href.startsWith('#'))
        issue(
          'unusable-link',
          'A rendered link cannot be represented as a safe web URL. Open the original turn to inspect it.',
          locator,
        );
      return content;
    }
    if (/^H[1-6]$/u.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${content.trim()}\n\n`;
    if (['STRONG', 'B'].includes(tag)) return `**${content}**`;
    if (['EM', 'I'].includes(tag)) return `*${content}*`;
    if (['DEL', 'S'].includes(tag)) return `~~${content}~~`;
    if (tag === 'BLOCKQUOTE') return `\n\n${content.trim().replace(/^/gmu, '> ')}\n\n`;
    if (
      ['P', 'DIV', 'SECTION', 'ARTICLE', 'FIGURE', 'FIGCAPTION', 'DETAILS', 'SUMMARY'].includes(tag)
    )
      return `\n\n${content.trim()}\n\n`;
    if (
      ![
        'SPAN',
        'SMALL',
        'SUP',
        'SUB',
        'MARK',
        'ABBR',
        'CITE',
        'TIME',
        'A',
        'LI',
        'TD',
        'TH',
      ].includes(tag)
    )
      issue(
        'unknown-rendered-element',
        'An unfamiliar content element was reduced to visible text. Review the original turn for missing structure.',
        locator,
      );
    return content;
  };

  // A scoped observer catches changes to links, download state, formatting and content,
  // including changes while either digest is pending. Drain undelivered records after
  // every awaited window; no live observer or DOM history survives any exit path.
  let mutated = false;
  const observer = new MutationObserver((records) => {
    if (records.length) mutated = true;
  });
  const assertUnchanged = () => {
    if (observer.takeRecords().length) mutated = true;
    if (mutated)
      throw new Error(
        'The rendered conversation changed during capture. Wait for it to settle, confirm the displayed branch, and capture again.',
      );
  };
  try {
    observer.observe(main, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    // Hash only rendered DOM evidence. No application state is inspected. The asynchronous
    // digest also gives pending rendering work a chance to run before the closing check.
    const fingerprint = async () => {
      let budget = MAX_TEXT;
      const roleNodes = Array.from(main.querySelectorAll(selectors.role))
        .slice(0, MAX_TURNS * 2)
        .filter((node) => inConversation(node) && !node.parentElement?.closest(selectors.role));
      const fallbackArticles = Array.from(main.querySelectorAll(selectors.article))
        .slice(0, MAX_TURNS * 2)
        .filter(
          (node) =>
            inConversation(node) &&
            !node.querySelector(selectors.role) &&
            !node.matches(selectors.role),
        );
      const nodes = [...roleNodes, ...fallbackArticles].map((node) => {
        const shown = visible(node);
        const text = shown ? (node.textContent ?? '').slice(0, budget) : '';
        budget -= text.length;
        return [
          node.getAttribute('data-message-id'),
          node.getAttribute('data-message-author-role'),
          node.getAttribute('data-turn'),
          node.getAttribute('data-testid'),
          node.getAttribute('aria-busy'),
          node.getAttribute('data-is-streaming'),
          node.getAttribute('aria-posinset'),
          node.getAttribute('aria-setsize'),
          shown,
          text,
        ];
      });
      const controls = Array.from(main.querySelectorAll(selectors.controls))
        .slice(0, 10000)
        .filter(visible)
        .map((node) => [
          node.getAttribute('aria-label'),
          node.getAttribute('aria-current'),
          node.getAttribute('aria-pressed'),
          node.getAttribute('data-testid'),
          shortText(node.textContent, 200),
          shortText(node.parentElement?.textContent, 200),
        ]);
      const bytes = encoder.encode(
        JSON.stringify([
          main.getAttribute('aria-busy'),
          main.getAttribute('aria-setsize'),
          nodes,
          controls,
        ]),
      );
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      );
    };
    const beforeFingerprint = await fingerprint();
    assertUnchanged();
    if (location.href !== startUrl || !main.isConnected)
      throw new Error('The ChatGPT page changed during capture. Select the conversation again.');

    issue(
      'rendered-snapshot',
      'Only currently rendered turns are captured. Earlier or virtualized turns and original Markdown cannot be verified; use the selected conversation export for a fuller source.',
    );
    const allRoleNodes = Array.from(main.querySelectorAll(selectors.role));
    if (allRoleNodes.length > MAX_TURNS * 2) truncate();
    const candidates = allRoleNodes
      .slice(0, MAX_TURNS * 2)
      .filter((node) => inConversation(node) && !node.parentElement?.closest(selectors.role));
    const hiddenTurns = candidates.filter((node) => !visible(node)).length;
    if (hiddenTurns)
      issue(
        'hidden-turns',
        'Hidden message variants are present and were excluded. This snapshot contains the displayed branch only.',
      );
    const articles = Array.from(main.querySelectorAll(selectors.article)).slice(0, MAX_TURNS * 2);
    for (const article of articles) {
      if (
        !visible(article) ||
        article.querySelector(selectors.role) ||
        article.matches(selectors.role)
      )
        continue;
      const role = article.getAttribute('data-turn');
      if (['user', 'assistant'].includes(role)) candidates.push(article);
      else
        issue(
          'unrecognized-turn',
          'A rendered conversation block has no recognized author role. Review the original conversation to recover it.',
          sourceLocator(` :: ${article.getAttribute('data-testid') ?? 'conversation-block'}`),
        );
    }
    candidates.sort((first, second) =>
      first === second
        ? 0
        : first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1,
    );
    const turns = [];
    const attachments = [];
    const turnIds = new Set();
    const fileKeys = new Set();
    const observedIndices = [];
    let reportedTotal = integer(main.getAttribute('aria-setsize'));
    let renderedBytes = 0;
    let branchControls = false;
    let streaming = visible(main) && main.getAttribute('aria-busy') === 'true';
    for (const control of Array.from(main.querySelectorAll(selectors.controls)).slice(0, 10000)) {
      if (!visible(control)) continue;
      const label = `${control.getAttribute('aria-label') ?? ''} ${control.getAttribute('title') ?? ''} ${control.getAttribute('data-testid') ?? ''} ${shortText(control.textContent, 150)}`;
      if (
        /previous (?:response|answer|branch)|next (?:response|answer|branch)|switch branch|branch-selector|response-pagination|other drafts/iu.test(
          label,
        )
      )
        branchControls = true;
      if (/stop (?:generating|streaming|responding)|stop-button/iu.test(label)) streaming = true;
    }
    const addAttachment = (node, turnId, locator, ordinal) => {
      if (attachments.length >= 1000) {
        truncate();
        return;
      }
      const anchor = node.tagName === 'A' ? node : node.querySelector('a');
      const rawHref = anchor?.getAttribute('href') ?? '';
      const fileCard = node.closest(selectors.file) ?? node;
      const label = shortText(fileCard.getAttribute('aria-label') ?? fileCard.textContent, 600);
      const state = `${fileCard.getAttribute('data-file-status') ?? ''} ${label}`;
      const unusable =
        !rawHref || rawHref.startsWith('#') || anchor?.getAttribute('aria-disabled') === 'true';
      const status = /expired|no longer available/iu.test(state)
        ? 'expired'
        : unusable || /inaccessible|not found|unavailable|access denied/iu.test(state)
          ? 'inaccessible'
          : 'download-needed';
      let name =
        anchor?.getAttribute('download') ||
        fileCard.getAttribute('data-filename') ||
        shortText(anchor?.textContent ?? label, 255);
      if (!name) name = `Attachment ${attachments.length + 1}`;
      name = name
        .replace(/[\\/\u0000-\u001f\u007f]/gu, '_')
        .slice(0, 255)
        .replace(/^\.{1,2}$/u, '_');
      const key = `${turnId}\u0000${rawHref}\u0000${name}`;
      if (fileKeys.has(key)) return;
      fileKeys.add(key);
      const attachment = {
        id: `dom-file-${attachments.length + 1}`,
        name,
        turnId,
        status,
        sourceLocator: `${locator} :: attachment[${ordinal}]`,
      };
      const url = safeUrl(rawHref);
      if (!unusable && url) attachment.url = url;
      attachments.push(attachment);
      issue(
        `attachment-${status}`,
        `${name}: ${status === 'expired' ? 'reopen the source and request a fresh download.' : status === 'inaccessible' ? 'open the original conversation to check access and recover the file.' : 'download it normally from the source and select the file separately; this snapshot contains a reference only.'}`,
        attachment.sourceLocator,
      );
    };
    for (const node of candidates) {
      if (!visible(node)) continue;
      if (turns.length >= MAX_TURNS || visited >= MAX_NODES || rawBudget <= 0) {
        truncate();
        break;
      }
      const role = node.getAttribute('data-message-author-role') ?? node.getAttribute('data-turn');
      if (!['user', 'assistant'].includes(role)) {
        issue(
          'unknown-role',
          'A rendered message has an unsupported author role and was excluded. Review the original turn.',
        );
        continue;
      }
      const article = node.closest(selectors.article) ?? node;
      const testId = article.getAttribute('data-testid');
      const testIndex = testId?.match(/^conversation-turn-(\d+)$/u)?.[1];
      const position = integer(
        article.getAttribute('aria-posinset') ?? node.getAttribute('aria-posinset'),
      );
      const index = integer(testIndex) ?? (position !== null && position > 0 ? position - 1 : null);
      if (index !== null) observedIndices.push(index);
      if (integer(testIndex) !== null && position !== null && position - 1 !== index)
        issue(
          'index-conflict',
          'Rendered turn indices disagree. The observed order is preserved, but missing turns cannot be ruled out.',
        );
      const total = integer(
        article.getAttribute('aria-setsize') ?? node.getAttribute('aria-setsize'),
      );
      if (total !== null) {
        if (reportedTotal !== null && reportedTotal !== total)
          issue(
            'count-conflict',
            'Rendered turn counts disagree. Use the conversation export to check for missing turns.',
          );
        reportedTotal = Math.max(reportedTotal ?? 0, total);
      }
      const rawId = node.getAttribute('data-message-id') ?? article.getAttribute('data-message-id');
      let turnId = safeId(rawId) ? rawId : `dom-turn-${index ?? turns.length}`;
      const locator = safeId(rawId)
        ? sourceLocator(` :: [data-message-id=${JSON.stringify(rawId)}]`)
        : sourceLocator(
            ` :: ${testId ? `[data-testid=${JSON.stringify(testId)}]` : `observed-turn[${turns.length}]`}`,
          );
      if (!safeId(rawId))
        issue(
          'missing-message-id',
          'A rendered turn has no stable message ID. Its observed position is retained; verify it in the original conversation.',
          locator,
        );
      if (turnIds.has(turnId)) {
        issue(
          'duplicate-message-id',
          'Multiple rendered turns share a message ID. Both observed positions are retained; review the source order.',
          locator,
        );
        turnId = `dom-duplicate-${turns.length}`;
      }
      turnIds.add(turnId);
      if (
        node.getAttribute('aria-busy') === 'true' ||
        article.getAttribute('aria-busy') === 'true' ||
        node.getAttribute('data-is-streaming') === 'true' ||
        article.getAttribute('data-is-streaming') === 'true' ||
        Array.from(node.querySelectorAll('[aria-busy="true"], [data-is-streaming="true"]')).some(
          visible,
        )
      )
        streaming = true;
      let bodies = Array.from(node.querySelectorAll(selectors.body)).filter((body) =>
        visible(body),
      );
      bodies = bodies.filter(
        (body) => !bodies.some((other) => other !== body && other.contains(body)),
      );
      if (!bodies.length) {
        bodies = [node];
        issue(
          'unrecognized-content-container',
          'The usual message content container was not found. Visible text was reconstructed; review this turn for missing structure.',
          locator,
        );
      }
      let markdown = bodies
        .map((body) => render(body, locator, 0, /^pre/iu.test(getComputedStyle(body).whiteSpace)))
        .join('\n\n')
        .trim();
      const remaining = MAX_TEXT - renderedBytes;
      if (encoder.encode(markdown).byteLength > remaining) {
        let low = 0,
          high = Math.min(markdown.length, remaining);
        while (low < high) {
          const midpoint = Math.ceil((low + high) / 2);
          if (encoder.encode(markdown.slice(0, midpoint)).byteLength <= remaining) low = midpoint;
          else high = midpoint - 1;
        }
        markdown = markdown.slice(0, low);
        truncate();
      }
      renderedBytes += encoder.encode(markdown).byteLength;
      if (!markdown.trim())
        issue(
          'empty-rendered-turn',
          'This rendered turn has no supported text. Wait for it to load or review its non-text content in the original conversation.',
          locator,
        );
      const citations = [];
      const citationUrls = new Set();
      const links = Array.from(node.querySelectorAll('a')).slice(0, 2000);
      for (const [linkIndex, link] of links.entries()) {
        if (!visible(link)) continue;
        const href = link.getAttribute('href') ?? '';
        const file =
          link.hasAttribute('download') ||
          href.startsWith('sandbox:/') ||
          Boolean(link.closest(selectors.file)) ||
          /\/backend-api\/files\/[^?#]*download/iu.test(href);
        if (file) {
          addAttachment(link, turnId, locator, linkIndex);
          continue;
        }
        const url = safeUrl(href);
        if (url && !citationUrls.has(url) && citations.length < 1000) {
          citationUrls.add(url);
          citations.push({
            url,
            title: shortText(link.getAttribute('title') ?? link.textContent, 2000) || url,
            sourceLocator: `${locator} :: a[${linkIndex}]`,
          });
        } else if (url && citations.length >= 1000) truncate();
      }
      for (const [fileIndex, file] of Array.from(node.querySelectorAll(selectors.file))
        .slice(0, 1000)
        .entries())
        if (visible(file)) addAttachment(file, turnId, locator, links.length + fileIndex);
      for (const control of Array.from(node.querySelectorAll(selectors.controls)).slice(0, 1000)) {
        if (
          visible(control) &&
          /sources?|citations?/iu.test(
            `${control.getAttribute('aria-label') ?? ''} ${control.getAttribute('data-testid') ?? ''} ${shortText(control.textContent, 100)}`,
          )
        )
          issue(
            'unopened-sources',
            'A source or citation control may contain additional links. Open it yourself in the source to inspect them; this capture does not click controls.',
            locator,
          );
      }
      for (const [controlIndex, control] of Array.from(node.querySelectorAll(selectors.controls))
        .slice(0, 1000)
        .entries()) {
        if (!visible(control) || control.closest(selectors.file)) continue;
        const label = `${control.getAttribute('aria-label') ?? ''} ${control.getAttribute('title') ?? ''} ${control.getAttribute('data-testid') ?? ''} ${shortText(control.textContent, 100)}`;
        if (!/\bdownload\b/iu.test(label) || control.parentElement?.querySelector('a[download]'))
          continue;
        if (attachments.length >= 1000) {
          truncate();
          break;
        }
        const media =
          /image/iu.test(label) ||
          Array.from(control.parentElement?.querySelectorAll('img') ?? []).some(visible)
            ? 'image'
            : /audio/iu.test(label)
              ? 'audio'
              : /video/iu.test(label)
                ? 'video'
                : 'file';
        const name = `Downloadable ${media}`;
        const attachmentLocator = `${locator} :: download-control[${controlIndex}]`;
        const status =
          control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true'
            ? 'inaccessible'
            : 'download-needed';
        attachments.push({
          id: `dom-file-${attachments.length + 1}`,
          name,
          turnId,
          status,
          sourceLocator: attachmentLocator,
        });
        issue(
          'unresolved-download',
          `${name} is a display label; its filename and URL are unknown. Use the visible download control normally, then select that file separately.`,
          attachmentLocator,
        );
      }
      turns.push({
        id: turnId,
        role,
        markdown,
        sourceLocator: locator,
        contentFidelity: 'rendered-text',
        ...(safeId(rawId) ? { sourceMessageId: rawId } : {}),
        ...(index !== null ? { renderedIndex: index } : {}),
        citations,
      });
    }
    if (!turns.length)
      throw new Error(
        'No visible user or assistant turns were found. Open the selected conversation, wait for it to render, and try again.',
      );
    if (
      observedIndices.length &&
      (observedIndices[0] > 0 ||
        observedIndices.some(
          (index, position) => position > 0 && index !== observedIndices[position - 1] + 1,
        ))
    )
      issue(
        'missing-indices',
        'Rendered turn indices have a missing beginning, gap, or conflicting order. Use the conversation export to recover the missing turns.',
      );
    if (
      reportedTotal !== null &&
      (reportedTotal > turns.length || observedIndices.some((index) => index >= reportedTotal))
    )
      issue(
        'reported-missing-turns',
        `The page reports ${reportedTotal} turns; ${turns.length} were observed. Use the conversation export to check the missing content.`,
      );
    if (streaming)
      issue(
        'streaming',
        'A response is still generating or loading. Wait for it to finish, then capture again.',
      );
    if (branchControls)
      issue(
        'branch-controls',
        'Branch controls are visible. This snapshot includes the displayed branch only; other variants were not opened.',
      );
    if (location.href !== startUrl)
      throw new Error('The ChatGPT page changed during capture. Select the conversation again.');
    if (
      !main.isConnected ||
      document.querySelector('main, [role="main"]') !== main ||
      (await fingerprint()) !== beforeFingerprint
    )
      throw new Error(
        'The rendered conversation changed during capture. Wait for it to settle, confirm the displayed branch, and capture again.',
      );
    assertUnchanged();
    if (
      location.href !== startUrl ||
      !main.isConnected ||
      document.querySelector('main, [role="main"]') !== main
    )
      throw new Error('The ChatGPT page changed during capture. Select the conversation again.');
    const leaf = turns.at(-1).id;
    const model = {
      schemaVersion: 1,
      source: {
        type: 'dom-snapshot',
        id: route[1],
        title:
          shortText(document.title.replace(/\s*[-–|]\s*ChatGPT\s*$/iu, '')) ||
          'ChatGPT conversation',
        url: sourceUrl,
        locator: sourceUrl,
        capture: {
          capturedAt: new Date().toISOString(),
          observedTurns: turns.length,
          observedIndices,
          ...(reportedTotal !== null ? { reportedTotal } : {}),
          hiddenTurns,
          streaming,
          branchControls,
          truncated,
        },
      },
      turns,
      branches: {
        selectedLeaf: leaf,
        availableLeaves: [{ id: leaf, turnCount: turns.length }],
        selection: 'current-node',
      },
      verification: { status: 'unverified', issues },
      attachments,
    };
    if (encoder.encode(JSON.stringify(model)).byteLength > 8 * 1024 * 1024)
      throw new Error(
        'This rendered snapshot exceeds the 8 MiB transfer limit. Use the selected conversation export instead.',
      );
    assertUnchanged();
    return model;
  } finally {
    observer.disconnect();
  }
}
