# Architecture

```
menu-bar icon ─▶ ChatPanel (NSPanel; hides, never closes)
                  ├─ header: back · reload · open in browser · pin · Settings
                  ├─ WKWebView: chatgpt.com, WKWebsiteDataStore.default()
                  │    page world:      observer.js  (src/page-observer.js)
                  │    defaultClient:   bridge.js    (compiler + bridge bundle) ─▶ "handoff" handler
                  └─ HandoffBar: summary · files · preview/copy/save · window picker · scope · Add ─▶ Composer (AX)
Settings (SwiftUI, in the panel's place) · global shortcut (Carbon hot key) · login item (SMAppService)
```

## Web content

- **`src/page-observer.js`** runs in the page world from document start.
  - It watches the page's own conversation loads (`/backend-api/conversations/<id>` and its older pages from `…/messages?before=…`), the reply stream and the matching `ws.chatgpt.com` socket. It never retries or refreshes.
  - A reply handed over to the socket is published once, when the socket part ends; until then the page counts as replying. The socket gives up after 120 s without a frame for that reply (not 120 s in all), and then the part received so far is published as partial. When the page reconnects or subscribes again from the start (as it may when the panel shows again), the reply is rebuilt from that replay, never added twice; a renewal from another offset, or more than eight, ends partial. A refetch of the conversation while that part is pending is ignored.
  - A refetch that reads exactly as the last result posted posts nothing at all: no `changed`, no new compile.
  - It keeps the links the page fetches for its files (`/backend-api/files/download/<id>`).
  - At document start, before any page script runs, it creates a `MessageChannel` and offers one port to the bridge. It reports only on its own end of that channel.
  - **File links on request.** When the app asks, it requests a file's short-lived download link the way the page does: `files/download/<id>` for file ids, `conversation/<id>/interpreter/download` for generated sandbox files. It uses the API headers the page itself last sent, kept in a closure. The token is never posted to the bridge or the app.
- **`bridge.js`** is built by `scripts/build-webkit.js`, which bundles the compiler modules one scope per module.
  - It runs in WebKit's `defaultClient` content world. The page shares the DOM but cannot see this code, and the `handoff` handler exists only in that world.
  - It adopts the first port offered from its own window and origin, then stops listening. It compiles packets from that port only and posts `ready`, `invalid`, `changed`, `unavailable`, `file` and `file-missing`.
  - It exposes `addToClaudeResolve(files)` in its own world, so only the app can ask for file links.
  - It keeps the last compiled model in its own world and exposes `addToClaudeProject(page, turns, note)`, so the app can ask for some turns. It answers only for the same page, and only when every named turn still has the hash the app was shown.
  - The app still trusts the chatgpt.com origin. A compromised page could change what it loads, just as it could change what it shows.

## Compiler (`src/`)

