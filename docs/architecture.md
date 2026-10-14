# Architecture

```
chatgpt.com page ──postMessage──▶ source.js (isolated) ──runtime message──▶ worker (handoff.js)
   observer.js (MAIN world)                                                     │ native messaging
                                                                                ▼
                                       gpt-handoff-host (Relay.swift) ◀──frames──▶ stdin/stdout
                                                                                │ per-user Unix socket
                                                                                ▼
                                       gpt-handoff.app: ChromeLink ─▶ popover ─▶ Composer (AX)
```

## Extension (`extension/`, `src/`)

- `src/page-observer.js` becomes `observer.js`. It runs in the page's main world from `document_start` on chatgpt.com and chat.openai.com. It watches only the page's own GET `/backend-api/conversation/<id>`, the conversation SSE POST and the matching `ws.chatgpt.com` turn socket. It never fetches, retries or refreshes. Packets go to the same document by `postMessage`.
- `extension/source.js` keeps the latest response packet for its document, forwards packets to the worker, and answers `replay` and `where`.
- `src/handoff.js` (the service worker):
  - It follows the active ChatGPT tab in the last focused window. A non-ChatGPT tab never replaces the selection.
  - It compiles the selected tab's response with `chatgpt-response.js`, `import.js` and `model.js` into Markdown and a SHA-256 hash, under a fresh revision id.
  - It publishes a small state (status, title, counts, verification, revision) to the app.
  - It answers two requests. `context` returns the Markdown, revision and hash. `check` confirms that the revision and hash are still current and the tab still shows that page.
- The native port is opened at worker start and keeps the worker alive. If Chrome cannot start the relay, the worker retries every five seconds while it is awake.
- Permissions: `nativeMessaging` and host access to the two ChatGPT origins. There is no popup, no storage, and no access to other sites.

## Relay (`native/Relay.swift`)

Chrome starts the relay with the caller origin, and the relay exits unless that origin is the extension's fixed id. It connects to the app's socket, retrying every second, and sends `{event: "app", connected}` to the extension when the app appears or disappears. It copies valid frames both ways, at most 1 MiB toward Chrome. It exits when Chrome closes stdin. It keeps no state and has no Accessibility access.

## App (`native/App.swift`, `Link.swift`, `Composer.swift`)

- `ChromeLink` listens on `$TMPDIR/gpt-handoff.sock` (mode 0600). It accepts only a peer whose executable is the bundled relay, keeps one connection, and matches replies by id with timeouts.
- The popover shows the source, a window picker (`ComposerRegistry` over AX, terminals excluded) and **Add**. Opening it activates only this accessory app, so no other window moves. Closing it hides the app, which hands focus back.
- **Add** works in four steps:
  1. Fetch `context` and verify the hash locally, and that the revision is the one on screen.
  2. Check that the chosen window still exists with the same title, and that its focused element is the same writable text area.
  3. Ask the extension to `check`.
  4. Put the insertion point at the end, set the selected text, and require the exact combined text on readback. AX offsets are UTF-16.

  The app never sets `AXValue` (that would drop rich spans), never activates the target, and never sends.

## Limits

- Text that goes into a composer is capped at 2 MiB, and the Markdown at 16 MiB. Larger contexts can be saved to a file from the popover.
- Terminal-hosted agents are excluded. A terminal needs its own adapter, and shell pasting is not acceptable.
- A Partial verification still allows Add. The Markdown carries the verification line and its issues.
