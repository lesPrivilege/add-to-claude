import test from 'node:test';
import assert from 'node:assert/strict';
import {
  importBrowserResponse,
  isSelectedResponse,
  originalSource,
} from '../src/chatgpt-response.js';
import { projectMarkdown, validateConversation } from '../src/model.js';

const pageUrl = 'https://chatgpt.com/c/synthetic-original';
const evidence = {
  pageUrl,
  responseUrl: 'https://chatgpt.com/backend-api/conversation/synthetic-original',
  capturedAt: '2026-10-12T14:00:00.000Z',
};
function fixture() {
  const node = (id, parent, role, text) => ({
    id,
    parent,
    message: {
      author: { role },
      status: 'finished_successfully',
      content: { content_type: 'text', parts: [text] },
    },
  });
  return {
    conversation_id: 'synthetic-original',
    title: 'Original Markdown test',
    current_node: 'a',
    mapping: {
      alternate: node('alternate', 'u', 'assistant', 'Do not merge this variant.'),
      a: node(
        'a',
        'u',
        'assistant',
        '  **Exact** 中文 ✓\n\n```mermaid\ngraph LR; A-->B\n```\n\n$E=mc^2$\n',
      ),
      u: node(
        'u',
        'root',
        'user',
        'Keep <https://example.com/> and [a](<https://example.com/a>)\n',
      ),
      root: { id: 'root', parent: null, message: null },
    },
  };
}
const read = (value = fixture(), options = evidence) =>
  importBrowserResponse(JSON.stringify(value), options);

test('original response preserves exact Markdown, parent order and selected variant', () => {
  const raw = fixture();
  const model = read(raw);
  assert.equal(model.source.type, 'chatgpt-response');
  assert.deepEqual(model.source.response, {
    url: evidence.responseUrl,
    capturedAt: evidence.capturedAt,
    observedNodes: 4,
  });
  assert.deepEqual(
    model.turns.map((turn) => turn.id),
    ['u', 'a'],
  );
  assert.equal(model.turns[1].markdown, raw.mapping.a.message.content.parts[0]);
  assert.equal(model.turns[1].sourceLocator, 'response.mapping["a"].message');
  assert.equal(model.verification.status, 'verified');
  const text = projectMarkdown(model);
  assert.ok(text.includes(raw.mapping.a.message.content.parts[0]));
  assert.ok(!text.includes('Do not merge this variant.'));
  assert.deepEqual(validateConversation(JSON.parse(JSON.stringify(model))), model);
});

test('source identity accepts GPT conversations but rejects other hosts and previews', () => {
  assert.equal(
    originalSource('https://chatgpt.com/g/g-example/c/synthetic-original?model=test').id,
    'synthetic-original',
  );
  for (const url of [
    'http://chatgpt.com/c/a',
    'https://chatgpt.com.evil.test/c/a',
    'https://chatgpt.com:444/c/a',
    'https://u@chatgpt.com/c/a',
    'https://chatgpt.com/share/a',
  ])
    assert.throws(() => originalSource(url), /conversation|shared/u);
  for (const response of [
    'https://chatgpt.com/backend-api/conversations',
    'https://chatgpt.com/backend-api/conversation/other',
    `${evidence.responseUrl}?cursor=2`,
    'https://chat.openai.com/backend-api/conversation/synthetic-original',
  ])
    assert.equal(isSelectedResponse(response, pageUrl), false, response);
  assert.equal(isSelectedResponse(evidence.responseUrl, pageUrl), true);
});

test('wrong response, mismatched IDs and absent current branch are rejected', () => {
  assert.throws(
    () => read(fixture(), { ...evidence, responseUrl: evidence.responseUrl + '/other' }),
    /does not belong/u,
  );
  assert.throws(() => read({ ...fixture(), conversation_id: 'other' }), /ID/u);
  assert.throws(() => read({ ...fixture(), id: 'other' }), /ID/u);
  assert.throws(() => read({ ...fixture(), current_node: undefined }), /selected branch/u);
  assert.throws(() => importBrowserResponse('<html>Sign in</html>', evidence), /JSON response/u);
  assert.throws(() => read({ conversation: fixture() }), /ID/u);
});

