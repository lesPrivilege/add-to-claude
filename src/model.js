/** The portable data boundary. No browser, filesystem, network or shell access. */
export const LIMITS = Object.freeze({
  maxTextBytes: 8 * 1024 * 1024,
  maxImportBytes: 64 * 1024 * 1024,
  maxTurns: 5000,
  maxNodes: 20000,
  maxConversations: 10000,
  maxAttachments: 1000,
  maxAttachmentBytes: 25 * 1024 * 1024,
});

const encoder = new TextEncoder();
const sourceTypes = new Set([
  'chatgpt-export',
  'chatgpt-response',
  'dom-snapshot',
  'synthetic',
  'imported',
]);
const fidelities = new Set(['original-markdown', 'rendered-text', 'partial']);
const attachmentStates = new Set(['download-needed', 'inaccessible', 'expired', 'available']);
const statuses = new Set(['verified', 'partial', 'unverified']);
const selections = new Set(['current-node', 'explicit', 'single-path']);

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} must be an object.`);
  return value;
}

function string(value, label, max = 2048, { empty = false } = {}) {
  if (
    typeof value !== 'string' ||
    (!empty && !value.trim()) ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(
      `${label} must be ${empty ? '' : 'nonempty '}text of at most ${max} characters, without control characters.`,
    );
  }
  return value;
}

function id(value, label) {
  const result = string(value, label, 512);
  if (/[\r\n\t]/u.test(result)) throw new TypeError(`${label} cannot contain line breaks or tabs.`);
  return result;
}

function array(value, label, max) {
  if (!Array.isArray(value) || value.length > max)
    throw new TypeError(`${label} must be an array of at most ${max} items.`);
  return value;
}

/** Return an absolute HTTP(S) URL, or null. Credentials and active/file schemes are rejected. */
export function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f]/u.test(value))
    return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function optionalUrl(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const result = safeUrl(value);
  if (!result) throw new TypeError(`${label} must be an HTTP(S) URL without credentials.`);
  return result;
}

/** Validate and copy a schemaVersion: 1 conversation, dropping unknown properties. Throws on invalid input. */
export function validateConversation(data) {
  record(data, 'Conversation');
  if (data.schemaVersion !== 1)
    throw new TypeError('Unsupported conversation schema. Expected schemaVersion: 1.');
  const inputSource = record(data.source, 'Source');
  if (!sourceTypes.has(inputSource.type))
    throw new TypeError('Unsupported conversation source type.');
  const source = {
    type: inputSource.type,
    id: id(inputSource.id, 'Source ID'),
    title: string(inputSource.title, 'Title', 500),
    locator: string(inputSource.locator, 'Source locator'),
  };
  const url = optionalUrl(inputSource.url, 'Source URL');
  if (url) source.url = url;
  if (inputSource.excludedMessages !== undefined) {
    if (
      !Number.isSafeInteger(inputSource.excludedMessages) ||
      inputSource.excludedMessages < 0 ||
      inputSource.excludedMessages > LIMITS.maxNodes
    )
      throw new TypeError('Excluded internal-message count is outside the supported bound.');
    source.excludedMessages = inputSource.excludedMessages;
  }
  if (source.type === 'chatgpt-response' || inputSource.response !== undefined) {
    const response = record(inputSource.response, 'Original response evidence');
    if (source.type !== 'chatgpt-response' || !source.url)
      throw new TypeError('Original response evidence requires a browser response source.');
    const page = new URL(source.url);
    const responseMethod = response.method ?? 'GET';
    const pageId = /^\/(?:g\/[A-Za-z0-9_-]{1,200}\/)?c\/([A-Za-z0-9_-]{1,200})\/?$/u.exec(
      page.pathname,
    )?.[1];
    if (
      page.protocol !== 'https:' ||
      !['chatgpt.com', 'chat.openai.com'].includes(page.hostname) ||
      page.port ||
      pageId !== source.id ||
      !['GET', 'POST'].includes(responseMethod) ||
      (responseMethod === 'GET' &&
        response.url !== `${page.origin}/backend-api/conversation/${source.id}` &&
        String(response.url).split('?')[0] !==
          `${page.origin}/backend-api/conversations/${source.id}`) ||
      (responseMethod === 'POST' &&
        ![
          `${page.origin}/backend-api/conversation`,
          `${page.origin}/backend-api/f/conversation`,
        ].includes(response.url))
    )
      throw new TypeError('Original response evidence must match the selected conversation.');
    if (
      typeof response.capturedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(response.capturedAt) ||
      !Number.isFinite(Date.parse(response.capturedAt)) ||
      new Date(response.capturedAt).toISOString() !== response.capturedAt ||
      !Number.isSafeInteger(response.observedNodes) ||
      response.observedNodes < 1 ||
      response.observedNodes > LIMITS.maxNodes
    )
      throw new TypeError('Original response evidence needs a valid time and bounded node count.');
    source.response = {
      url: response.url,
      capturedAt: response.capturedAt,
      observedNodes: response.observedNodes,
    };
    if (response.webSocket !== undefined) {
      const socket = record(response.webSocket, 'WebSocket source evidence');
      if (
        responseMethod !== 'POST' ||
        socket.origin !== 'wss://ws.chatgpt.com' ||
        typeof socket.topic !== 'string' ||
        !/^conversation-turn-[A-Za-z0-9_-]{1,200}$/u.test(socket.topic) ||
        socket.coverage !== 'unverified-replay' ||
        typeof socket.terminalObserved !== 'boolean'
      )
        throw new TypeError(
          'WebSocket evidence must identify an observed turn topic with explicit coverage.',
        );
      source.response.webSocket = {
        origin: socket.origin,
        topic: socket.topic,
        coverage: socket.coverage,
        terminalObserved: socket.terminalObserved,
      };
    }
    if (responseMethod === 'POST') {
      if (
        !['observed-response', 'new-conversation', 'partial-history'].includes(response.coverage) ||
        typeof response.streamCompleted !== 'boolean'
      )
        throw new TypeError('Observed stream evidence requires explicit coverage and completion.');
      const requestMessageIds = array(
        response.requestMessageIds,
        'Observed request message IDs',
        LIMITS.maxNodes,
      ).map((value) => id(value, 'Observed request message ID'));
      if (new Set(requestMessageIds).size !== requestMessageIds.length)
        throw new TypeError('Observed request message IDs must be unique.');
      Object.assign(source.response, {
        method: 'POST',
        coverage: response.coverage,
        streamCompleted: response.streamCompleted,
        requestMessageIds,
      });
    }
  }
  let bytes = 0;
  const count = (value) => {
    bytes += encoder.encode(value).byteLength;
    if (bytes > LIMITS.maxTextBytes)
      throw new RangeError('Selected conversation exceeds the 8 MiB text limit.');
    return value;
  };
  count(source.title);
  const turnIds = new Set();
  const turns = array(data.turns, 'Turns', LIMITS.maxTurns).map((item, index) => {
    const turn = record(item, `Turn ${index + 1}`);
    const turnId = id(turn.id, 'Turn ID');
    if (turnIds.has(turnId)) throw new TypeError(`Duplicate turn ID: ${turnId}`);
    turnIds.add(turnId);
    if (!['user', 'assistant'].includes(turn.role))
      throw new TypeError('Turn role must be user or assistant.');
    if (!fidelities.has(turn.contentFidelity))
      throw new TypeError('Turn content fidelity is required.');
    const markdown = count(
      string(turn.markdown, 'Turn Markdown', LIMITS.maxTextBytes, { empty: true }),
    );
    const output = {
      id: turnId,
      role: turn.role,
      markdown,
      sourceLocator: string(turn.sourceLocator, 'Turn source locator'),
      contentFidelity: turn.contentFidelity,
    };
    if (turn.renderedIndex !== undefined) {
      if (
        !Number.isInteger(turn.renderedIndex) ||
        turn.renderedIndex < 0 ||
        turn.renderedIndex > 1000000
      )
        throw new TypeError('Rendered turn index must be a bounded nonnegative integer.');
      output.renderedIndex = turn.renderedIndex;
    }
    if (turn.sourceMessageId !== undefined)
      output.sourceMessageId = id(turn.sourceMessageId, 'Rendered source message ID');
    // The source's raw text parts, as stored. `markdown` is their readable form: the same text
    // with ChatGPT's rendering markup (citation markers, layout tags) resolved.
    if (turn.originalParts !== undefined)
      output.originalParts = array(turn.originalParts, 'Original text parts', 10000).map((part) =>
        string(part, 'Original text part', LIMITS.maxTextBytes, { empty: true }),
      );
    if (turn.code !== undefined) {
      record(turn.code, 'Structured code');
      const language = count(string(turn.code.language, 'Code language', 128, { empty: true }));
      if (/[\r\n\t]/u.test(language))
        throw new TypeError('Code language must be a single-line label.');
      const sourceText = string(turn.code.sourceText, 'Original code text', LIMITS.maxTextBytes, {
        empty: true,
      });
      if (sourceText !== markdown)
        throw new TypeError('Original code text must match the preserved turn text.');
      output.code = { language, sourceText };
      // Structured code is faithfully retained as data, but its fenced Markdown projection is a conversion.
      output.contentFidelity = 'partial';
    }
    output.citations = array(turn.citations ?? [], 'Citations', 1000).map((citation) => {
      record(citation, 'Citation');
      const result = {
        url: optionalUrl(citation.url, 'Citation URL'),
        title: count(string(citation.title ?? citation.url, 'Citation title', 2000)),
        sourceLocator: string(citation.sourceLocator, 'Citation locator'),
      };
      if (!result.url) throw new TypeError('Citation URL is required.');
      return result;
    });
    return output;
  });
  if (inputSource.capture !== undefined) {
    const capture = record(inputSource.capture, 'Capture evidence');
    if (source.type !== 'dom-snapshot')
      throw new TypeError('Capture evidence requires a DOM snapshot source.');
    if (
      typeof capture.capturedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(capture.capturedAt) ||
      !Number.isFinite(Date.parse(capture.capturedAt)) ||
      new Date(capture.capturedAt).toISOString() !== capture.capturedAt
    )
      throw new TypeError('Capture time must be an ISO UTC timestamp.');
    if (capture.observedTurns !== turns.length)
      throw new TypeError('Capture evidence must match the number of observed turns.');
    const observedIndices = array(
      capture.observedIndices,
      'Observed turn indices',
      LIMITS.maxTurns,
    ).map((value) => {
      if (!Number.isInteger(value) || value < 0 || value > 1000000)
        throw new TypeError('Observed turn indices must be bounded nonnegative integers.');
      return value;
    });
    if (observedIndices.length > turns.length)
      throw new TypeError('Capture evidence contains too many turn indices.');
    if (
      !Number.isInteger(capture.hiddenTurns) ||
      capture.hiddenTurns < 0 ||
      capture.hiddenTurns > LIMITS.maxNodes
    )
      throw new TypeError('Hidden turn evidence is outside the supported bound.');
    for (const key of ['streaming', 'branchControls', 'truncated'])
      if (typeof capture[key] !== 'boolean')
        throw new TypeError(`Capture ${key} must be a boolean.`);
    source.capture = {
      capturedAt: capture.capturedAt,
      observedTurns: capture.observedTurns,
      observedIndices,
      hiddenTurns: capture.hiddenTurns,
      streaming: capture.streaming,
      branchControls: capture.branchControls,
      truncated: capture.truncated,
    };
    if (capture.reportedTotal !== undefined) {
      if (
        !Number.isInteger(capture.reportedTotal) ||
        capture.reportedTotal < 0 ||
        capture.reportedTotal > 1000000
      )
        throw new TypeError('Reported turn count is outside the supported bound.');
      source.capture.reportedTotal = capture.reportedTotal;
    }
  }
  if (inputSource.collection !== undefined) {
    const collection = record(inputSource.collection, 'Collection evidence');
    if (source.type !== 'dom-snapshot')
      throw new TypeError('Collection evidence requires a DOM snapshot source.');
    for (const key of ['startedAt', 'finishedAt'])
      if (
        typeof collection[key] !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(collection[key]) ||
        !Number.isFinite(Date.parse(collection[key])) ||
        new Date(collection[key]).toISOString() !== collection[key]
      )
        throw new TypeError('Collection times must be ISO UTC timestamps.');
    for (const [key, maximum] of [
      ['durationMs', 120000],
      ['steps', 200],
      ['snapshots', 200],
      ['orderedTurns', LIMITS.maxTurns],
    ])
      if (!Number.isInteger(collection[key]) || collection[key] < 0 || collection[key] > maximum)
        throw new TypeError(`Collection ${key} is outside its supported bound.`);
    if (collection.orderedTurns !== turns.length)
      throw new TypeError('Collection evidence must match the ordered turn count.');
    for (const key of ['startObserved', 'endObserved', 'restoredScroll', 'indicesAvailable'])
      if (typeof collection[key] !== 'boolean')
        throw new TypeError(`Collection ${key} must be a boolean.`);
    const reasons = new Set([
      'observed-boundaries',
      'gaps',
      'step-limit',
      'duration-limit',
      'turn-limit',
      'byte-limit',
      'stalled',
      'capture-limit',
      'cancelled',
      'streaming',
      'navigation',
      'conflict',
      'disconnected',
      'user-intervened',
      'capture-error',
      'unstable-identity',
    ]);
    if (!reasons.has(collection.stoppedReason))
      throw new TypeError('Unknown collection stop reason.');
    const gaps = array(collection.gaps, 'Observed collection gaps', LIMITS.maxTurns).map((gap) => {
      record(gap, 'Collection gap');
      if (
        !Number.isInteger(gap.from) ||
        !Number.isInteger(gap.to) ||
        gap.from < 0 ||
        gap.to < gap.from ||
        gap.to > 1000000
      )
        throw new TypeError('Collection gaps must contain bounded ordered indices.');
      return { from: gap.from, to: gap.to };
    });
    source.collection = {
      startedAt: collection.startedAt,
      finishedAt: collection.finishedAt,
      durationMs: collection.durationMs,
      steps: collection.steps,
      snapshots: collection.snapshots,
      orderedTurns: collection.orderedTurns,
      startObserved: collection.startObserved,
      endObserved: collection.endObserved,
      restoredScroll: collection.restoredScroll,
      indicesAvailable: collection.indicesAvailable,
      gaps,
      stoppedReason: collection.stoppedReason,
    };
    if (collection.reportedTotal !== undefined) {
      if (
        !Number.isInteger(collection.reportedTotal) ||
        collection.reportedTotal < 0 ||
        collection.reportedTotal > 1000000
      )
        throw new TypeError('Collection reported total is outside its supported bound.');
      source.collection.reportedTotal = collection.reportedTotal;
    }
  }
  const inputBranches = record(data.branches, 'Branches');
  if (!selections.has(inputBranches.selection))
    throw new TypeError('Branch selection must be explicit.');
  const leafIds = new Set();
  const availableLeaves = array(
    inputBranches.availableLeaves,
    'Available branches',
    LIMITS.maxNodes,
  ).map((leaf) => {
    record(leaf, 'Branch');
    const leafId = id(leaf.id, 'Branch ID');
    if (leafIds.has(leafId)) throw new TypeError('Duplicate branch ID.');
    leafIds.add(leafId);
    if (!Number.isInteger(leaf.turnCount) || leaf.turnCount < 0 || leaf.turnCount > LIMITS.maxTurns)
      throw new TypeError('Invalid branch turn count.');
    return { id: leafId, turnCount: leaf.turnCount };
  });
  const selectedLeaf = id(inputBranches.selectedLeaf, 'Selected branch');
  if (!leafIds.has(selectedLeaf))
    throw new TypeError('Selected branch is missing from available branches.');
  const branches = { selectedLeaf, availableLeaves, selection: inputBranches.selection };
  const verificationInput = record(data.verification, 'Verification');
  if (!statuses.has(verificationInput.status))
    throw new TypeError('Verification status is required.');
  const issues = array(verificationInput.issues, 'Verification issues', 10000).map((issue) => {
    record(issue, 'Verification issue');
    const output = {
      code: id(issue.code, 'Issue code'),
      message: count(string(issue.message, 'Issue message', 2000)),
    };
    if (issue.sourceLocator !== undefined)
      output.sourceLocator = string(issue.sourceLocator, 'Issue locator');
    return output;
  });
  const attachmentIds = new Set();
  const attachments = array(data.attachments ?? [], 'Attachments', LIMITS.maxAttachments).map(
    (item) => {
      record(item, 'Attachment');
      const attachmentId = id(item.id, 'Attachment ID');
      if (attachmentIds.has(attachmentId)) throw new TypeError('Duplicate attachment ID.');
      attachmentIds.add(attachmentId);
      if (!attachmentStates.has(item.status)) throw new TypeError('Invalid attachment status.');
      // A display name is never a filesystem path. Even exported names must satisfy this boundary.
      const name = string(item.name, 'Attachment name', 255);
      if (name === '.' || name === '..' || /[\\/\r\n\t]/u.test(name))
        throw new TypeError('Attachment names must be plain filenames, without path separators.');
      const output = {
        id: attachmentId,
        name,
        sourceLocator: string(item.sourceLocator, 'Attachment locator'),
        status: item.status,
      };
      // Browser completion metadata helps pair an explicitly chosen File; it is not byte proof.
      if (item.download !== undefined) {
        const download = record(item.download, 'Download metadata');
        const name = string(download.name, 'Downloaded filename', 180);
        if (name === '.' || name === '..' || /[\\/\r\n\t]/u.test(name))
          throw new TypeError('Downloaded names must be plain filenames.');
        if (
          !Number.isSafeInteger(download.size) ||
          download.size < 0 ||
          download.size > 5 * 1024 * 1024
        )
          throw new TypeError('Download size must be between zero and 5 MiB.');
        output.download = { name, size: download.size };
      }
      if (item.localName !== undefined) {
        const localName = string(item.localName, 'Selected attachment filename', 255);
        if (localName === '.' || localName === '..' || /[\\/\r\n\t]/u.test(localName))
          throw new TypeError(
            'Selected attachment names must be plain filenames, without path separators.',
          );
        output.localName = localName;
      }
      if (item.sha256 !== undefined) {
        if (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(item.sha256))
          throw new TypeError(
            'Attachment SHA-256 must contain 64 lowercase hexadecimal characters.',
          );
        output.sha256 = item.sha256;
      }
      if (item.turnId !== undefined) {
        output.turnId = id(item.turnId, 'Attachment turn ID');
        if (!turnIds.has(output.turnId))
          throw new TypeError('Attachment refers to an unknown turn.');
      }
      const attachmentUrl = optionalUrl(item.url, 'Attachment URL');
      if (attachmentUrl) output.url = attachmentUrl;
      if (item.mediaType !== undefined)
        output.mediaType = string(item.mediaType, 'Attachment media type', 200);
      if (item.size !== undefined) {
        if (
          !Number.isSafeInteger(item.size) ||
          item.size < 0 ||
          item.size > LIMITS.maxAttachmentBytes
        )
          throw new TypeError('Attachment size must be between 0 and 25 MiB.');
        output.size = item.size;
      }
      if (item.status === 'available') {
        if (
          typeof item.sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(item.sha256) ||
          typeof item.localFileId !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,128}$/u.test(item.localFileId)
        ) {
          throw new TypeError(
            'An available attachment needs a selected local file ID and SHA-256 digest.',
          );
        }
        output.sha256 = item.sha256;
        output.localFileId = item.localFileId;
      }
      return output;
    },
  );
  let status = verificationInput.status;
  if (
    status === 'verified' &&
    source.response?.method === 'POST' &&
    (!source.response.streamCompleted || source.response.coverage === 'partial-history')
  )
    status = 'partial';
  if (
    status === 'verified' &&
    (issues.length ||
      !turns.length ||
      turns.some((turn) => turn.contentFidelity !== 'original-markdown') ||
      attachments.some((attachment) => attachment.status !== 'available'))
  )
    status = 'partial';
  if (source.response?.webSocket) status = 'partial';
  // A snapshot cannot prove that ChatGPT has rendered every turn, regardless of a supplied claim.
  if (source.type === 'dom-snapshot') status = 'unverified';
  return {
    schemaVersion: 1,
    source,
    turns,
    branches,
    verification: { status, issues },
    attachments,
  };
}

export function headingText(value) {
  return value
    .replace(/[\r\n]/gu, ' ')
    .replace(/[<>]/gu, (char) => (char === '<' ? '&lt;' : '&gt;'));
}
export function labelText(value) {
  return headingText(value).replace(/[\\[\]]/gu, '\\$&');
}

function projectCode(code) {
  let longestRun = 0;
  for (const match of code.sourceText.matchAll(/`+/gu))
    longestRun = Math.max(longestRun, match[0].length);
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  const safeLanguage = /^[a-zA-Z0-9_+.#-]{0,64}$/u.test(code.language) ? code.language : '';
  const languageLabel =
    safeLanguage || !code.language ? '' : `Language: ${headingText(code.language)}\n\n`;
  return `${languageLabel}${fence}${safeLanguage}\n${code.sourceText}${code.sourceText.endsWith('\n') ? '' : '\n'}${fence}`;
}

