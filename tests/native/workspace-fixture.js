// A normal source fetch, served wholly in memory; no account/network or user draft.
window.workspaceFixture = async (id, mode = 'complete') => {
  history.replaceState({}, '', `/c/${id}`);
  const message = (id, role, text) => ({
    id,
    author: { role },
    status: 'finished_successfully',
    end_turn: true,
    content: { content_type: 'text', parts: [text] },
  });
  const answer = message(
    'a',
    'assistant',
    mode === 'long' ? '原文 ✓\n'.repeat(400000) : '**Original answer** ✓\n',
  );
  if (mode === 'partial') answer.status = 'in_progress';
  window.fixtureBody = JSON.stringify({
    conversation_id: id,
    current_node: 'a',
    title: `Synthetic ${id}`,
    mapping: {
      root: { parent: null, message: null },
      u: { parent: 'root', message: message('u', 'user', 'Synthetic question.') },
      a: { parent: 'u', message: answer },
    },
  });
  return (await fetch(`https://chatgpt.com/backend-api/conversation/${id}`)).text();
};
window.fixtureRequests = 0;
window.fetch = async (url) => {
  window.fixtureRequests++;
  const identify = (value) => {
    Object.defineProperty(value, 'url', { value: url });
    const clone = value.clone.bind(value);
    value.clone = () => identify(clone());
    return value;
  };
  return identify(new Response(window.fixtureBody));
};
