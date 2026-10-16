/**
 * ChatGPT's rendering markup in assistant text, read as the Markdown its own Copy button gives.
 * Two kinds reach the page's data: private-use markers (U+E200 kind U+E202 field … U+E201) for
 * citations, links and entities, and "genui" tags (<box>, <Entity/>, <Cite/> …) for laid-out
 * answers. Only the tag names below are transformed. Fenced code, inline code and unknown tags
 * stay exactly as written; template directives such as {#each …} are data and stay too.
 */

// Containers lay out blocks: their own lines go, a closing one separates what follows, and the
// content they indent is dedented.
const containers = new Set(['box', 'row', 'grid', 'grid-item', 'WritingBlock']);
const inline = new Set(['text', 'caption']);
const decoration = new Set(['icon', 'divider']);
const tagNames = [...containers, ...inline, ...decoration, 'AsyncImage', 'Entity', 'Link', 'Cite'];
const tagPattern = new RegExp(
  `([ \\t]*)<(/?)(${tagNames.join('|')})((?:\\s+[A-Za-z_][\\w-]*(?:=(?:"[^"]*"|'[^']*'|\\{[^{}]*\\}))?)*)\\s*(/?)>`,
  'gu',
);
const attributePattern = /([A-Za-z_][\w-]*)(?:=(?:"([^"]*)"|'([^']*)'|\{([^{}]*)\}))?/gu;
const markerPattern = /([ \t]*)\ue200([a-z_]+)((?:\ue202[^\ue200-\ue202]*)*)\ue201/gu;
const refIdPattern = /^turn\d+[a-z_]+\d+$/u;
const inlineCode = /(`+).*?(?<!`)\1(?!`)/gu;
const fenceOpen = /^[ \t]*(`{3,}|~{3,})/u;

function attributes(text) {
  const values = {};
  for (const [, name, double, single, braced] of text.matchAll(attributePattern))
    values[name] = double ?? single ?? braced ?? true;
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
 * Returns the readable Markdown, the citations it removed (each with its exact source text and
 * reference ids, for resolving against the message metadata) and how many inline images or
 * widgets it had to leave out.
 */
export function readableMarkdown(text) {
  const cites = [];
  let omitted = 0;
  const marker = (match, space, kind, rest) => {
    const fields = rest.split('\ue202').slice(1);
    if (kind === 'cite' || kind === 'url') {
      cites.push({
        marker: match.slice(space.length),
        refs: fields.filter((field) => refIdPattern.test(field)),
      });
      if (kind === 'cite') return '';
      return space + (fields.find((field) => !refIdPattern.test(field)) ?? '');
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
  let separated = false;
  const tag = (match, space, closing, name, attributeText, selfClosing) => {
    const values = attributes(attributeText);
    if (containers.has(name)) {
      if (closing) {
        closed += 1;
        separated = true;
      } else if (!selfClosing) opened += 1;
      return space;
    }
    if (inline.has(name)) return space;
    if (name === 'divider') separated = true;
    if (decoration.has(name)) return space;
    if (name === 'AsyncImage') {
      omitted += 1;
      return space;
    }
    if (name === 'Entity') return typeof values.value === 'string' ? space + values.value : match;
    if (name === 'Link') return space + link(values.title, values.url);
    // Cite
    cites.push({
      marker: match.slice(space.length),
      refs: typeof values.ref === 'string' ? values.ref.split(/[\s,]+/u).filter(Boolean) : [],
    });
    return '';
  };
  const prose = (line) => {
    let output = '';
    let last = 0;
    for (const code of line.matchAll(inlineCode)) {
      output += line
        .slice(last, code.index)
        .replace(markerPattern, marker)
        .replace(tagPattern, tag);
      output += code[0];
      last = code.index + code[0].length;
    }
    return output + line.slice(last).replace(markerPattern, marker).replace(tagPattern, tag);
  };

  const lines = text.split('\n');
  const output = [];
  let fence = null;
  let depth = 0;
  let region = -1;
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
      // Inside a container, keep its indentation so the container's dedent stays uniform.
      const indent = region >= 0 ? /^[ \t]*/u.exec(line)[0] : '';
      output.push(...[`${marks}svg`, ...svg, marks].map((item) => (item ? indent + item : item)));
      if (after.trim()) output.push(indent + prose(after).trim());
      index = svgEnd;
      changed = true;
      continue;
    }
    opened = 0;
    closed = 0;
    separated = false;
    const before = cites.length + omitted;
    const result = prose(line);
    const touched = result !== line || cites.length + omitted !== before;
    changed ||= touched;
    if (depth === 0 && opened > closed && region < 0) region = output.length;
    if (!touched) output.push(line);
    else if (result.trim()) output.push(result.trimEnd());
    else if (separated && output.length && output.at(-1) !== '') output.push('');
    depth = Math.max(0, depth + opened - closed);
    if (depth === 0 && region >= 0) {
      dedent(output, region);
      region = -1;
    }
  }
  if (region >= 0) dedent(output, region);
  if (!changed) return { markdown: text, cites, omitted };
  while (output.at(-1) === '') output.pop();
  return { markdown: output.join('\n') + (text.endsWith('\n') ? '\n' : ''), cites, omitted };
}
