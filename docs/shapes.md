# Known ChatGPT shapes

ChatGPT changing the shape of its data is the main way this tool goes wrong without saying so. This page lists every shape the code reads: where it is read, the synthetic test that pins it, and when it was first handled (the date of the first commit that read it). A shape is described in words. The fixtures are written by hand, never copied from a real conversation.

## How a change shows up

- **In the hand-off.** Anything the reader does not recognise gets a content check at the top of the text, and its turn is marked partial. The checks include an unknown role or content type, a part that isn't text, an unfamiliar citation structure, a citation with no source (`[?]`), and a marker it cannot read (`unreadable-markup`).
- **In diagnostics.** Each hand-off records how many of each check it raised, by code only (`checks=unreadable-markup:1,…`). A code that is new, or one that suddenly rises, means the data changed. Diagnostics never hold the text.
- **What to do.**
  1. Write a synthetic fixture for the new shape, saying in words which real case it stands for.
  2. Handle the shape. Following the owner's rule, converge it to plain text rather than rebuild a widget.
  3. Add a row below.

## Transport: how a conversation reaches the page

| Shape                                                                                      | Read in                                     | Pinned by                     | First handled |
| ------------------------------------------------------------------------------------------ | ------------------------------------------- | ----------------------------- | ------------- |
| The conversation as a tree (`mapping`, `current_node`), fetched by GET                     | `chatgpt-response.js`, `import.js`          | `chatgpt-response.test.js`    | 2026-10-12    |
| The paged load: pages of messages, the older ones loaded while scrolling up                | `paged-conversation.js`, `page-observer.js` | `page-observer.test.js`       | 2026-10-14    |
| A streamed reply: v1 append deltas, classic full-message updates, root envelopes           | `event-stream.js`, `chatgpt-stream.js`      | `chatgpt-stream.test.js`      | 2026-10-13    |
| A reply over the WebSocket topic: catch-ups, then live deltas                              | `chatgpt-socket.js`                         | `chatgpt-socket.test.js`      | 2026-10-14    |
| A streamed exchange laid onto the history that was already loaded                          | `stream-conversation.js`                    | `stream-conversation.test.js` | 2026-10-13    |
| A file's link, asked through the page's session (`files/download`, `interpreter/download`) | `page-observer.js`                          | `page-observer.test.js`       | 2026-10-16    |

## Messages

| Shape                                                                                                                | Read in                 | Pinned by                                              | First handled |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------ | ------------- |
| Text and multimodal parts; a non-text part is a file reference plus a check                                          | `import.js`             | `model.test.js`                                        | 2026-10-12    |
| Structured code (`content_type: code`) kept as its own turn                                                          | `import.js`             | `model.test.js`                                        | 2026-10-12    |
| Reasoning, memory and tool traffic hidden rather than reported                                                       | `message-visibility.js` | `chatgpt-response.test.js`                             | 2026-10-13    |
| A note before a tool call and the answer after it: one turn                                                          | `import.js`             | `chatgpt-response.test.js`                             | 2026-10-17    |
| Sources: `content_references` (with `hidden`, `entity`, `image_group` linkless), `search_result_groups`, `citations` | `export-citations.js`   | `chatgpt-response.test.js`, `export-citations.test.js` | 2026-10-12    |

## Markup inside assistant text

| Shape                                                                                                                                                                          | Read in             | Pinned by                | First handled |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ------------------------ | ------------- |
| Private-use markers (U+E200 kind U+E202 field … U+E201): `cite` and `url` for citations, `entity` for display text, other kinds left out                                       | `chatgpt-markup.js` | `chatgpt-markup.test.js` | 2026-10-12    |
| Laid-out answers: `box`, `row`, `grid`, `text`, `caption`, `badge`, form controls, `icon`, `divider`, `AsyncImage`, `Entity`, `Link`, `Cite`, read flush left in reading order | `chatgpt-markup.js` | `chatgpt-markup.test.js` | 2026-10-16    |
| `WritingBlock`, keeping its Markdown indentation                                                                                                                               | `chatgpt-markup.js` | `chatgpt-markup.test.js` | 2026-10-16    |
| Inline SVG, kept whole in a fenced block                                                                                                                                       | `chatgpt-markup.js` | `chatgpt-markup.test.js` | 2026-10-16    |
| A scripted widget's template lines (`{@…}`, `{#each}`, lone bound values), dropped and flagged                                                                                 | `chatgpt-markup.js` | `chatgpt-markup.test.js` | 2026-10-16    |
| `MemoryCite`, dropped with the space before it                                                                                                                                 | `chatgpt-markup.js` | `chatgpt-markup.test.js` | 2026-10-17    |

## Files

| Shape                                                                                                                                          | Read in           | Pinned by                                | First handled |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------- | ------------- |
| `metadata.attachments` and asset pointers in parts                                                                                             | `export-files.js` | `model.test.js`, `export-files.test.js`  | 2026-10-12    |
| `sandbox:/mnt/data/…` links in the text                                                                                                        | `export-files.js` | `bridge.test.js`, `export-files.test.js` | 2026-10-12    |
| A generated file attached under ChatGPT's internal name (`user-<id>_<hex>_mnt_data_<path>`), joined to its link and stripped of the account id | `export-files.js` | `bridge.test.js`, `export-files.test.js` | 2026-10-16    |

## Known and not handled

- A long paste that ChatGPT turns into an unnamed attachment: listed as "…" and not downloaded.
- A scripted widget's lines that mix text with bound values (`**{c.id} · {c.title}**`): kept, with the widget check raised.
- Unknown tags in prose are left as written and are not counted, since an answer may legitimately show a tag outside a code span.
