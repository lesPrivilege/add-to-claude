# Roadmap

Recorded 2026-10-16 from the owner's plan. Order matters more than dates.

## Where things stand

The menu-bar app (0.5.0) is the first form. ChatGPT is the source, and the destination is any open app with a text box, reached through Accessibility.

## Next forms

1. **Harness mod, starting with DeepSeek Harness.** Built as `plugins/deepseek-harness/` (package `dsh-chatgpt-panel`, shown as "ChatGPT panel"), for DeepSeek Harness 0.2.0-rc.2 exactly. Checked with synthetic data and a real Electron window only; not yet run inside the harness.
   - Inside a harness, the user is pulling a chat in rather than sending one out. The mod therefore follows the host's naming: "ChatGPT panel", with the tagline "Talk it through in ChatGPT. Finish it in DeepSeek Harness." Add to Claude stays the name of the project and the menu-bar app.
   - The icon carries over unchanged: light from outside falling into a composer.
   - The open question is answered: the harness's in-app browser tab cannot keep a login (it forces a non-persistent session, allows no preload and refuses downloads), so ChatGPT runs in a separate Electron window run by the plugin. A tab in the right sidebar shows its status, and Add appends to the session's draft through the session's input actions, never submitting.
   - Next: install it in the owner's DeepSeek Harness and record what holds; check whether the interfaces it uses (exact `/api` routes, right-sidebar tab types, input actions) survive the next release candidate.
2. **Claude mod.** Waits until Claude's newly released mod format settles, so the port is an adaptation rather than a rewrite.
3. **Your own browser as an optional source.** No second sign-in: a browser extension reads the conversation in the tab you already use. Prefer a plain content script limited to chatgpt.com and the few hosts it needs; ask for `debugger` only if something turns out to need it, since it shows a permanent "being debugged" bar and draws stricter store review. It feeds the same shared format, so nothing downstream changes.
4. **More chat providers.** Claude chat first, so a Claude conversation can be added to a harness composer too.

## Shape that keeps this N + M, not N × M

Sources and destinations meet at one format, so a new provider or a new form adds one adapter on its side only.

- **Shared format.** The validated conversation model in `src/model.js`: turns with roles, original Markdown, references, files and verification. The hand-off text is projected from it (`projectMarkdown`).
- **Source adapters.** A page observer and an importer per provider that produce that model. Today: `src/page-observer.js`, `src/chatgpt-response.js` and `src/import.js`.
- **Destination adapters.** Whatever writes the projected text and file list into a composer. Today: `native/Composer.swift` (Accessibility) and, for DeepSeek Harness, the plugin's tab (`plugins/deepseek-harness/client/panel.js`, through the session's input actions). The harness mod replaces only this layer, plus a window to host the source page (`plugins/deepseek-harness/helper/`), and keeps the rest.

Before a second provider, move two things into the shared shape:

- **File links.** How a file's download link is obtained is ChatGPT-specific today: the observer's resolver and both downloaders (`native/Files.swift`, `plugins/deepseek-harness/helper/chat.js`) assume `files/download` and `interpreter/download`. Each source adapter should supply its own link step behind one interface.
- **File lines.** Pointing a file line at its local copy (`linkFiles`) now exists twice, in `native/Handoff.swift` and `plugins/deepseek-harness/shared/files.js`, kept equal by tests on each side. It belongs in `src/` as one function both forms use.
- **Selection.** Adding chosen turns, or only the turns since the last Add, is parked. When it returns, it belongs in the shared format as a range over the selected branch, not in a destination.
