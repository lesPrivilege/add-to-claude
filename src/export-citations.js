/** Citations in a ChatGPT message: its sources, the marks its text leaves in place, and their numbers. */
import { safeUrl } from './model.js';
import { isRecord, own } from './export-graph.js';

// content_references entries that only shape the rendered text, never a source link.
const linklessReferences = ['hidden', 'entity', 'image_group'];

/**
 * Index a message's sources. An inline citation is resolved when the content reference that
 * replaces its exact text has a link, or when every source id it names (turn, type, index) is a
 * known search result.
 */
export function citationSources(metadata, base) {
  const referenceId = (value) =>
    typeof value === 'string'
      ? value
      : isRecord(value) &&
          Number.isSafeInteger(value.turn_index) &&
          typeof value.ref_type === 'string' &&
          Number.isSafeInteger(value.ref_index)
        ? `turn${value.turn_index}${value.ref_type}${value.ref_index}`
        : null;
  const linkedText = new Map();
  const sourceById = new Map();
  const noteSource = (entry, ids, sourceLocator) => {
    const url = isRecord(entry) && safeUrl(entry.url);
    if (!url || !Array.isArray(ids)) return;
    for (const id of ids.map(referenceId))
      if (id && !sourceById.has(id)) sourceById.set(id, { url, title: entry.title, sourceLocator });
  };
  if (Array.isArray(metadata.content_references))
    metadata.content_references.forEach((reference, referenceIndex) => {
      if (!isRecord(reference)) return;
      const path = `${base}.message.metadata.content_references[${referenceIndex}]`;
      const items = Array.isArray(reference.items) ? reference.items : [];
      noteSource(reference, reference.refs, path);
      items.forEach((item, itemIndex) =>
        noteSource(item, item?.refs, `${path}.items[${itemIndex}]`),
      );
      const links = [
        reference.url,
        ...items.map((item) => item?.url),
        ...(Array.isArray(reference.sources) ? reference.sources.map((item) => item?.url) : []),
        ...(Array.isArray(reference.safe_urls) ? reference.safe_urls : []),
      ];
      if (
        typeof reference.matched_text === 'string' &&
        !linklessReferences.includes(reference.type) &&
        links.some(safeUrl)
      )
        linkedText.set(reference.matched_text, links.map(safeUrl).filter(Boolean));
    });
  if (Array.isArray(metadata.search_result_groups))
    metadata.search_result_groups.forEach((group, groupIndex) => {
      if (isRecord(group) && Array.isArray(group.entries))
        group.entries.forEach((entry, entryIndex) =>
          noteSource(
            entry,
            [entry?.ref_id],
            `${base}.message.metadata.search_result_groups[${groupIndex}].entries[${entryIndex}]`,
          ),
        );
    });
  return { linkedText, sourceById };
}

/**
 * Marks for one message's text. Each inline citation leaves a mark in place, numbered once its
 * turn's source list is final (a turn may span several messages): the links it resolves to, or
 * none, read as [?]. `slots` holds those links for the whole branch.
 *
 * Marks travel through the markup reader as a character the text does not contain, then come out
 * as positions, so the text itself is never rewritten.
 */
export function citationMarks(raw, { linkedText, sourceById }, slots) {
  let code = 0xf0000;
  while (raw.includes(String.fromCodePoint(code))) code += 1;
  const sentinel = String.fromCodePoint(code);
  const mark = (cite) => {
    const urls =
      linkedText.get(cite.marker) ??
      (cite.refs.length && cite.refs.every((ref) => sourceById.has(ref))
        ? cite.refs.map((ref) => sourceById.get(ref).url)
        : null);
    slots.push(urls);
    return `${sentinel}${slots.length - 1}${sentinel}`;
  };
  // Take the marks out of the reader's text: the text without them, and where each stood.
  const extract = (text) => {
    const marks = [];
    let removed = 0;
    const markdown = text.replace(
      new RegExp(`${sentinel}(\\d+)${sentinel}`, 'gu'),
      (_, slot, at) => {
        marks.push({ at: at - removed, slot: Number(slot) });
        removed += _.length;
        return '';
      },
    );
    return { markdown, marks };
  };
  return { mark, extract };
}

const citationContainers = [
  'items',
  'sources',
  'citations',
  'safe_urls',
  'metadata',
  'fallback_items',
  'supporting_websites',
];
// Source fields that hold no links of their own: reference ids, quoted spans, thumbnails.
const citationDetails = [
  'refs',
  'ref_id',
  'attribution_segments',
  'attributions',
  'extra',
  'thumbnail_url',
];

/**
 * A message's source list: every link in its citation metadata, then the sources its inline
 * citations name. Unfamiliar structures and unresolved citations are reported through `issue`.
 */
