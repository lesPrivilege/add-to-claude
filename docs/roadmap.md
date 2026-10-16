# Roadmap

Recorded 2026-10-16 from the owner's plan. Order matters more than dates.

## Where things stand

The menu-bar app (0.6.0) is the form that ships. ChatGPT is the source, and the destination is any open app with a text box, reached through Accessibility.

## 0.6.1

Done in code (see [release/0.6.1.md](release/0.6.1.md)): the bundle is "Add to Claude.app"; saved files are reused across launches; one turn per exchange; citations marked in place.

Still open:

- **Cards and flowcharts keep order and hierarchy.** First confirm where the arrows go (suspected: arrow `<icon>` dropped as decoration, `row`/`grid` flattened to indented prose) on a synthetic sample of the raw markup. Then: arrow icons become `→`, a `row`'s items join with `→` (or `·`), each `box` is a paragraph with a bold title, `grid` items a list. Waits on that sample.

## Next forms

1. **Claude mod.** Waits until Claude's newly released mod format settles, so the port is an adaptation rather than a rewrite.
2. **Your own browser as an optional source.** No second sign-in: a browser extension reads the conversation in the tab you already use. Prefer a plain content script limited to chatgpt.com and the few hosts it needs; ask for `debugger` only if something turns out to need it, since it shows a permanent "being debugged" bar and draws stricter store review. It feeds the same shared format, so nothing downstream changes.
3. **Terminal windows and tabs as destinations.** Owner's decision (2026-10-16): adapt at the level of the terminal window or tab, not per TUI agent, since agent TUIs are many and change often. Safety rules, because a terminal may be showing a shell rather than an agent:
   - Never type or paste multi-line text, and never press Return. The hand-off goes to a file in the conversation's folder, and the terminal receives one line: an `@"/path/handoff.md"` reference (or the bare path), with no newline. At a shell prompt that is an unexecuted line; in an agent TUI it is a file mention.
   - Target a specific tab (Terminal.app and iTerm2 expose windows, tabs and each tab's tty); say which tab, and show its foreground process name so the user can see whether it is an agent or a shell.
   - Prefer the terminal's own paste over synthetic keystrokes, so bracketed paste applies.
   - Needs its own adapter and tests; until then terminals stay excluded from the picker.
4. **More chat providers.** Claude chat first, so a Claude conversation can be added to a harness composer too.

## Waiting on upstream

- **DeepSeek Harness mod.** Built as `dsh-chatgpt-panel` 0.1.0 and shelved on 2026-10-16: the harness gives plugins no way to host ChatGPT inside its window with a lasting sign-in, so the only form left was a separate Electron window, weaker than the menu-bar app. It reopens when the harness offers a plugin-owned web view with a persistent session, sign-in popups, downloads and an isolated-world script, or a parented child window. Findings, options and how to restore the code: [decisions/deepseek-harness-plugin.md](decisions/deepseek-harness-plugin.md).

## Shape that keeps this N + M, not N × M

Sources and destinations meet at one format, so a new provider or a new form adds one adapter on its side only.

- **Shared format.** The validated conversation model in `src/model.js`: turns with roles, original Markdown, references, files and verification. The hand-off text is projected from it (`projectMarkdown`).
- **Source adapters.** A page observer and an importer per provider that produce that model. Today: `src/page-observer.js`, `src/chatgpt-response.js` and `src/import.js`.
- **Destination adapters.** Whatever writes the projected text and file list into a composer. Today: `native/Composer.swift` (Accessibility). The shelved DeepSeek Harness mod showed that a harness form replaces only this layer, plus a host for the source page, and keeps the rest.

Before a second provider, move two things into the shared shape:

- **File links.** How a file's download link is obtained is ChatGPT-specific today: the observer's resolver (`src/page-observer.js`) asks for `files/download` and `interpreter/download` links, and the link matching in `native/Files.swift` and `native/Chat.swift` keys files by ChatGPT's file ids and sandbox paths. Each source adapter should supply its own link step behind one interface; the download itself already takes a plain URL.
- **File lines.** Pointing a file line at its local copy (`linkFiles`) lives in `native/Handoff.swift`. Once a second form exists it belongs in `src/` as one function both forms use.
- **Selection.** Done in the menu-bar app in 0.6.0 ([decision log](decisions/incremental-handoff.md)).
  - The projection of chosen turns is in the shared format (`projectMarkdown` with `turnIds`, plus per-turn hashes from `describeTurns`).
  - The delivery log and the scope rule live natively in `native/Delivery.swift`.