`compile.js` → `chatgpt-response.js` (paged → mapping via `paged-conversation.js`) → `import.js` (turns, folding and issues for the selected branch; the export's graph and branch walk in `export-graph.js`, sources, citation marks and numbering in `export-citations.js`, file references in `export-files.js`) → `model.js` (the validated model) → `projection.js` (the Markdown projection). The projection is `# title`, a source line with the verification state, content checks, then `## Turn N — Role` with the original Markdown, `### References` (numbered) and `### Files`. A turn is one exchange's side: assistant messages in a row (a note before a tool call, then the answer) are one turn, with every message's locator in its source comment, and each file keeps the message it came from (`messageId`) for fetching. Inline citations stay in place as `[n]`, the number of their source in References (cited sources first), or `[?]` when no source matches. Hidden reasoning and tool traffic are left out (`message-visibility.js`). ChatGPT's rendering markup (`<box>`, `<Entity/>`, `<Cite/>`, private-use citation markers) is read as the Markdown its own Copy button gives, and a scripted widget's template lines are dropped and flagged as an omitted widget (`chatgpt-markup.js`).

- **Some turns.** `projectMarkdown(model, lines, { turnIds, note })` projects only the chosen turns, in source order, under their own numbers. Each brings only its references, files and content checks; checks about the whole conversation and files of no turn always go. A scope line follows the source line ("Turns 15–21 of 42 · new since last add"). `handoff()` in `compile.js` returns the text with file and check line numbers for that text.
- **Per turn.** `compile` also returns `turnList`: id, role, position, a preview of at most 80 characters, file keys, and `sha256`. The hash covers the turn's projected body without its numbered heading (`describeTurns`, `sha256.js`).

## App (`native/`)

- **`App.swift`**: the status item, the panel, the hidden main menu (editing keys, ⌘, ⌘R ⌘[ ⌘W), the global shortcut and click-away hiding. A click in another app or another app coming forward hides the panel, unless it is pinned or one of our own windows is in front.
  - One window at a time: Settings opens in the panel's place under the menu-bar icon (the page keeps running), and closing it, or clicking the icon, brings the panel back. Opened while the panel is hidden, Settings opens centred.
- **`Chat.swift` (`ChatController`)** owns the web view.
  - **Packets.** Handler messages are accepted only from its own web view, the isolated world, the main frame and a ChatGPT origin, for a page on that origin. A `ready` for a page the view has left is dropped. Each accepted `ready` becomes a `Prepared` with a fresh revision; navigation or a `changed` packet revokes it.
  - **Files.** It asks the page for missing links (10 s at most), downloads through the web view's own session with `WKDownload` into `<files folder>/<conversation title>/`, and records each path and SHA-256 (`SavedFiles` in `Delivery.swift`, by page and file id with its message; on disk in `saved-files.json` under the History setting). A recorded copy is reused, after a relaunch too, only while its bytes still hash the same. The page's own downloads land in the same folder.
  - **Hand-off text.** Each saved file's line becomes its local path and SHA-256, and its "download this file" check is dropped. With no checks left, the text reads verified.
  - **Browser chores.** Top-level pages stay on ChatGPT and a small allowlist of sign-in hosts; other http(s) links open in the default browser and other schemes are dropped. After a content-process crash the page reloads once.
- **`Handoff.swift` (`HandoffBar`)**: the summary, files popover, preview, copy, save, window picker, the scope pull-down ("New · 6", "All · 42", "3 selected") and Add.
  - While a reply is in progress in the conversation already shown, the bar keeps that last result (`SourceState.ready(_, replying: true)`, "· reply in progress") and everything on it stays usable; the next result replaces it in place, keeping the scope choice. Another conversation, or a new chat, waits as before.
  - The bar keeps one height: the scope line and two status lines keep their room when empty, so the web view never resizes (and ChatGPT never reflows or scrolls) because the bar said something. The window picker is rebuilt only when its rows change (ids name a window by its app's run and AX element), never just because the panel opened.
  - A refetch that reads exactly as the result shown keeps that result, revision and all (`SourceState.received`), so an Add under way is not failed by it; a refetch that fails on the conversation shown keeps the result too (`failed`). Which conversation the chosen window shows is read off the main thread when it is chosen or the panel opens; Add reads it again before writing.
  - If macOS stops the page while the panel is hidden, the reload waits for the panel to open.
  - A composer window is chosen as a window: its message box is looked for off the main thread when it is chosen and when the panel opens (a hint, "Click once into the message box…", if there is none Add could use) and found again when Add runs.
- **`Prepared.swift`**: what a preparation carries (the text, its files and turns), reading the compiler's messages (`parseReady`, `parseProjection`; their shape is pinned by `tests/fixtures/bridge-messages.json`, which the JS and WebKit suites both read), and pointing file lines at local copies (`linkFiles`). No AppKit.
  - Add freezes the revision, re-reads the target's identity, and records a receipt. It asks the bridge for the chosen turns (or uses the whole text), downloads their files when that setting is on, and right before writing requires that the revision is still current.
  - It asks before adding exactly what was just added. An unconfirmed write becomes "Could not confirm" with It's There / It's Not.
- **`TurnPicker.swift`**: "Choose turns…", an `NSTableView` of turns (checkbox, role, number, preview, files, added/changed marks). A click anywhere on a row flips it, a drag paints the rows level with it (sideways does not matter) with the first row's new state (`DragPaint`), and shift-click covers a run.
- **`Delivery.swift`**: the delivery log and the scope rule, as pure functions plus a small JSON file.
  - Receipts move `prepared` → `insertion_attempted` → `composer_inserted` | `failed` | `unknown`.
  - Finished receipts for verified targets are written to `~/Library/Application Support/add-to-claude/delivery-log.json`: ids, positions, hashes, states and times, never text.
  - `analyzeScope` / `resolveScope` decide All versus New; see [decisions/incremental-handoff.md](decisions/incremental-handoff.md).
- **`Composer.swift`**: finds a window's message box over AX (the bar first keeps the box the last Add into the same conversation used, while it is in the window; else `inspectComposer`: the text area the window has focus in, else the one marked focused or the window's only writable one; terminals and code editors excluded) and appends:
  1. Put the insertion point at the end and set the selected text; confirm by reading back. AX offsets are UTF-16.
  2. If the app ignores that (Claude for Mac does), set the value of an empty box, or post ⌘V to that app's process only, then restore the clipboard. ⌘V goes only when the app's keyboard is in that box as far as AX shows it (`keyboardComposer`; an app reporting no focus, as Electron apps do in the background, is taken to have it in the window's one box); a window focused on something that takes no typing has the box focused first.
  3. Apps known to ignore step 1 skip its wait. The target is never activated, and nothing is sent. Focus moving in the app during an Add stops it.
  - It reports `inserted` only when the text reads back. A draft that changed but cannot be confirmed (a reformatting paste, for one) is `unconfirmed`; nothing added is `failed`.
  - `conversationIdentity` reads which conversation a window shows from its `AXWebArea`'s `AXURL` or the window's `AXDocument`. Only `https://claude.ai/chat/<uuid>` or `https://claude.ai/epitaxy/local_<uuid>` counts; the walk is bounded to 1 s.
- **`Terminal.swift`**: terminals as destinations (the owner's rules: [decisions/reading-and-projection.md §4](decisions/reading-and-projection.md#4-terminals-receive-one-line)).
  - Writes the hand-off to `handoff-<conversation>-<window>.add-to-claude.md` in the conversation's files folder (`HandoffFiles`, each path remembered with the SHA-256 written; a path a mention cannot carry is refused before writing), puts one line, `@"<path>"`, on the clipboard, un-minimizes and raises the chosen terminal window and activates its app. The user pastes; Add never types or pastes into a terminal.
  - The line has no newline and nothing a shell acts on inside quotes. The outcome is always `unconfirmed`: the user says It's There, or Copy Again, which keeps the question open. Terminal apps are known by a whole word of their bundle id (`isTerminalBundle`).
- **`Destinations.swift`**: one discovery of composer windows and of terminal apps' windows (any app `isTerminal` names) for the picker, valid until the next.
- **`Files.swift`**: the files folder and the downloader. **`Settings.swift`**: preferences, the hot key and the Settings window. **`Updates.swift`**: Sparkle's updater (the only file that imports it, so the tests compile without it): a daily check of `appcast.xml` on `main`, updates verified by EdDSA key and code signature, installed on quit; **Check for Updates…** in the icon's menu and the Updates rows in Settings. **`Diagnostics.swift`**: each hand-off's stages, times, sizes, outcome and content checks by code in the unified log (counts and fixed names only, never text, titles, file names or paths), and Export…. **`Views.swift`**: SVG template glyphs and small controls.

## Limits

- Text that goes into a composer is capped at 2 MiB, and the Markdown at 16 MiB. Larger contexts can be saved to a file from the bar, or added a few turns at a time with Choose turns…; nothing is truncated.
- Terminals get a file mention to paste, never the text, and are never typed into. Any terminal app is listed; a terminal inside an editor (VS Code's) is not, since its window is the editor's.
- A Partial verification still allows Add. The text carries the verification line and its checks.
- Google may refuse sign-in inside embedded web views. The owner's sign-in works.

## Storage and diagnostics

| Kind                                                                                                         | Where                                                                                                                  | Cleared by                                                                             |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ChatGPT sign-in and site data                                                                                | WebKit's default data store                                                                                            | Sign Out (all site data)                                                               |
| Web caches                                                                                                   | WebKit's default data store                                                                                            | Clear and Reload (memory, disk and fetch caches only; sign-in kept)                    |
| Settings                                                                                                     | UserDefaults                                                                                                           | not cleared                                                                            |
| Delivery history and saved files (ids, positions, hashes, paths, times)                                      | `~/Library/Application Support/add-to-claude/`, each file `{version, items}`; another version is dropped, not migrated | Clear History; pruned at launch by retention                                           |
| Downloaded files                                                                                             | the files folder the user chose                                                                                        | never cleared by the app                                                               |
| Hand-off files for terminals, and their paths, times and SHA-256                                             | `handoff-<conversation>-<window>.add-to-claude.md` in the conversation's files folder; the paths in UserDefaults       | replaced by each Add; Clear History; once a day old, at launch or when the panel opens |
| Sparkle's update state (last check, the user's update choices) and a downloaded update until it is installed | UserDefaults (`SU…` keys); Sparkle's cache in `~/Library/Caches/io.lesprivilege.add-to-claude/`                        | not cleared; the downloaded update is removed once installed                           |
| Hand-off diagnostics (stages, times, sizes, outcomes, content-check codes and counts)                        | the unified log, subsystem `io.lesprivilege.add-to-claude`, category `handoff`                                         | the system's own log rotation; Export… saves this session's events                     |

The conversation itself lives only in memory: the page observer keeps at most eight recent conversations, capped in size, and the app keeps the prepared one. The exceptions are what the user asks for: Save, and the hand-off file an Add to a terminal tab writes.