/** One file's line in the hand-off text; the app swaps it for the downloaded path when it has one. */
export function projectFileLine(file) {
  return `- ${labelText(file.name)} — ${file.status}${file.url ? ` · <${file.url}>` : ''}`;
}

/** One content check's line; the app drops a file's check once it has a local copy. */
export function projectIssueLine(issue) {
  return `- ${headingText(issue.message)}`;
}

/** The notes a partial hand-off may carry in its scope line. */
export const SCOPE_NOTES = Object.freeze([
  'new since last add',
  'new and changed since last add',
  'chosen',
  'added again',
]);

/** Where a turn's own node is in the source: its locator without the trailing `.message`. */
function nodeOf(turn) {
  return turn.sourceLocator.replace(/\.message$/u, '');
}

/** Whether `locator` is `base` or something inside it (`base.x`, `base[0]`, `base/x`). */
function within(locator, base) {
  return locator === base || (locator.startsWith(base) && '.[/'.includes(locator[base.length]));
}

/**
 * Which turns, files and content checks a choice of turns carries, in source order. Files that belong
 * to no turn go with every choice. A check goes with a choice when it is about one of its turns or
 * files, or about no turn or file at all (the conversation as a whole). Without `turnIds`, everything.
 */
export function selectTurns(model, turnIds = null) {
  const every = !turnIds;
  const wanted = new Set(turnIds ?? []);
  if (!every) {
    if (!wanted.size) throw new TypeError('Choose at least one turn.');
    for (const turnId of wanted)
      if (!model.turns.some((turn) => turn.id === turnId))
        throw new TypeError('A chosen turn is not in this conversation.');
  }
  const positions = new Map(model.turns.map((turn, index) => [turn.id, index + 1]));
  const turns = model.turns.filter((turn) => every || wanted.has(turn.id));
  const attachments = model.attachments.filter(
    (file) => every || !file.turnId || wanted.has(file.turnId),
  );
  const issues = model.verification.issues.filter((issue) => {
    if (every || !issue.sourceLocator) return true;
    const file = model.attachments.find((item) => item.sourceLocator === issue.sourceLocator);
    if (file) return attachments.includes(file);
    const turn = model.turns.find((item) => within(issue.sourceLocator, nodeOf(item)));
    return !turn || wanted.has(turn.id);
  });
  let status = model.verification.status;
  if (!every && status !== 'unverified') {
    // A choice of turns is verified when nothing it carries needs a check, unless the whole
    // conversation is partial for a reason no check names.
    const unexplained = status === 'partial' && !model.verification.issues.length;
    status =
      unexplained ||
      issues.length ||
      turns.some((turn) => turn.contentFidelity !== 'original-markdown') ||
      attachments.some((file) => file.status !== 'available')
        ? 'partial'
        : 'verified';
  }
  return {
    all: turns.length === model.turns.length,
    turns,
    positions,
    attachments,
    verification: { status, issues },
  };
}

