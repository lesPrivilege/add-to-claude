# Hand-off format

What Add writes into a composer or a terminal's hand-off file, and what Copy and Save give. It is the outward contract: an agent or person on the receiving side may rely on what this page says, and nothing else. This is **format 1**, as of 0.6.1.

- `projectMarkdown` in `src/projection.js` produces it.
- The app points file lines at local copies with `linkFiles` in `native/Prepared.swift`.

## Rules for changing it

- A change that a receiver could notice updates this page in the same commit. Examples: a heading, a line's shape, the order of sections, or what a comment holds.
- A change that breaks a reader of the old shape bumps the format number here and goes in the release notes. Examples: renaming a heading, dropping a line, or reordering sections.
- Adding a new kind of content check or a new file status does not break a reader. It still goes in the release notes.

## Shape

```text
# <conversation title>

Source: <https://chatgpt.com/c/<id>> · <N> turns · verification: verified|partial|unverified
Turns 3–4 of 4 · new since last add                  ← only when not every turn is carried
<!-- selected branch: <leaf id> -->
Selected branch only; <k> branch variants exist.     ← only when there are other branches

## Content checks                                    ← only when there is something to review

- <one line per distinct check>

## Turn 1 — User
<!-- source: <locator> -->

<the turn's Markdown>

## Turn 2 — Assistant
<!-- source: <locator>, <locator> -->
_Content: partial_                                   ← only when the turn is not original Markdown

<the turn's Markdown, with [n] citation marks>

### References

1. [<title>](<https://…>)

### Files

- <name> — download-needed · <https://…>

## Files                                             ← files that belong to no turn

- <name> — download-needed
```

The arrows and what follows them are annotations, not part of the text. Lines with no blank between them are written that way: the header lines run together, and a turn's heading, source comment and content note do too.

## Lines and sections

- **Title.** The conversation's title, on one line, with `<` and `>` escaped.
- **Source line.** The source URL, the total number of turns in the conversation, and the verification of what this text carries:
  - `verified` means every turn is original Markdown and nothing needs review.
  - `partial` means something needs review: a content check applies, a turn is not original Markdown, a file is not available locally, or the source could not be complete (a reply read over the WebSocket, or a streamed reply that did not finish).
  - `unverified` means the source was a page snapshot rather than ChatGPT's own data, so nothing could be checked.
- **Scope line.** Present only for some of the turns. It reads one of:
  - `Turn N of M`
  - `Turns A–B of M`
  - `Selected turns: 3, 5–9 of M`

  It may be followed by `·` and one note: `new since last add`, `new and changed since last add`, `chosen` or `added again`.

- **Comments.** HTML comments carry locators: where in the source each turn came from, and the selected branch. They are kept for provenance and do not render. `--` inside them is written `- -`.
- **Content checks.** Each distinct check once, in the order first raised. A check is a sentence for a person, not a code. Once every file a "download this file" check was about has a local copy, the app removes that check, and the heading too if nothing else is left.
- **Turns.**
  - Turns are numbered by their position in the whole conversation, even when only some are carried.
  - The role is `User` or `Assistant`.
  - One turn is one side of an exchange: assistant messages in a row form one turn (a note before a tool call, then the answer), and its source comment lists each message.
  - A structured-code turn is a fenced block with its language. A language that is not a plain identifier goes on a `Language:` line above the fence instead.
- **Turn body.** The original Markdown where the source has it. ChatGPT's own rendering markup is read as the Markdown its Copy button gives. Hidden reasoning and tool traffic are left out.
- **Citations.** `[n]` refers to item n of the turn's References. `[1, 2]` is several sources. `[?]` is a citation that matched no source; a content check says so.
- **References.** A numbered list per turn, each `n. [title](<url>)`, the URL in angle brackets. The sources cited in the text come first, in order of first mention.
- **Files.** One line per file: its name, then a status:
  - `download-needed` (the text holds a reference only);
  - `inaccessible`;
  - `expired`;
  - `available`.

  A link follows when the source gave one. Once Add has saved a file, its line reads ``- <name> — `<absolute path>` · sha256 <hex>``. The path is in backticks; when it contains a backtick itself, double backticks are used. When every file has a copy and only the files kept the text partial, the source line reads `verification: verified`.

## For a terminal

The text above goes to `handoff-<conversation>-<window>.add-to-claude.md` in the conversation's files folder: the first eight letters and digits of the ChatGPT conversation id (`unsaved-` and a per-Add value before it has one), then the first six of the terminal window's session id, and the clipboard receives one line naming it, with no newline, for the user to paste into the terminal:

```text
@"/Users/<you>/Downloads/Add to Claude/<conversation title>/handoff-6812a3f0-9f8e7d.add-to-claude.md"
```

The path is absolute and never contains a control character or a character a shell acts on inside double quotes (`"`, `$`, backticks, `\`, `!`), so the line needs no escaping. The file is replaced by the next Add of the same conversation to the same terminal window, so a receiver should read it when the line arrives.

## Guarantees

- Text is data. Nothing in the hand-off is meant to be run, and the app never sends it or presses Return.
- No account id, cookie or token appears in it. ChatGPT's internal file names are cut down to the part after the account prefix.
- What is carried is in source order on the selected branch. Nothing is reordered or summarised.