test('citations and file references retain provenance without claiming downloaded bytes', () => {
  const raw = fixture();
  raw.mapping.a.message.metadata = {
    citations: [{ url: 'https://example.com/source', title: 'Synthetic source' }],
    attachments: [
      { id: 'file-1', name: 'notes.txt', download_url: 'https://chatgpt.com/files/notes.txt' },
    ],
  };
  const model = read(raw);
  assert.equal(model.turns[1].citations[0].url, 'https://example.com/source');
  assert.match(model.turns[1].citations[0].sourceLocator, /^response\.mapping/u);
  assert.equal(model.attachments[0].status, 'download-needed');
  assert.match(model.attachments[0].sourceLocator, /^response\.mapping/u);
  assert.equal(model.verification.status, 'partial');
});

test('missing graph nodes, streaming and pagination remain visibly incomplete', () => {
  const missing = fixture();
  delete missing.mapping.u;
  assert.equal(read(missing).verification.status, 'partial');
  const streaming = fixture();
  streaming.mapping.a.message.status = 'in_progress';
  assert.equal(read(streaming).verification.status, 'partial');
  for (const flag of [{ has_more: true }, { is_truncated: true }, { next_cursor: 'next' }]) {
    const model = read({ ...fixture(), ...flag });
    assert.equal(model.verification.status, 'partial');
    assert.ok(model.verification.issues.some((issue) => issue.code === 'response-incomplete'));
  }
});

test('serialized browser evidence cannot silently change source identity or lose its timestamp', () => {
  for (const mutate of [
    (model) => {
      model.source.id = 'other';
    },
    (model) => {
      delete model.source.response;
    },
    (model) => {
      model.source.response.capturedAt = 'not a date';
    },
    (model) => {
      model.source.response.observedNodes = 0;
    },
    (model) => {
      model.source.response.url = 'https://example.com/';
    },
  ]) {
    const model = read();
    mutate(model);
    assert.throws(() => validateConversation(model), /response|Response/u);
  }
});

test('a paged load that has earlier pages unloaded is partial and says how to load them', () => {
  const body = JSON.stringify({
    conversation_id: 'paged',
    title: 'Paged',
    current_node: 'm2',
    page_info: { has_previous_page: true, has_next_page: false },
    messages: [
      {
        id: 'm1',
        author: { role: 'user' },
        status: 'finished_successfully',
        content: { content_type: 'text', parts: ['Later question'] },
      },
      {
        id: 'm2',
        author: { role: 'assistant' },
        status: 'finished_successfully',
        end_turn: true,
        content: { content_type: 'text', parts: ['Later answer'] },
      },
    ],
  });
  const model = importBrowserResponse(body, {
    pageUrl: 'https://chatgpt.com/c/paged',
    responseUrl: 'https://chatgpt.com/backend-api/conversations/paged?num_turns=40',
    capturedAt: new Date().toISOString(),
  });
  assert.equal(model.turns.length, 2);
  assert.equal(model.verification.status, 'partial');
  assert.ok(model.verification.issues.some((issue) => issue.code === 'earlier-turns-unloaded'));
  assert.throws(() =>
    importBrowserResponse(body, {
      pageUrl: 'https://chatgpt.com/c/paged',
      responseUrl: 'https://chatgpt.com/backend-api/conversations/other?num_turns=40',
      capturedAt: new Date().toISOString(),
    }),
  );
});

test('reasoning and memory entries are hidden, not reported as unsupported turns', () => {
  const message = (id, role, content_type, parts) => ({
    id,
    author: { role },
    status: 'finished_successfully',
    end_turn: role === 'assistant' && content_type === 'text' ? true : undefined,
    content: { content_type, parts },
  });
  const body = JSON.stringify({
    conversation_id: 'reasoned',
    title: 'Reasoned',
    current_node: 'a',
    page_info: { has_previous_page: false },
    messages: [
      message('u', 'user', 'text', ['Question']),
      message('t', 'assistant', 'thoughts', []),
      message('r', 'assistant', 'reasoning_recap', []),
      message('m', 'assistant', 'model_editable_context', []),
      message('a', 'assistant', 'text', ['Answer']),
    ],
  });
  const model = importBrowserResponse(body, {
    pageUrl: 'https://chatgpt.com/c/reasoned',
    responseUrl: 'https://chatgpt.com/backend-api/conversations/reasoned?num_turns=40',
    capturedAt: new Date().toISOString(),
  });
  assert.deepEqual(
    model.turns.map((turn) => turn.markdown),
    ['Question', 'Answer'],
  );
  assert.equal(model.verification.status, 'verified');
});