/** Runs of 1-based positions: [3, 5, 6, 7] → "3, 5–7". */
function ranges(positions) {
  const parts = [];
  for (let index = 0; index < positions.length; ) {
    let end = index;
    while (end + 1 < positions.length && positions[end + 1] === positions[end] + 1) end++;
    parts.push(end === index ? `${positions[index]}` : `${positions[index]}–${positions[end]}`);
    index = end + 1;
  }
  return parts.join(', ');
}

/** The line that names the turns a partial hand-off carries, e.g. `Turns 15–21 of 42 · new since last add`. */
export function scopeLine(positions, total, note = '') {
  const contiguous = positions.at(-1) - positions[0] === positions.length - 1;
  const which =
    positions.length === 1
      ? `Turn ${positions[0]} of ${total}`
      : contiguous
        ? `Turns ${positions[0]}–${positions.at(-1)} of ${total}`
        : `Selected turns: ${ranges(positions)} of ${total}`;
  return note && !(note === 'chosen' && !contiguous) ? `${which} · ${note}` : which;
}

/** A turn's body in the hand-off text: everything under its heading. File lines go into `marks`. */
function turnBody(turn, files, marks = null) {
  const out = [];
  if (turn.contentFidelity !== 'original-markdown')
    out.push(`_Content: ${headingText(turn.contentFidelity)}_`);
  out.push('', turn.code ? projectCode(turn.code) : turn.markdown);
  if (turn.citations.length) {
    out.push('', '### References', '');
    for (const citation of turn.citations)
      out.push(`- [${labelText(citation.title)}](<${citation.url}>)`);
  }
  if (files.length) {
    out.push('', '### Files', '');
    for (const file of files) {
      marks?.push([file.id, out.length]);
      out.push(projectFileLine(file));
    }
  }
  return out;
}

