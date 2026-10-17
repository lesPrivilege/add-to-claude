/** The hand-off text projected from a validated conversation: whole, or a choice of turns. */
import { validateConversation } from './model.js';

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

/** Where a turn's own nodes are in the source: its locators without the trailing `.message`. */
function nodesOf(turn) {
  return turn.sourceLocators.map((locator) => locator.replace(/\.message$/u, ''));
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
    const turn = model.turns.find((item) =>
      nodesOf(item).some((node) => within(issue.sourceLocator, node)),
    );
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
    // Numbered as the text's [n] marks.
    turn.citations.forEach((citation, index) =>
      out.push(`${index + 1}. [${labelText(citation.title)}](<${citation.url}>)`),
    );
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
      comment(`source: ${turn.sourceLocators.join(', ')}`),
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
