/**
 * ChatGPT's rendering markup in assistant text, read as the Markdown its own Copy button gives.
 * Two kinds reach the page's data: private-use markers (U+E200 kind U+E202 field … U+E201) for
 * citations, links and entities, and "genui" tags (<box>, <Entity/>, <Cite/> …) for laid-out
 * answers. Only the tag names below are transformed. Fenced code, inline code and unknown tags
 * stay exactly as written. A scripted widget's template lines ({@body …}, {#each …}, {/each}, a line
 * that is only a bound value such as {t.name}) cannot be read as text: they go, and count as an
 * omitted widget.
 */

// Containers lay out blocks: their own lines go, a closing one separates what follows, and the
// content they indent goes flush left (see `flatten`).
const containers = new Set(['box', 'row', 'grid', 'grid-item', 'WritingBlock', 'radio-group']);
// Controls keep their visible label; their handlers and state are dropped with the attributes.
const inline = new Set(['text', 'caption', 'radio', 'button', 'badge']);
const decoration = new Set(['icon', 'divider', 'select', 'spacer']);
const tagNames = [
  ...containers,
  ...inline,
  ...decoration,
  'AsyncImage',
  'Entity',
  'Link',
  'Cite',
  'MemoryCite',
];
const tagPattern = new RegExp(
  `([ \\t]*)<(/?)(${tagNames.join('|')})((?:\\s+[A-Za-z_][\\w-]*(?:=(?:"[^"]*"|'[^']*'|\\{(?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*\\}|[^\\s"'{}<>/=\`]+))?)*)\\s*(/?)>`,
  'gu',
);
// Values may be quoted, braced or bare (`align=start`).
const attributePattern =
  /([A-Za-z_][\w-]*)(?:=(?:"([^"]*)"|'([^']*)'|\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}|([^\s"'{}<>/=`]+)))?/gu;
const markerPattern = /([ \t]*)\ue200([a-z_]+)((?:\ue202[^\ue200-\ue202]*)*)\ue201/gu;
const refIdPattern = /^turn\d+[a-z_]+\d+$/u;
const inlineCode = /(`+).*?(?<!`)\1(?!`)/gu;
const fenceOpen = /^[ \t]*(`{3,}|~{3,})/u;

function attributes(text) {
  const values = {};
  for (const [, name, double, single, braced, bare] of text.matchAll(attributePattern))
    values[name] = double ?? single ?? braced ?? bare ?? true;
  return values;
}

function link(title, url) {
  const label = typeof title === 'string' ? title.replace(/[\\[\]]/gu, '\\$&') : '';
  if (typeof url !== 'string' || !url) return label;
  const target = /[\s()<>]/u.test(url) ? `<${url.replace(/[<>\s]/gu, encodeURIComponent)}>` : url;
  return label ? `[${label}](${target})` : `<${url}>`;
}

/** Strip the common indentation of lines[start…], keeping relative indentation. */
function dedent(lines, start) {
  const indents = lines
    .slice(start)
    .filter((line) => line.trim())
    .map((line) => /^[ \t]*/u.exec(line)[0].length);
  const common = indents.length ? Math.min(...indents) : 0;
  for (let index = start; index < lines.length; index += 1)
    lines[index] = lines[index].trim() ? lines[index].slice(common) : '';
}

/**
 * Indentation inside laid-out content is layout, not Markdown (four spaces would read as code), so
 * lines[start…] go flush left. Fenced code keeps its own indentation, relative to its fence.
 */
function flatten(lines, start) {
  let fence = null;
  let indent = 0;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    const lead = /^[ \t]*/u.exec(line)[0].length;
    if (fence) {
      lines[index] = line.slice(Math.min(lead, indent));
      if (new RegExp(`^[ \\t]*${fence}${fence[0]}*[ \\t]*$`, 'u').test(line)) fence = null;
      continue;
    }
    const opening = fenceOpen.exec(line);
    if (opening) {
      fence = opening[1];
      indent = lead;
    }
    lines[index] = line.slice(lead);
  }
}

/**
 * Returns the readable Markdown, the citations it found (each with its exact source text and
 * reference ids, for resolving against the message metadata) and how many inline images or
 * widgets it had to leave out. `mark(cite)` gives the text that stands in a citation's place.
 */