/**
 * What the app needs to offer turns one by one, in source order: id, role, 1-based position, a
 * one-line preview of at most 80 characters, the files it carries, and the SHA-256 of its projected
 * body (role, text, references and file lines; not the numbered heading, so a turn keeps its hash
 * when earlier turns load). `hash` is a SHA-256 hex function of a string.
 */
export function describeTurns(input, hash) {
  const model = validateConversation(input);
  return model.turns.map((turn, index) => {
    const files = model.attachments.filter((file) => file.turnId === turn.id);
    const flat = (turn.code ? turn.code.sourceText : turn.markdown).replace(/\s+/gu, ' ').trim();
    const characters = [...flat];
    return {
      id: turn.id,
      role: turn.role,
      position: index + 1,
      preview: characters.length > 80 ? `${characters.slice(0, 79).join('')}…` : flat,
      files: files.map((file) => file.id),
      sha256: hash(`${turn.role}\n${turnBody(turn, files).join('\n')}`),
    };
  });
}

/**
 * The hand-off text: each turn as `## Turn N — Role` with its original Markdown untouched, then that
 * turn's references and files. Locators stay in HTML comments so they are kept but not rendered.
 * Render only through textContent/textarea, never as trusted HTML.
 *
 * `options.turnIds` projects only those turns, in source order, keeping their numbers in the whole
 * conversation, with only their references, files and content checks, under a scope line that
 * `options.note` (one of SCOPE_NOTES) completes. Choosing every turn gives the whole text.
 *
 * `lines`, when given, receives where each file line and each check line lands (0-based line numbers):
 * `lines.files` by attachment id and `lines.checks` by issue message, so the app can replace exactly
 * those; and the projection's own selection as `lines.selection` (see selectTurns).
 */
