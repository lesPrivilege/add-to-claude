import test from 'node:test';
import assert from 'node:assert/strict';
import {
  citationMarks,
  citationSources,
  messageCitations,
  numberCitations,
} from '../src/export-citations.js';

const metadata = {
  content_references: [
    {
      matched_text: 'citeA',
      type: 'grouped_webpages',
      items: [{ url: 'https://a.example/', title: 'A' }],
    },
  ],
  search_result_groups: [
    {
      entries: [
        {
          url: 'https://b.example/',
          title: 'B',
          ref_id: { turn_index: 0, ref_type: 'search', ref_index: 1 },
        },
      ],
    },
  ],
};

test('sources: a matched span and a search result id both resolve', () => {
  const { linkedText, sourceById } = citationSources(metadata, 'm');
  assert.deepEqual(linkedText.get('citeA'), ['https://a.example/']);
  assert.equal(sourceById.get('turn0search1').url, 'https://b.example/');
});

test('marks: a sentinel the text does not contain, taken out as positions', () => {
  const raw = `x${String.fromCodePoint(0xf0000)}y`;
  const slots = [];
  const { mark, extract } = citationMarks(raw, citationSources(metadata, 'm'), slots);
  const first = mark({ marker: 'citeA', refs: [] });
  assert.ok(!first.includes(String.fromCodePoint(0xf0000)));
  const second = mark({ marker: 'other', refs: ['turn0search9'] });
  const { markdown, marks } = extract(`${raw}${first} and${second}.`);
  assert.equal(markdown, `${raw} and.`);
  // U+F0000 is two UTF-16 units.
  assert.deepEqual(marks, [
    { at: 4, slot: 0 },
    { at: 8, slot: 1 },
  ]);
  assert.deepEqual(slots, [['https://a.example/'], null]);
});

test('message citations: inline sources join the list; an unknown id is reported once', () => {
  const issues = [];
  const cites = [
    { marker: 'citeA', refs: [] },
    { marker: 'x', refs: ['turn0search1'] },
    { marker: 'y', refs: ['turn0search7'] },
  ];
  const citations = messageCitations(metadata, 'm', cites, citationSources(metadata, 'm'), (code) =>
    issues.push(code),
  );
  assert.deepEqual(
    citations.map((item) => item.url),
    ['https://a.example/', 'https://b.example/'],
  );
  assert.deepEqual(issues, ['unresolved-citations']);
});

test('numbering: cited first by first mention, several in one mark in the order cited, unresolved as [?]', () => {
  const turn = {
    markdown: 'one two three',
    citations: [
      { url: 'https://a.example/', title: 'A' },
      { url: 'https://b.example/', title: 'B' },
      { url: 'https://c.example/', title: 'C' },
    ],
  };
  const slots = [['https://c.example/'], ['https://a.example/', 'https://c.example/'], null];
  const marks = [
    { at: 3, slot: 0 },
    { at: 7, slot: 1 },
    { at: 13, slot: 2 },
  ];
  const result = numberCitations(turn, marks, slots);
  assert.equal(result.markdown, 'one[1] two[2, 1] three[?]');
  assert.deepEqual(
    result.citations.map((item) => item.title),
    ['C', 'A', 'B'],
  );
});