export function messageCitations(metadata, base, cites, { linkedText, sourceById }, issue) {
  const citations = [];
  const seen = new Set();
  const add = (url, title, sourceLocator) => {
    if (seen.has(url)) return;
    seen.add(url);
    if (citations.length >= 1000) throw new RangeError('A turn exceeds the 1,000-citation limit.');
    citations.push({
      url,
      title: typeof title === 'string' ? title.slice(0, 2000) || url : url,
      sourceLocator,
    });
  };
  let nodes = 0;
  let limitReported = false;
  const limit = (path) => {
    if (limitReported) return;
    limitReported = true;
    issue(
      'truncated-citations',
      'Citation metadata exceeds the supported size or depth. Some sources may be missing; review the original turn.',
      path,
    );
  };
  const collect = (value, path, depth = 0) => {
    nodes += 1;
    if (depth > 6 || nodes > 10000) {
      limit(path);
      return;
    }
    if (typeof value === 'string') {
      const url = safeUrl(value);
      if (url) add(url, url, path);
      else
        issue(
          'unrecognized-citation',
          'A source reference is not a supported HTTP(S) link. Review the original turn to recover it.',
          path,
        );
      return;
    }
    if (!value || typeof value !== 'object') {
      issue(
        'unrecognized-citation',
        'A source reference has an unsupported structure. Review the original turn to recover it.',
        path,
      );
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 1000) limit(path);
      value.slice(0, 1000).forEach((child, i) => collect(child, `${path}[${i}]`, depth + 1));
      return;
    }
    if (linklessReferences.includes(value.type)) return;
    const linkKeys = ['url', 'href'].filter((key) => own(value, key));
    for (const key of linkKeys) {
      const url = safeUrl(value[key]);
      if (url) add(url, value.title, `${path}.${key}`);
      else
        issue(
          'unrecognized-citation',
          'A source URL could not be represented as a safe HTTP(S) link. Review the original turn to recover it.',
          `${path}.${key}`,
        );
    }
    const containers = citationContainers.filter((key) => own(value, key) && value[key] !== null);
    if (!linkKeys.length && !containers.length)
      issue(
        'unrecognized-citation',
        'Citation metadata has an unfamiliar structure. Its links may be missing; review the original turn.',
        path,
      );
    else if (
      Object.entries(value).some(
        ([key, child]) =>
          !['url', 'href', 'title', ...citationContainers, ...citationDetails].includes(key) &&
          ((child !== null && typeof child === 'object') || safeUrl(child)),
      )
    ) {
      issue(
        'unrecognized-citation',
        'Citation metadata contains an unfamiliar source field. Some links may be missing; review the original turn.',
        path,
      );
    }
    for (const key of containers) collect(value[key], `${path}.${key}`, depth + 1);
  };
  for (const key of ['citations', 'content_references'])
    if (metadata[key] !== undefined && metadata[key] !== null)
      collect(metadata[key], `${base}.message.metadata.${key}`);
  let unresolved = false;
  for (const cite of cites) {
    if (linkedText.has(cite.marker)) continue;
    const sources = cite.refs.map((id) => sourceById.get(id));
    if (!sources.length || sources.includes(undefined)) unresolved = true;
    else for (const source of sources) add(source.url, source.title, source.sourceLocator);
  }
  if (unresolved)
    issue(
      'unresolved-citations',
      'Some inline citations could not be matched to a source link; each is marked [?] in the text. Review the original turn to verify them.',
      `${base}.message.content`,
    );
  return citations;
}

/**
 * Number a turn's sources: those cited in the text first, in order of first mention, then the
 * rest. Each mark becomes [n] (or [1, 3]), and one that resolves to no listed source [?].
 */
export function numberCitations(turn, marks, slots) {
  const byUrl = new Map();
  for (const citation of turn.citations)
    if (!byUrl.has(citation.url)) byUrl.set(citation.url, citation);
  const cited = marks.flatMap((item) => slots[item.slot] ?? []);
  const order = new Set([...cited.filter((url) => byUrl.has(url)), ...byUrl.keys()]);
  const number = new Map([...order].map((url, index) => [url, index + 1]));
  let { markdown } = turn;
  // From the end, so earlier positions stay put.
  for (const item of marks.toReversed()) {
    const numbers = [...new Set((slots[item.slot] ?? []).map((url) => number.get(url)))].filter(
      Boolean,
    );
    const label = numbers.length ? `[${numbers.join(', ')}]` : '[?]';
    markdown = markdown.slice(0, item.at) + label + markdown.slice(item.at);
  }
  return { markdown, citations: [...order].map((url) => byUrl.get(url)) };
}