// A live-style paged load: the selected branch as a list of messages.
function paged(answers) {
  const messages = [];
  answers.forEach((answer, index) => {
    messages.push({
      id: `u${index}`,
      author: { role: 'user' },
      status: 'finished_successfully',
      content: { content_type: 'text', parts: [`Question ${index + 1}`] },
    });
    messages.push({
      id: `a${index}`,
      author: { role: 'assistant' },
      status: 'finished_successfully',
      end_turn: true,
      content: { content_type: 'text', parts: [answer.text] },
      metadata: answer.metadata ?? {},
    });
  });
  return importBrowserResponse(
    JSON.stringify({
      conversation_id: 'searched',
      title: 'Searched',
      current_node: messages.at(-1).id,
      page_info: { has_previous_page: false },
      messages,
    }),
    {
      pageUrl: 'https://chatgpt.com/c/searched',
      responseUrl: 'https://chatgpt.com/backend-api/conversations/searched?num_turns=40',
      capturedAt: '2026-10-16T09:00:00.000Z',
    },
  );
}
const ref = (turn_index, ref_index, ref_type = 'search') => ({ turn_index, ref_type, ref_index });
const cite = (...ids) => `cite${ids.join('')}`;

test('an ordinary web-search answer reads cleanly, lists its sources and is verified', () => {
  const urlMarker = 'urlCC Switchturn5search11';
  const entity = 'entity["software","CC Switch","a provider switcher"]';
  const text = `${entity} switches providers. ${cite('turn5search0', 'turn5search2')}\n\nSee ${urlMarker} for setup. ${cite('turn5search3')}`;
  const webpage = (title, url, refs) => ({
    title,
    url,
    pub_date: 1760000000.0,
    snippet: 'Synthetic snippet.',
    attribution_segments: null,
    supporting_websites: [],
    refs,
    hue: null,
    attributions: null,
    attribution: new URL(url).hostname,
  });
  const at = (marker) => ({
    start_idx: text.indexOf(marker),
    end_idx: text.indexOf(marker) + marker.length,
  });
  const model = paged([
    {
      text,
      metadata: {
        content_references: [
          {
            matched_text: entity,
            ...at(entity),
            refs: [],
            alt: 'CC Switch',
            prompt_text: '',
            type: 'entity',
            name: 'CC Switch',
            category: 'software',
            extra_params: { disambiguation: 'a provider switcher' },
          },
          {
            matched_text: cite('turn5search0', 'turn5search2'),
            ...at(cite('turn5search0', 'turn5search2')),
            safe_urls: ['https://example.com/a', 'https://example.org/b'],
            refs: [ref(5, 0), ref(5, 2)],
            alt: '([Example](https://example.com/a))',
            prompt_text: null,
            type: 'grouped_webpages',
            items: [
              {
                ...webpage('Example A', 'https://example.com/a', [ref(5, 0)]),
                supporting_websites: [webpage('Example B', 'https://example.org/b', [ref(5, 2)])],
              },
            ],
            fallback_items: null,
            status: 'done',
            error: null,
            style: null,
          },
          {
            matched_text: urlMarker,
            ...at(urlMarker),
            type: 'webpage_extended',
            ...webpage('CC Switch docs', 'https://example.net/docs', [ref(5, 11)]),
            alt: '[CC Switch](https://example.net/docs)',
            prompt_text: null,
          },
          {
            matched_text: cite('turn5search3'),
            ...at(cite('turn5search3')),
            type: 'hidden',
            refs: [ref(5, 3)],
            alt: '',
            prompt_text: null,
          },
          {
            matched_text: ' ',
            start_idx: text.length,
            end_idx: text.length,
            refs: [],
            alt: '',
            prompt_text: '',
            type: 'sources_footnote',
            sources: [
              { title: 'Example A', url: 'https://example.com/a', attribution: 'example.com' },
            ],
            has_images: false,
          },
        ],
        search_result_groups: [
          {
            type: 'search_result_group',
            domain: 'example.com',
            entries: [
              {
                type: 'search_result',
                url: 'https://example.com/setup',
                title: 'Setup notes',
                snippet: 'Synthetic.',
                ref_id: ref(5, 3),
                pub_date: null,
                attribution: 'example.com',
              },
            ],
          },
        ],
      },
    },
  ]);
  const answer = model.turns[1];
  assert.equal(answer.markdown, 'CC Switch switches providers.\n\nSee CC Switch for setup.');
  assert.deepEqual(answer.originalParts, [text]);
  assert.deepEqual(
    answer.citations.map((item) => [item.title, item.url]),
    [
      ['Example A', 'https://example.com/a'],
      ['Example B', 'https://example.org/b'],
      ['CC Switch docs', 'https://example.net/docs'],
      ['Setup notes', 'https://example.com/setup'],
    ],
  );
  assert.deepEqual(model.verification.issues, []);
  assert.equal(model.verification.status, 'verified');
  const text_ = projectMarkdown(model);
  assert.ok(!/[-]/u.test(text_));
  assert.ok(text_.includes('- [Setup notes](<https://example.com/setup>)'));
});

