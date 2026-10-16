import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../../src/compile.js';
import { readyFrom } from '../shared/protocol.js';
import { folderName, freeName, linkFiles, safeFileName, safeLabel } from '../shared/files.js';
import { chartsBody, packet, plainBody } from './fixtures.js';

const prepare = (body, id) => {
  const compiled = compile(packet(body, id));
  return readyFrom(
    { kind: 'ready', page: `https://chatgpt.com/c/${id}`, ...compiled },
    `https://chatgpt.com/c/${id}`,
  );
};

test('file names stay inside their folder', () => {
  assert.equal(safeFileName('report.pdf'), 'report.pdf');
  assert.equal(safeFileName('../../etc/passwd'), '_.-..-etc-passwd');
  assert.equal(safeFileName('a/b:c'), 'a-b-c');
  assert.equal(safeFileName('.hidden'), '_hidden');
  assert.equal(safeFileName('..'), 'file');
  assert.equal(safeFileName('  '), 'file');
  assert.equal(safeFileName('x\u0000y‮z'), 'xyz');
  assert.equal(Array.from(safeFileName('界'.repeat(300))).length, 120);
  assert.equal(folderName(''), 'conversation');
  assert.equal(Array.from(folderName('t'.repeat(200))).length, 80);
  assert.equal(safeLabel('a\nb\tc', 90), 'abc');
});

test('a taken name gets the next free number, keeping its extension', () => {
  const taken = new Set(['chart.png', 'chart 2.png']);
  assert.equal(
    freeName('chart.png', (name) => taken.has(name)),
    'chart 3.png',
  );
  assert.equal(
    freeName('notes', (name) => name === 'notes'),
    'notes 2',
  );
  assert.equal(
    freeName('free.txt', () => false),
    'free.txt',
  );
});

test('linkFiles: one of two same-name files keeps the other reference and the check', () => {
  const prepared = prepare(chartsBody, 'two');
  assert.equal(prepared.verification, 'partial');
  assert.equal(prepared.attachments.length, 2);
  const [first, second] = prepared.attachments;
  const one = linkFiles(prepared, new Map([[first.key, { path: '/f/chart.png', sha256: 'aa' }]]));
  assert.ok(one.markdown.includes('- chart.png — `/f/chart.png` · sha256 aa'));
  assert.ok(one.markdown.includes('- chart.png — download-needed'));
  assert.ok(one.markdown.includes('## Content checks'));
  assert.ok(one.markdown.includes('verification: partial'));
  assert.equal(one.note.startsWith('1 of 2 files linked'), true);

  const both = linkFiles(
    prepared,
    new Map([
      [first.key, { path: '/f/chart.png', sha256: 'aa' }],
      [second.key, { path: '/f/chart 2.png', sha256: 'bb' }],
    ]),
  );
  assert.ok(both.markdown.includes('`/f/chart.png` · sha256 aa'));
  assert.ok(both.markdown.includes('`/f/chart 2.png` · sha256 bb'));
  assert.ok(!both.markdown.includes('Content checks'));
  assert.ok(both.markdown.includes('verification: verified'));
  assert.ok(!both.markdown.includes('\n\n\n'));
  assert.equal(both.note, '2 files linked.');
});

test('linkFiles quotes a path that holds a backtick and leaves a plain conversation unchanged', () => {
  const prepared = prepare(chartsBody, 'two');
  const [first] = prepared.attachments;
  const quoted = linkFiles(prepared, new Map([[first.key, { path: '/f/a`b.png', sha256: 'cc' }]]));
  assert.ok(quoted.markdown.includes('— `` /f/a`b.png `` · sha256 cc'));

  const plain = prepare(plainBody, 'one');
  assert.deepEqual(linkFiles(plain, new Map()), { markdown: plain.markdown, note: '' });
});
