// Synthetic fixtures only. Never represents, retrieves, or transmits an actual user's conversation.

const turn = (id, parent, children, role, text) => ({
  parent,
  children,
  message: {
    id,
    author: { role },
    status: 'finished_successfully',
    end_turn: role === 'assistant',
    content: { content_type: 'text', parts: [text] },
  },
});

/** Two turns, plain text: compiles verified. */
export const plainBody = JSON.stringify({
  conversation_id: 'one',
  title: 'Synthetic chat',
  current_node: 'a',
  mapping: {
    root: { parent: null, children: ['u'], message: null },
    u: turn('u', 'root', ['a'], 'user', 'Synthetic question.'),
    a: turn('a', 'u', [], 'assistant', 'Original **Markdown** 中文 ✓\n'),
  },
});

/** Two generated files with the same name in two turns: compiles partial until both are saved. */
export const chartsBody = JSON.stringify({
  conversation_id: 'two',
  title: 'Charts',
  current_node: 'a2',
  mapping: {
    root: { parent: null, children: ['u1'], message: null },
    u1: turn('u1', 'root', ['a1'], 'user', 'First chart.'),
    a1: turn('a1', 'u1', ['u2'], 'assistant', '[chart.png](sandbox:/mnt/data/chart.png)'),
    u2: turn('u2', 'a1', ['a2'], 'user', 'Second chart.'),
    a2: turn('a2', 'u2', [], 'assistant', '[chart.png](sandbox:/mnt/data/chart.png)'),
  },
});

export const packet = (body, id) => ({
  kind: 'response',
  pageUrl: `https://chatgpt.com/c/${id}`,
  responseUrl: `https://chatgpt.com/backend-api/conversation/${id}`,
  capturedAt: '2026-10-16T00:00:00.000Z',
  method: 'GET',
  body,
});
