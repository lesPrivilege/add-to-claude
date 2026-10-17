# Decision log: reading ChatGPT and projecting it

Choices a well-meant pull request could undo. Each says what was decided, why, and the code and tests that hold it. Decided by the owner unless noted.

## 1. Laid-out answers converge to plain text

- **Decision (owner, 2026-10-17).** Cards, flows and other laid-out answers are read as plain text in reading order, flush left. The layout is not rebuilt per widget, and a stage flow's arrows are not drawn.
- **Why.** ChatGPT's layout markup changes often, and fitting the projection to one snapshot of it breaks on the next. Words that carry the meaning are enough: the reader, a person or a model, infers the relations.
- **So.** A new layout tag joins the known lists in `src/chatgpt-markup.js` and unwraps to its content. A request to reproduce a card's geometry, columns or connectors is declined.
- **Exceptions, by necessity rather than fidelity.**
  - A `WritingBlock` keeps its indentation, since that is authored Markdown.
  - Inline SVG stays whole in a fenced block.
  - Fenced code keeps its shape.
- Tests: `tests/chatgpt-markup.test.js` ("nested layout goes flush left…").

## 2. Reading is passive

- **Decision.** The page observer reads only what the ChatGPT page loads by itself. It never refreshes, polls, scrolls or fetches history.
- **The one exception.** The observer requests a file's short-lived download link, through the page's session, only when the user adds a conversation with files.
- **Why.**
  - The project's rules forbid background history scraping.
  - Requests the page did not make are the kind a service notices.
  - A passive reader cannot load more than the user chose to open.
- **Cost, accepted.** A long reply that finishes while the page is not streaming it, such as a long task, needs the reload button (⌘R) before Add sees it. A better signal is welcome; an automatic re-fetch is not, unless it keeps to this decision.
- Code: `src/page-observer.js`. Tests: `tests/page-observer.test.js`.

## 3. Citations are marked by position, never by rewriting text

- **Decision (0.6.1).** Each inline citation leaves a mark at its position: `[n]`, `[1, 2]`, or `[?]` when no source matches. The marks pass through the markup reader as a sentinel character the text does not contain, and come out as positions. Labels are inserted at those positions only after the turn's numbered References are final.
- **Why.** The first version replaced placeholders in the text after reading it. The 0.6.1 review found that this could alter code and user text that happened to contain the placeholder. Positions cannot touch anything else.
- **Numbering.**
  - Sources cited in the text come first, in order of first mention; the rest follow.
  - When a turn spans several messages, its marks are shifted into the merged text before numbering.
  - A mark citing several sources lists their numbers smallest first, as `[1, 2]` (owner, 2026-10-17).
- Code: `src/export-citations.js`. Tests: `tests/export-citations.test.js`, and "citation marks never rewrite other text" in `tests/chatgpt-response.test.js`.

## 4. Terminals receive one line

- **Decision (owner, 2026-10-16).**
  - The hand-off goes to a file.
  - The terminal receives a single `@"/path/handoff.md"` reference, with no newline. Multi-line text is never typed or pasted, and Return is never pressed.
  - The adapter works at the level of the window or tab, not per agent TUI.
- **Why.** A terminal may be showing a shell, not an agent. An unexecuted one-line path is harmless at a shell prompt and is a file mention in an agent.
- **How it was built (owner, 2026-10-17).**
  - Add never types or pastes into a terminal. It writes the file, puts the line on the clipboard and brings the chosen terminal window forward; the user pastes with ⌘V. This works the same in any terminal app, needs no Automation permission and no per-terminal script.
  - Why not automatic: delivering into a chosen tab was built first, for Terminal and iTerm2 over Apple Events. On the owner's Mac, Terminal did not take the line while in the background (its Paste menu item, pressed over Accessibility), and iTerm2 was not available to try. The owner chose one paste-by-hand path for every terminal over two fragile automatic ones.
  - So a target is a terminal window, not a tab, and Add neither reads the screen nor names the foreground process; the user sees both when pasting. A copied line is not a pasted one: the outcome waits for It's There; Copy Again keeps the question open.
  - The file is `handoff-<conversation>-<window>.add-to-claude.md` in the conversation's files folder: one per source conversation and terminal window (owner, 2026-10-17, so adding to a second window never changes what the first was given), replaced by each Add there, removed by Clear History and once a day old (at launch or when the panel opens). It is the next message's material, not an archive. A file of that name that Add did not write, or that changed since, is never replaced or removed.
  - The path carries nothing a shell acts on inside double quotes (`"`, `$`, backticks, `\`, `!`): folder names are cleaned of them, and a files folder whose own path has one is refused. A line left at a prompt and run by Return then runs nothing.
  - A terminal never says which conversation an agent holds, so its identity is the window's session: unconfirmed until the user says Continue in this conversation.
- Code: `native/Terminal.swift`. Tests: `tests/native/BarTests.swift`.