export function projectMarkdown(input, lines = null, { turnIds = null, note = '' } = {}) {
  const model = validateConversation(input);
  if (note && !SCOPE_NOTES.includes(note)) throw new TypeError('Unknown scope note.');
  const chosen = selectTurns(model, turnIds);
  const marks = [];
  const comment = (text) => `<!-- ${headingText(text).replaceAll('--', '- -')} -->`;

  const source = model.source.url ? `<${model.source.url}>` : headingText(model.source.locator);
  const out = [
    `# ${headingText(model.source.title)}`,
    '',
    `Source: ${source} · ${model.turns.length} turns · verification: ${chosen.verification.status}`,
  ];
  if (!chosen.all)
    out.push(
      scopeLine(
        chosen.turns.map((turn) => chosen.positions.get(turn.id)),
        model.turns.length,
        note,
      ),
    );
  out.push(comment(`selected branch: ${model.branches.selectedLeaf}`));
  if (model.branches.availableLeaves.length > 1)
    out.push(
      `Selected branch only; ${model.branches.availableLeaves.length} branch variants exist.`,
    );
  if (chosen.verification.issues.length) {
    out.push('', '## Content checks', '');
    // Each distinct check once: the same finding on many turns or sources is one thing to review.
    for (const message of new Set(chosen.verification.issues.map((issue) => issue.message))) {
      marks.push(['checks', message, out.length]);
      out.push(projectIssueLine({ message }));
    }
  }
  const files = new Map(chosen.turns.map((turn) => [turn.id, []]));
  const loose = [];
  for (const file of chosen.attachments) (files.get(file.turnId) ?? loose).push(file);
  for (const turn of chosen.turns) {
    out.push(
      '',
      `## Turn ${chosen.positions.get(turn.id)} — ${turn.role === 'user' ? 'User' : 'Assistant'}`,
      comment(`source: ${turn.sourceLocator}`),
    );
    const fileMarks = [];
    const body = turnBody(turn, files.get(turn.id), fileMarks);
    for (const [fileId, offset] of fileMarks) marks.push(['files', fileId, out.length + offset]);
    out.push(...body);
  }
  if (loose.length) {
    out.push('', '## Files', '');
    for (const file of loose) {
      marks.push(['files', file.id, out.length]);
      out.push(projectFileLine(file));
    }
  }
  if (lines) {
    // Elements may hold several lines (a turn's Markdown); convert element indexes to line numbers.
    const start = [];
    for (let index = 0, line = 0; index < out.length; index++) {
      start.push(line);
      line += out[index].split('\n').length;
    }
    lines.files = new Map();
    lines.checks = new Map();
    for (const [kind, key, index] of marks) lines[kind].set(key, start[index]);
    lines.selection = chosen;
  }
  return `${out.join('\n')}\n`;
}

