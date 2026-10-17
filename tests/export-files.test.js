import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentList, sandboxLinks, settleAttachments } from '../src/export-files.js';

test('attachment list: once per message, a safe name, and an issue for each', () => {
  const issues = [];
  const { list, add } = attachmentList((code, message, sourceLocator) =>
    issues.push({ code, message, sourceLocator }),
  );
  assert.equal(add({ id: 'file-1', name: '../a/b.txt' }, 'p0', 'm1'), true);
  assert.equal(add({ id: 'file-1', name: 'again' }, 'p1', 'm1'), true);
  assert.equal(add({ name: 'no pointer' }, 'p2', 'm1'), false);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, '.._a_b.txt');
  assert.equal(list[0].messageId, 'm1');
  assert.deepEqual(
    issues.map((item) => item.code),
    ['attachment-download-needed'],
  );
});

test('sandbox links: the decoded last segment, with its offset', () => {
  assert.deepEqual(
    sandboxLinks('see [x](sandbox:/mnt/data/out/a%20b.csv) and sandbox:/mnt/data/%E0'),
    [
      { id: 'sandbox:/mnt/data/out/a%20b.csv', name: 'a b.csv', offset: 8 },
      { id: 'sandbox:/mnt/data/%E0', name: '%E0', offset: 45 },
    ],
  );
});

test('settle: folded turns, a sandbox link joined to its attached copy, no account id in names', () => {
  const issues = [];
  const { list, add } = attachmentList((code, message, sourceLocator) =>
    issues.push({ code, message, sourceLocator }),
  );
  add({ id: 'sandbox:/mnt/data/dir/r.csv', name: 'r.csv' }, 'link', 'm2');
  add({ id: 'file-9', name: 'user-abc_123_mnt_data_dir_r.csv' }, 'tool');
  add({ id: 'file-8', name: 'user-abc_456_mnt_data_other.txt' }, 'tool2');
  settleAttachments(list, issues, new Map([['m2', 'm1']]));
  assert.deepEqual(
    list.map(({ id, name, turnId, messageId }) => ({ id, name, turnId, messageId })),
    [
      { id: '2:file-9', name: 'r.csv', turnId: 'm1', messageId: 'm2' },
      { id: '3:file-8', name: 'other.txt', turnId: undefined, messageId: undefined },
    ],
  );
  assert.deepEqual(
    issues.map((item) => item.sourceLocator),
    ['tool', 'tool2'],
  );
  assert.ok(issues.every((item) => !item.message.includes('user-abc')));
});

test('a name with replacement patterns ($&, $`) never brings the account id back', () => {
  const issues = [];
  const { list, add } = attachmentList((code, message, sourceLocator) =>
    issues.push({ code, message, sourceLocator }),
  );
  add({ id: 'file-8', name: 'user-abc_456_mnt_data_$&.txt' }, 'tool');
  add({ id: 'sandbox:/mnt/data/$`.csv', name: '$`.csv' }, 'link', 'm1');
  add({ id: 'file-9', name: 'user-abc_789_mnt_data_$`.csv' }, 'tool2');
  settleAttachments(list, issues, new Map());
  assert.deepEqual(
    list.map((file) => file.name),
    ['$&.txt', '$`.csv'],
  );
  for (const issue of issues) assert.ok(!issue.message.includes('user-abc'), issue.message);
  assert.ok(issues[0].message.startsWith('$&.txt: '));
});
