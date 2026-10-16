# Roadmap

Recorded 2026-10-16 from the owner's plan. Order matters more than dates.

## Where things stand

The menu-bar app (0.5.0) is the first form. ChatGPT is the source, and the destination is any open app with a text box, reached through Accessibility.

## Next forms

1. **Harness mod, starting with DeepSeek harness.** The ChatGPT window opens as a small panel inside the harness GUI. Its Add writes into that harness's own composer.
   - Inside a harness, the user is pulling a chat in rather than sending one out. The mod therefore follows the host's naming, for example "ChatGPT panel". Add to Claude stays the name of the project and the menu-bar app.
   - The icon carries over unchanged: light from outside falling into a composer.
   - Open question: does DeepSeek harness's extension API let a web view be embedded, or does it only accept text into its composer? The answer decides between an embedded panel and a separate window linked to the harness. Check before starting.
2. **Claude mod.** Waits until Claude's newly released mod format settles, so the port is an adaptation rather than a rewrite.
3. **More chat providers.** Claude chat first, so a Claude conversation can be added to a harness composer too.

## Shape that keeps this N + M, not N × M

Sources and destinations meet at one format, so a new provider or a new form adds one adapter on its side only.

- **Shared format.** The validated conversation model in `src/model.js`: turns with roles, original Markdown, references, files and verification. The hand-off text is projected from it (`projectMarkdown`).
- **Source adapters.** A page observer and an importer per provider that produce that model. Today: `src/page-observer.js`, `src/chatgpt-response.js` and `src/import.js`.
- **Destination adapters.** Whatever writes the projected text and file list into a composer. Today: `native/Composer.swift` (Accessibility). A harness mod replaces this layer and keeps the rest.

Before a second provider, move two things into the shared shape:

- **File links.** How a file's download link is obtained is ChatGPT-specific today: the observer's resolver and the native downloader assume `files/download` and `interpreter/download`. Each source adapter should supply its own link step behind one interface.
- **Selection.** Adding chosen turns, or only the turns since the last Add, is parked. When it returns, it belongs in the shared format as a range over the selected branch, not in a destination.
