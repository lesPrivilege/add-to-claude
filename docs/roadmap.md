# Roadmap

Recorded 2026-10-16 from the owner's plan. Order matters more than dates.

## Where things stand

The menu-bar app (0.6.0) is the form that ships. ChatGPT is the source, and the destination is any open app with a text box, reached through Accessibility.

## 0.6.1

Done (see [release/0.6.1.md](release/0.6.1.md)): the bundle is "Add to Claude.app"; saved files are reused across launches; one turn per exchange; citations marked in place; laid-out cards read flush left.

Owner's rule for cards (2026-10-17): do not fit the projection to one snapshot of ChatGPT's layout. Words that carry the meaning are enough; the reader infers the relations. So layout markup converges to plain text in reading order rather than being reconstructed per widget.

## Open to contributions

- **Saved files reused after a relaunch, on a real Mac.** The logic is tested (`SavedFiles` in the delivery-log suite); a hand run of quit, reopen and Add again is still open.
- **Picking up a long reply without a reload.** Reading is passive, so a long task's answer needs the reload button (top left, ⌘R), which is easy to miss. Left as it is for 0.6.1; a better signal or an automatic re-read is welcome as a community PR.

## Maturity and long-term maintenance

Recorded 2026-10-17 from the owner's review. Worked in this order; CI and release automation wait for the owner's go.

1. **Licence and contributor docs.** A licence (the repo is `UNLICENSED` today, so a community PR cannot be accepted), `CONTRIBUTING.md` (the project's rules for people, how to run the three suites, synthetic fixtures only) and `SECURITY.md` (how to report a vulnerability).
2. **Split the large modules.** `src/import.js` into the export graph, citation marks and numbering, and attachment matching, each pure and tested on its own (done: `export-graph.js`, `export-citations.js`, `export-files.js`; turn folding stays in `import.js`); `src/model.js` into validation and projection (done: `projection.js`; the demo fixture moved to `tests/`); `native/Handoff.swift` into assembly, file lines and UI state (done: the data types and `linkFiles` in `Prepared.swift`, the button in `Views.swift`; the bar itself stays one controller, and the build scripts take `native/*.swift`).
3. **Drift signal.** ChatGPT changing its response shape is the main long-term risk. The importer counts node and content types it does not recognise and names them in the top notice, as `[?]` already does for citations; diagnostics keep the counts only, never content. A synthetic shape corpus records each known shape and the period it stands for.
4. **Written knowledge.** Short decision records for choices a PR could undo: cards converge to plain text, reading is passive, terminals receive one `@path` line, citations are marked by position. A versioned spec for the hand-off format (`projectMarkdown` is the outward contract). A one-page threat model: trust boundaries, what each validates, accepted risks.
5. **Versioned state on disk.** `saved-files.json` and the delivery log carry a `version`; a mismatch is discarded and rebuilt, with no migration.
6. **Bridge schema.** The messages between the page scripts and the native app are validated on both sides from one definition, or at least from one shared set of fixtures.
7. **Before a second provider.** The file-link step behind a source-adapter interface, `linkFiles` moved into `src/` (see below), and a contract suite every source adapter must pass.
8. **Waiting for the owner's go.** CI on a macOS runner (unit, browser, delivery log and WebKit suites; Accessibility stays a hand run), a release script (zip, checksum, tag, release, download and verify), Developer ID signing and notarization, a universal binary, and an update channel.

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

- **Shared format.** The validated conversation model in `src/model.js`: turns with roles, original Markdown, references, files and verification. The hand-off text is projected from it (`projectMarkdown` in `src/projection.js`).
- **Source adapters.** A page observer and an importer per provider that produce that model. Today: `src/page-observer.js`, `src/chatgpt-response.js`, and `src/import.js` with its `export-*.js` parts.
- **Destination adapters.** Whatever writes the projected text and file list into a composer. Today: `native/Composer.swift` (Accessibility). The shelved DeepSeek Harness mod showed that a harness form replaces only this layer, plus a host for the source page, and keeps the rest.

Before a second provider, move two things into the shared shape:

- **File links.** How a file's download link is obtained is ChatGPT-specific today: the observer's resolver (`src/page-observer.js`) asks for `files/download` and `interpreter/download` links, and the link matching in `native/Files.swift` and `native/Chat.swift` keys files by ChatGPT's file ids and sandbox paths. Each source adapter should supply its own link step behind one interface; the download itself already takes a plain URL.
- **File lines.** Pointing a file line at its local copy (`linkFiles`) lives in `native/Prepared.swift`. Once a second form exists it belongs in `src/` as one function both forms use.
- **Selection.** Done in the menu-bar app in 0.6.0 ([decision log](decisions/incremental-handoff.md)).
  - The projection of chosen turns is in the shared format (`projectMarkdown` with `turnIds`, plus per-turn hashes from `describeTurns`).
  - The delivery log and the scope rule live natively in `native/Delivery.swift`.
