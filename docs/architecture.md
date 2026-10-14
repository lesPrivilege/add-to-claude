# Architecture

```
menu-bar icon ─▶ ChatPanel (NSPanel, hides instead of closing)
                  ├─ WKWebView: chatgpt.com, WKWebsiteDataStore.default()
                  │    page world:      observer.js  (src/page-observer.js)
                  │    defaultClient:   bridge.js    (compile + bridge bundle) ─▶ "handoff" handler
                  └─ HandoffBar: source summary · window picker · Add ─▶ Composer (AX)
```

## Web content

- `src/page-observer.js` runs in the page world from document start. It watches only the page's own GET `/backend-api/conversation/<id>`, the conversation SSE POST and the matching `ws.chatgpt.com` turn socket. It never fetches, retries or refreshes. At document start, before any page script runs, it creates a `MessageChannel` and offers one port to the bridge with `window.postMessage`. It then reports `response`, `changed` and `unavailable` packets only on its own end of that channel.
- `bridge.js` is built by `scripts/build-webkit.js`. It bundles `compile.js` with `chatgpt-response.js`, `import.js`, `model.js` and `message-visibility.js`, one scope per module.
  - It runs in WebKit's `defaultClient` content world. The page shares the DOM but cannot see this code, and the `handoff` message handler exists only in that world.
  - It adopts the first port offered from its own window and origin, then stops listening. It compiles packets from that port only, and posts `ready` (Markdown and summary), `invalid`, `changed` or `unavailable`.
  - A page script can neither post on the observer's end nor get its own port adopted later. The app still trusts the chatgpt.com origin: a compromised page could change what it loads, just as it could change what it shows.

## App (`native/`)

- **`Chat.swift` (`ChatController`)** owns the WebKit view.
  - **Packets.** It accepts handler messages only from its own web view, the isolated world, the main frame and a ChatGPT origin, for a page on that same origin. A `ready` message for a page the view has already left is dropped. Each accepted `ready` becomes a `Prepared` with a fresh revision.
  - **Revocation.** A URL change to another conversation, a full navigation, or a `changed` packet revokes the current `Prepared`.
  - **Browser chores.**
    - Top-level pages, in the panel and in sign-in popups, stay on ChatGPT and a small allowlist of sign-in hosts.
    - Other http/https links and new windows open in the default browser; any other scheme is dropped.
    - Uploads and downloads use the standard panels, and downloads are quarantined.
    - After a content-process crash the page reloads once; a second crash within a minute waits for the user.
- **`Handoff.swift` (`HandoffBar`)** shows the summary, the window picker (`ComposerRegistry` over AX, terminals excluded, scanned off the main thread) and Add. Add freezes the revision. Right before writing, it requires that this revision is still the current one and that the web view still shows that page.
- **`Composer.swift`** validates the chosen window: same app instance, same window, same title, and the same writable focused text area. It then puts the insertion point at the end, sets the selected text, and requires the exact combined text on readback; AX offsets are UTF-16. It never sets `AXValue` (that would drop rich spans), never activates the target, and never sends.
- **`App.swift`** has the status item and the panel. Clicking the item toggles the panel. Clicking elsewhere hides it, unless one of our own popups or file panels is in front. Hiding hands focus back to the previous app.

## Limits

- Text that goes into a composer is capped at 2 MiB, and the Markdown at 16 MiB. Larger contexts can be saved to a file from the bar.
- Terminal-hosted agents are excluded. A terminal needs its own adapter, and shell pasting is not acceptable.
- A Partial verification still allows Add. The Markdown carries the verification line and its issues.
- Google may refuse sign-in inside embedded web views. The owner's sign-in worked in the login probe on 2026-10-14.
