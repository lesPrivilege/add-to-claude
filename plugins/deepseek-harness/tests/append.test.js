import test from 'node:test';
import assert from 'node:assert/strict';
import { appendToComposer, appendedText, endSpan } from '../shared/append.js';

/** A stand-in for the session's InputActions over a plain-text draft (detect = clipboard without chips). */
function composer(state) {
  const calls = [];
  return {
    calls,
    actions: {
      captureInsertion: () => ({ start: 0, end: 0, draftRev: state.draftRev }),
      insertText: (text, span) => {
        calls.push(['insertText', text, span]);
        return span.draftRev === state.draftRev && span.end <= endSpan(state, 0).end;
      },
      setDraft: (text) => calls.push(['setDraft', text]),
      submit: () => calls.push(['submit']),
    },
  };
}

const plain = (draft, extra = {}) => ({
  draft,
  draftRev: 7,
  phase: 'plain',
  occurrences: [],
  attachmentIds: [],
  ...extra,
});

test('the end of the draft counts each reference chip as one character', () => {
  // Clipboard text "see @\"/a/b.md\" now": the chip spans 10 clipboard characters, one detect character.
  const state = plain('see @"/a/b.md" now', { occurrences: [{ offset: 4, length: 10 }] });
  assert.deepEqual(endSpan(state, 3), { start: 9, end: 9, draftRev: 3 });
  assert.deepEqual(endSpan(plain(''), 1), { start: 0, end: 0, draftRev: 1 });
});

test('appended text is separated from the draft by one blank line', () => {
  assert.equal(appendedText('', '# T'), '# T');
  assert.equal(appendedText('  \n', '# T'), '# T');
  assert.equal(appendedText('hi', '# T'), '\n\n# T');
  assert.equal(appendedText('hi\n', '# T'), '\n# T');
  assert.equal(appendedText('hi\n\n', '# T'), '# T');
});

test('Add appends at the end of the draft, never replaces it and never submits', () => {
  const state = plain('my notes');
  const { actions, calls } = composer(state);
  assert.equal(appendToComposer(actions, state, '# Chat\n'), 'appended');
  assert.deepEqual(calls, [['insertText', '\n\n# Chat\n', { start: 8, end: 8, draftRev: 7 }]]);
});

test('an empty draft that refuses insertion is set instead', () => {
  const state = plain('');
  const { actions, calls } = composer(state);
  actions.insertText = (text, span) => (calls.push(['insertText', text, span]), false);
  assert.equal(appendToComposer(actions, state, '# Chat\n'), 'set');
  assert.deepEqual(calls.at(-1), ['setDraft', '# Chat\n']);
});

test('a non-empty draft that refuses insertion is left alone', () => {
  const state = plain('keep me');
  const { actions, calls } = composer(state);
  actions.insertText = () => false;
  assert.equal(appendToComposer(actions, state, '# Chat\n'), 'changed');
  assert.ok(!calls.some(([name]) => name === 'setDraft' || name === 'submit'));
});

test('a stale view of the draft or a busy composer writes nothing', () => {
  const state = plain('old');
  const { actions, calls } = composer({ ...state, draftRev: 8 });
  assert.equal(appendToComposer(actions, state, '# Chat\n'), 'changed');
  assert.equal(calls.length, 0);
  for (const phase of ['adjudicating', 'claimed', 'submitting']) {
    const busy = composer(plain('x', { phase }));
    assert.equal(appendToComposer(busy.actions, plain('x', { phase }), '# Chat\n'), 'busy');
    assert.equal(busy.calls.length, 0);
  }
});
