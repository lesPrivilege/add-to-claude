import test from 'node:test';
import assert from 'node:assert/strict';
import { readableMarkdown } from '../src/chatgpt-markup.js';

// Synthetic text in the shape of ChatGPT's 2026 laid-out ("genui") answers.
const cards = [
  'Two options:',
  '',
  '<box gap={3}>',
  '  <row align="start" gap={3}>',
  '    <AsyncImage ref="turn1image0" aspectRatio="4:5" maxWidth="148px"/>',
  '    <box flex="1" gap={1}>',
  '      **1. <Entity category="software" value="Field Notes" disambig="a writing app"/>**',
  '      <text color="secondary" size="xs">Local-first · plain files</text>',
  '      <text size="sm"><Link url="https://example.com/notes" title="Site [beta]"/> <Cite ref="turn1search0"/></text>',
  '    </box>',
  '  </row>',
  '  <divider color="subtle"/>',
  '</box>',
  '<row align="center" border radius="lg" padding={3} gap={3}>',
  '  <icon name="file-text" size="2xl" color="secondary"/>',
  '  <box flex="1" gap={1}>',
  '    **[plan.md](sandbox:/mnt/data/plan.md)**',
  '    <text color="secondary" size="xs">Markdown · 721 bytes</text>',
  '  </box>',
  '  <icon name="download" color="secondary"/>',
  '</row>',
  '<caption>Geometry is approximate</caption>',
  '',
  'That is all.',
].join('\n');

test('layout tags unwrap to their content, dedented and separated by block', () => {
  const result = readableMarkdown(cards);
  assert.equal(
    result.markdown,
    [
      'Two options:',
      '',
      '**1. Field Notes**',
      'Local-first · plain files',
      '[Site \\[beta\\]](https://example.com/notes)',
      '',
      '**[plan.md](sandbox:/mnt/data/plan.md)**',
      'Markdown · 721 bytes',
      '',
      'Geometry is approximate',
      '',
      'That is all.',
    ].join('\n'),
  );
  assert.deepEqual(result.cites, [
    { marker: '<Cite ref="turn1search0"/>', refs: ['turn1search0'] },
  ]);
  // The image is content left out; icons and dividers are decoration.
  assert.equal(result.omitted, 1);
});

test('a writing block keeps its Markdown and template directives stay as data', () => {
  const text = [
    '{@body const sizes=["16px","24px"]}',
    '<grid columns={3} gap={2}>',
    '  {#each sizes as s}',
    '    <grid-item><text weight="medium" tabularNums>{s}</text></grid-item>',
    '  {/each}',
    '</grid>',
    '<WritingBlock id="58317" variant="document">## Origins',
    '',
    'First paragraph.',
    '',
    '    indented code stays',
    '</WritingBlock>',
  ].join('\n');
  assert.equal(
    readableMarkdown(text).markdown,
    [
      '{@body const sizes=["16px","24px"]}',
      '{#each sizes as s}',
      '  {s}',
      '{/each}',
      '',
      '## Origins',
      '',
      'First paragraph.',
      '',
      '    indented code stays',
    ].join('\n'),
  );
});

test('inline SVG is kept whole in a fenced svg block', () => {
  const text = [
    'Sketch:',
    '<box>',
    '  <svg viewBox="0 0 24 24" width="24">',
    '    <path d="M4 4h16"/>',
    '    <text x="2">A</text>',
    '  </svg>',
    '  <text>Caption</text>',
    '</box>',
    'Inline <svg width="8"><circle r="4"/></svg> too.',
  ].join('\n');
  assert.equal(
    readableMarkdown(text).markdown,
    [
      'Sketch:',
      '```svg',
      '<svg viewBox="0 0 24 24" width="24">',
      '  <path d="M4 4h16"/>',
      '  <text x="2">A</text>',
      '</svg>',
      '```',
      'Caption',
      '',
      'Inline',
      '```svg',
      '<svg width="8"><circle r="4"/></svg>',
      '```',
      'too.',
    ].join('\n'),
  );
});

test('code, inline code and unknown tags are never touched', () => {
  const text = [
    'Write `<box gap={3}>` or `citeturn0search0` literally. <panel a="1"/> <textarea>x</textarea>',
    '```html',
    '<box gap={3}><text>kept</text></box>',
    '<svg><path/></svg>',
    '```',
    '~~~',
    '<Cite ref="turn0search0"/>',
    '~~~',
    '',
  ].join('\n');
  const result = readableMarkdown(text);
  assert.equal(result.markdown, text);
  assert.deepEqual(result.cites, []);
});

test('private-use markers become display text, drop citations and leave out image groups', () => {
  const text = [
    'Try urlCC Switchturn562060search11 first.citeturn833221search5turn833221search2',
    'image_group{"layout":"carousel","query":["CC Switch"]}',
    'Made by entity["company","Example Labs","a software studio"] citeturn0search1.',
    '',
  ].join('\n');
  const result = readableMarkdown(text);
  assert.equal(result.markdown, 'Try CC Switch first.\nMade by Example Labs.\n');
  assert.deepEqual(result.cites, [
    { marker: 'urlCC Switchturn562060search11', refs: ['turn562060search11'] },
    {
      marker: 'citeturn833221search5turn833221search2',
      refs: ['turn833221search5', 'turn833221search2'],
    },
    { marker: 'citeturn0search1', refs: ['turn0search1'] },
  ]);
  assert.equal(result.omitted, 1);
});

test('text without markup is returned exactly, trailing spaces and blank lines included', () => {
  for (const text of ['  **Exact** 中文 ✓  \n\n\n', 'a < b and c > d', ''])
    assert.deepEqual(readableMarkdown(text), { markdown: text, cites: [], omitted: 0 });
});
