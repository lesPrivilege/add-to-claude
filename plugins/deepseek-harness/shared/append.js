// Appending to the DeepSeek Harness composer. Plain functions without imports: the build inlines
// this file into the client bundle, and the tests import it directly.
//
// The composer's `InputState.draft` is the clipboard projection, where a reference chip spans its
// clipboard text; `TokenSpan` offsets are detect coordinates, where a chip is one character
// (ui-conversation/src/client/input/editor/projection.ts). The end of the draft in detect
// coordinates is therefore the draft's length less each chip's extra length.

/** The collapsed span at the end of the draft, under the revision the caller captured. */
export function endSpan(state, draftRev) {
  let end = state.draft.length;
  for (const occurrence of state.occurrences ?? []) end -= Math.max(0, occurrence.length - 1);
  return { start: end, end, draftRev };
}

/** The text to append: a blank line between what is there and what is added, nothing before an empty draft. */
export function appendedText(draft, markdown) {
  if (draft.trim() === '') return markdown;
  const gap = draft.endsWith('\n\n') ? '' : draft.endsWith('\n') ? '\n' : '\n\n';
  return gap + markdown;
}

/**
 * Append `markdown` to the composer without sending and without replacing anything the user wrote.
 * `actions` is the session's `InputActions`; `state` is the latest `InputState` the panel saw.
 * @returns 'appended', 'set' (the draft was empty), 'busy' or 'changed' (nothing written).
 */
export function appendToComposer(actions, state, markdown) {
  if (state.phase !== 'plain') return 'busy';
  const captured = actions.captureInsertion();
  // The panel's view of the draft is stale when the editor has moved on since; write nothing then.
  if (captured.draftRev !== state.draftRev) return 'changed';
  if (actions.insertText(appendedText(state.draft, markdown), endSpan(state, captured.draftRev)))
    return 'appended';
  if (state.draft === '' && (state.occurrences ?? []).length === 0) {
    actions.setDraft(markdown);
    return 'set';
  }
  return 'changed';
}