test('a laid-out answer unwraps its tags and resolves Cite refs through the search results', () => {
  const model = paged([
    {
      text: [
        '<box gap={3}>',
        '  <row align="start" gap={3}>',
        '    <box flex="1" gap={1}>',
        '      **1. <Entity category="software" value="Field Notes" disambig="a writing app"/>**',
        '      <text size="sm"><Link url="https://example.com/notes" title="Site"/> <Cite ref="turn407140search0"/></text>',
        '    </box>',
        '  </row>',
        '  <divider color="subtle"/>',
        '</box>',
      ].join('\n'),
      metadata: {
        search_result_groups: [
          {
            type: 'search_result_group',
            domain: 'example.com',
            entries: [
              {
                type: 'search_result',
                url: 'https://example.com/review',
                title: 'A review',
                ref_id: ref(407140, 0),
              },
              {
                type: 'search_result',
                url: 'https://example.com/uncited',
                title: 'Not cited',
                ref_id: ref(407140, 1),
              },
            ],
          },
        ],
      },
    },
  ]);
  const answer = model.turns[1];
  assert.equal(answer.markdown, '**1. Field Notes**\n[Site](https://example.com/notes)');
  assert.deepEqual(
    answer.citations.map((item) => item.url),
    ['https://example.com/review'],
  );
  assert.equal(model.verification.status, 'verified');
});

test('unresolvable citations, left-out images and unknown sources are each reported once', () => {
  const unknown = { type: 'product_carousel', products: [{ url: 'https://example.com/p' }] };
  const answers = Array.from({ length: 3 }, (_, index) => ({
    text: `Answer ${index}. ${cite(`turn${index}search9`)}\nimage_group{"layout":"carousel"}`,
    metadata: { content_references: [unknown, unknown] },
  }));
  const model = paged(answers);
  assert.equal(model.verification.status, 'partial');
  assert.equal(model.turns[1].markdown, 'Answer 0.');
  assert.equal(model.turns[1].contentFidelity, 'partial');
  const codes = model.verification.issues.map((issue) => issue.code);
  assert.equal(codes.filter((code) => code === 'unresolved-citations').length, 3);
  assert.equal(codes.filter((code) => code === 'omitted-inline-content').length, 3);
  assert.equal(codes.filter((code) => code === 'unrecognized-citation').length, 6);
  const checks = projectMarkdown(model).split('## Turn 1')[0];
  const lines = checks.split('\n').filter((line) => line.startsWith('- '));
  assert.equal(lines.length, 3);
  assert.equal(new Set(lines).size, 3);
  assert.ok(lines.some((line) => line.includes('unfamiliar structure')));
});