export function readableMarkdown(text, mark = () => '') {
  const cites = [];
  let omitted = 0;
  const marker = (match, space, kind, rest) => {
    const fields = rest.split('\ue202').slice(1);
    if (kind === 'cite' || kind === 'url') {
      const cite = {
        marker: match.slice(space.length),
        refs: fields.filter((field) => refIdPattern.test(field)),
      };
      cites.push(cite);
      const label = kind === 'url' ? (fields.find((field) => !refIdPattern.test(field)) ?? '') : '';
      const stand = mark(cite);
      return label || stand ? space + label + stand : '';
    }
    if (kind === 'entity') {
      try {
        const entity = JSON.parse(fields[0]);
        if (Array.isArray(entity) && typeof entity[1] === 'string') return space + entity[1];
      } catch {
        /* An unfamiliar entity shape stays as written. */
      }
      return match;
    }
    omitted += 1;
    return '';
  };
  let opened = 0;
  let closed = 0;
  let first = null;
  let separated = false;
  const tag = (match, space, closing, name, attributeText, selfClosing) => {
    const values = attributes(attributeText);
    if (containers.has(name)) {
      if (closing) {
        closed += 1;
        separated = true;
      } else if (!selfClosing) {
        opened += 1;
        first ??= name;
      }
      return space;
    }
    if (inline.has(name)) return space;
    if (name === 'divider') separated = true;
    if (decoration.has(name)) return space;
    // An answer drew on memory: no link and nothing to read, so it goes with the space before it.
    if (name === 'MemoryCite') return '';
    if (name === 'AsyncImage') {
      omitted += 1;
      return space;
    }
    if (name === 'Entity') return typeof values.value === 'string' ? space + values.value : match;
    if (name === 'Link') return space + link(values.title, values.url);
    // Cite
    const cite = {
      marker: match.slice(space.length),
      refs: typeof values.ref === 'string' ? values.ref.split(/[\s,]+/u).filter(Boolean) : [],
    };
    cites.push(cite);
    const stand = mark(cite);
    return stand ? space + stand : '';
  };
  // Markup inside an inline code span stays as written. A tag is matched on the whole line first, since
  // its handler may itself contain backticks; it is left alone only if it starts inside a code span.
  const outsideCode = (pattern, replace) => (text) => {
    const spans = [...text.matchAll(inlineCode)].map((code) => [
      code.index,
      code.index + code[0].length,
    ]);
    return text.replace(pattern, (...args) => {
      const at = args.at(-2);
      return spans.some(([start, end]) => at >= start && at < end) ? args[0] : replace(...args);
    });
  };
  const markers = outsideCode(markerPattern, marker);
  const tags = outsideCode(tagPattern, tag);
  const prose = (line) => tags(markers(line));

  const lines = text.split('\n');
  const output = [];
  let fence = null;
  let depth = 0;
  let region = -1;
  let writing = false;
  let changed = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      output.push(line);
      if (new RegExp(`^[ \\t]*${fence}${fence[0]}*[ \\t]*$`, 'u').test(line)) fence = null;
      continue;
    }
    const opening = fenceOpen.exec(line);
    if (opening) {
      fence = opening[1];
      output.push(line);
      continue;
    }
    // Inline SVG keeps its geometry: the whole element goes into a fenced block as written.
    const svgStart = /<svg[\s>]/u.exec(line.replace(inlineCode, (code) => ' '.repeat(code.length)));
    const svgEnd =
      svgStart && lines.findIndex((item, at) => at >= index && item.includes('</svg>'));
    if (svgStart && svgEnd >= 0) {
      const after = lines[svgEnd].slice(lines[svgEnd].indexOf('</svg>') + 6);
      const svg = lines.slice(index, svgEnd + 1);
      svg[svg.length - 1] = svg.at(-1).slice(0, svg.at(-1).indexOf('</svg>') + 6);
      svg[0] = /^[ \t]*/u.exec(line)[0] + svg[0].slice(svgStart.index);
      dedent(svg, 0);
      const runs = svg.flatMap((item) => (item.match(/`+/gu) ?? []).map((run) => run.length));
      const marks = '`'.repeat(Math.max(2, ...runs) + 1);
      const before = prose(line.slice(0, svgStart.index));
      if (before.trim()) output.push(before.trimEnd());
      // Inside a container, keep its indentation: the container flattens it with its fence.
      const indent = region >= 0 ? /^[ \t]*/u.exec(line)[0] : '';
      output.push(...[`${marks}svg`, ...svg, marks].map((item) => (item ? indent + item : item)));
      if (after.trim()) output.push(indent + prose(after).trim());
      index = svgEnd;
      changed = true;
      continue;
    }
    // A scripted widget's template lines: directives, script blocks and lone bound values.
    if (/^[ \t]*\{[@#:/][^]*\}[ \t]*$|^[ \t]*(?:\{[^{}]*\}[ \t]*)+$/u.test(line)) {
      if (/^[ \t]*\{@/u.test(line)) omitted += 1;
      changed = true;
      continue;
    }
    opened = 0;
    closed = 0;
    first = null;
    separated = false;
    const before = cites.length + omitted;
    let result = prose(line);
    // A control whose only content was a bound value ({s}) leaves nothing to read.
    if (result !== line && /^[ \t]*(?:\{[^{}]*\}[ \t]*)+$/u.test(result)) result = '';
    const touched = result !== line || cites.length + omitted !== before;
    changed ||= touched;
    if (depth === 0 && opened > closed && region < 0) {
      region = output.length;
      // A writing block holds authored Markdown, whose indentation means something.
      writing = first === 'WritingBlock';
    }
    if (!touched) output.push(line);
    else if (result.trim()) output.push(result.trimEnd());
    else if (separated && output.length && output.at(-1) !== '') output.push('');
    depth = Math.max(0, depth + opened - closed);
    if (depth === 0 && region >= 0) {
      (writing ? dedent : flatten)(output, region);
      region = -1;
    }
  }
  if (region >= 0) (writing ? dedent : flatten)(output, region);
  if (!changed) return { markdown: text, cites, omitted };
  while (output.at(-1) === '') output.pop();
  return { markdown: output.join('\n') + (text.endsWith('\n') ? '\n' : ''), cites, omitted };
}