/** Synthetic fixture. Never represents, retrieves, or transmits an actual user's conversation. */
export function demoConversation() {
  return validateConversation({
    schemaVersion: 1,
    source: {
      type: 'synthetic',
      id: 'demo-field-notes',
      title: 'A quieter launch',
      url: 'https://chatgpt.com/',
      locator: 'synthetic:demo-field-notes',
    },
    branches: {
      selectedLeaf: 'demo-4',
      availableLeaves: [{ id: 'demo-4', turnCount: 4 }],
      selection: 'single-path',
    },
    verification: { status: 'verified', issues: [] },
    turns: [
      {
        id: 'demo-1',
        role: 'user',
        markdown:
          'Help me shape a small launch page for **Field Notes**, a local-first writing app.\n\nKeep it calm, clear, and useful.',
        sourceLocator: 'synthetic:demo/1',
        contentFidelity: 'original-markdown',
      },
      {
        id: 'demo-2',
        role: 'assistant',
        markdown:
          '## A place for unfinished thoughts\n\nA quiet space to collect ideas, find a thread, and keep writing.\n\n- Your words stay on your device.\n- Start with a blank page.\n- Export whenever you like.\n\nUse a single primary action: **Start a note**.',
        sourceLocator: 'synthetic:demo/2',
        contentFidelity: 'original-markdown',
      },
      {
        id: 'demo-3',
        role: 'user',
        markdown: 'Add a tiny code example and a reference link. Keep the draft as Markdown.',
        sourceLocator: 'synthetic:demo/3',
        contentFidelity: 'original-markdown',
      },
      {
        id: 'demo-4',
        role: 'assistant',
        markdown:
          '```js\nconst note = { title: "A small beginning", saved: true };\n```\n\nFor the implementation, start with [semantic HTML](https://developer.mozilla.org/en-US/docs/Glossary/Semantics).\n\nThe first screen should feel like an invitation to write.',
        sourceLocator: 'synthetic:demo/4',
        contentFidelity: 'original-markdown',
        citations: [
          {
            title: 'Semantic HTML · MDN',
            url: 'https://developer.mozilla.org/en-US/docs/Glossary/Semantics',
            sourceLocator: 'synthetic:demo/4/reference/1',
          },
        ],
      },
    ],
    attachments: [],
  });
}
