# Boundaries and decisions

`src/capture.js` is the isolated rendered-page adapter; `src/collect.js` accumulates overlapping windows and `src/page-scroll.js` owns the temporary scroll session; `extension/` invokes it only for a selected ChatGPT tab. `src/import.js` is the isolated ChatGPT export adapter. It accepts a user-selected export and emits one selected parent chain. `src/model.js` validates the versioned JSON model and produces a readable projection. Source IDs, node locators, turn order, original text parts, branches, content fidelity, citation URLs, and attachment state remain explicit. The importer does not fetch any private endpoint.

`web/` is the local transfer desk and controlled test composer. It uses native controls, text-only previews, and plain ES modules. The target list is metadata, not an agent integration framework. `src/server.js` and `src/bridge.js` supply only local discovery and a bounded transfer/receipt exchange. `native/` is the AppKit menu-bar shell and a common optional Accessibility append path. It does not run an agent.

## Why these choices

- **Explicit browser source with an export fidelity path:** the extension reads only the selected rendered conversation. The primary action scrolls that one pinned document within 90 seconds and 200 steps. Stable message IDs and overlapping windows establish observed order; text is never the deduplication key. Conflicts, missing IDs, disconnected windows, streaming, navigation and user takeover stop collection. Start/end observations remain evidence, not server completeness. It never clicks branch controls, calls private endpoints, or reads authentication state. DOM snapshots cannot become verified. Export import preserves original Markdown and branch ancestry when present. Technical fixture acceptance is separate from the service-use restriction recorded in the research notes.
- **Built-in Node HTTP + ES modules + AppKit:** no runtime package dependencies, hosted backend, framework build pipeline, or agent runtime. Playwright is a locked development dependency. The native launcher requires an explicitly supplied installed Node executable instead of silently downloading one; a self-contained signed native installer remains future packaging work.
- **Thin transfer:** native discovery reads running app/window identity; confirmed insertion requires a writable `AXTextArea`, app/process/window/editor/focus checks, plain-value write, and exact readback. No generic terminal keystrokes or auto-send. A real client's accessible surface must be tested before compatibility can be claimed. Common clipboard copying does not claim insertion.

## Embedded source and native preparation

`web/embedded-source.js` observes the embedded page's own selected GET and exact conversation POST responses. `src/event-stream.js` bounds/decodes SSE; `src/chatgpt-stream.js` applies classic envelopes/v1 deltas; `src/stream-conversation.js` joins the request/reply to the selected parent chain. Hidden/internal exclusion is shared with the importer in `src/message-visibility.js`. Missing DONE, interrupted/length-limited replies and handoffs retain explicit uncertainty. Unresolved visible-message anchors survive later replies, even when an internal node follows them; regeneration can choose a clean branch and a complete same-message continuation can repair its anchor. No observer fetch, reload, auth/header read, resume-token retention or WebSocket reconnect occurs.

`src/chatgpt-response.js` validates actual GET/POST provenance and coverage before emitting the stable model. POST provenance is not presented as a server GET response. Only the current snapshot/base remains in memory. The native `WorkspaceController` keeps website content in the normal WebKit store and runs compilation in a separate nonpersistent local webview. The website handler accepts source data only; it cannot select a target or invoke insertion. Each accepted snapshot prepares automatically. Preview needs no target; Add requires verified current preparation and an explicit user click. The delayed native append rechecks source generation as well as target/editor identity. Compiler-process recovery retains a still-current source for local re-preparation without reloading the chat. WebKit navigation completion is not module readiness: the core sends a readiness-only native message, then the controller verifies the current document function under its core navigation generation before preparing. Only the pinned local core main frame can trigger that check.

These protocol formats are fixture-supported adapters, not a compatibility promise for an authenticated account. Modern WebSocket/handoff delivery remains partial until an independently observed authoritative response repairs it. Native downloads and usable long-context file delivery remain required work.

## Local HTTP boundary

The server binds only `127.0.0.1`. Host must equal the exact port-specific loopback host. Origins must match; cross-site fetch metadata is rejected, and no CORS permission is issued. A custom bootstrap header obtains an in-memory random session capability, then every API call carries it. Mutations require the exact Origin. Static resources come from an exact path allowlist. Responses use no-store, no-referrer, nosniff, anti-frame headers and a restrictive CSP. Text is displayed with `textContent`, never passed to a shell or HTML evaluator. The Markdown projection preserves turn bodies verbatim, including angle-bracket links, autolinks, blockquotes, literal HTML and unfinished fences; escaping belongs at rendering boundaries, not in source content.

The capability and health marker are not defenses against arbitrary software already running as the same OS user. This is a local personal utility, not a multi-user service. No HTTP route launches apps, opens arbitrary paths, or executes attachments. The native launcher uses a fixed `Process` executable/argument array and a reduced environment; no transcript enters a process argument.

## Browser source boundary

The optional MV3 extension has `activeTab`, `scripting` and required `debugger` permission (Chrome does not permit optional debugger permission); optional ChatGPT host access is requested only for explicit existing-tab discovery. Optional loopback access is requested only for handoff. Chrome match patterns cannot restrict a port, so the grant covers `http://127.0.0.1/*`; extension code restricts delivery to `http://127.0.0.1:43119/#capture`. A separate optional downloads permission enables requested attachment downloads. It has no cookie, history, storage, native-messaging, or externally-connectable capability. Its explicit original-response action temporarily attaches a debugger, refuses an unsent draft/streaming answer, reloads that selected tab, reads only its matching response and detaches. That reload path is separate from the primary embedded workflow.

The worker accepts actions from its own popup only. Source selection binds tab ID, window ID, exact supported URL and document ID; every scroll/capture operation and delivery recheck identity. Collection uses a popup-owned port so cancellation or popup disconnection aborts it. A best-effort restoration uses the original visible anchor; it does not restore after navigation or user takeover. Capture time remains truthful and delivery expires after 15 minutes. The extension injects a self-contained reader and a separate isolated desk messenger. That messenger exchanges only a validated source model through same-window, same-origin messages and a random one-use nonce. No transcript enters a URL, fetch request, extension storage, or log. The desk validates the model again, accepts only ChatGPT DOM snapshots, and acknowledges after adoption. A loaded source needs explicit replacement confirmation; an active transfer or file read rejects replacement. This handshake does not authenticate against arbitrary installed extensions or local software, which are outside this boundary. The Node API never grants extension origins access and its session capability is not exposed in messages.

## Native context files

`native/ContextDownloads.swift` owns one explicit export batch, pins the source generation and exact reference URL to each WKDownload, and never reads browser credentials. It attempts at most ten exposed supported HTTPS references, caps accepted files at 5 MiB each/10 MiB total, checks response MIME and actual size/hash, and discards late/stale callbacks. Content-Length/progress are early rejection hints; the completed-file read has its own hard bound. Temporary destinations are private and removed after reading or cancellation; bytes remain in the operation's native memory.

`native/ContextExport.swift` saves only after an explicit folder selection. The full Markdown and original source model remain separate from the manifest's actual file receipts. Distinct references with the same downloaded filename receive numbered export paths rather than overwriting each other. Writes/hash/serialization run off the UI thread in a unique staging directory; cancellation/source changes invalidate publication and completion. Export means saved locally, not attached or inserted. The native Add path still handles text only and does not certify any real client's file composer.

## Download assistance

Each requested passive HTTPS attachment uses `chrome.downloads.download`, without custom headers or credential access. Only the exact returned download ID is queried. At most ten pending operations are retained; terminal records yield capacity. Completion exposes only a plain final filename and bounded size to the selected model. No absolute local path, download history, or file bytes enter the model. A cancelled operation remains cancelled even if an earlier status poll returns late.

Chrome downloads may continue after the popup closes. Monitoring and oversize cancellation are best effort while it is open, not a network byte cap; service-worker suspension is untested here. File selection enforces the actual accepted-byte limits. The desk’s one multi-file picker matches unique final filename/size hints, rejects ambiguous matches, and computes SHA-256 over the selected bytes. This is user-selected association and transfer integrity, not independent source authentication. No directory access or persistent file handles are requested.

## Transfer states

```text
pending ── claim ──> applying ── matching receipt ──> inserted / failed
   │                    │
   ├── cancel            └── receipt timeout → expired (inspect draft)
   └── target/lease timeout → expired
```

Registration contains instance, title, revision, readiness, and draft presence, never draft text. Stage binds those identities. Claim rechecks them just before the controlled composer writes, and issues a short-lived claim token. Only pending transfers can be cancelled. The composer checks the lease, writes to its exact textarea/File state, compares text and bytes, and acknowledges. A late/missing receipt does not imply success or a safe automatic retry.

The browser test composer represents a controlled adapter, not a third-party client's undocumented internals. Native window/editor identity cannot prove that a host has not switched conversations while reusing both unchanged. User confirmation is mandatory; this limitation belongs in client acceptance tests.

## Bounds and retention

| Boundary                       | Limit                                                                |
| ------------------------------ | -------------------------------------------------------------------- |
| Selected raw export            | 64 MiB; 10,000 conversations; 20,000 nodes per conversation          |
| Selected model text            | 8 MiB; 5,000 user/assistant turns                                    |
| Browser transfer request       | 16 MiB serialized JSON including base64; UI preflights combined size |
| Local attachments              | 10 files; 5 MiB each; 10 MiB decoded total                           |
| File kinds                     | TXT, Markdown, JSON, CSV, PDF, PNG, JPEG, WebP; opaque bytes only    |
| Native append                  | 2 MiB resulting plain text; files attached manually                  |
| Active target/transfer records | 32 each; targets expire after 15 seconds without heartbeat           |
| Transfer lease                 | 30 seconds; content removed on terminal state                        |

Filename validation blocks path separators/traversal, controls, misleading bidi characters, reserved names, and incompatible MIME/extension pairs at the bridge. Selected files record a SHA-256 and an explicit source-reference association. A supplied file's origin is the user's selection, not a cryptographic assertion that ChatGPT originally produced it. A saved hash is checked when that file is selected again. Attachments are never opened or executed by this utility.

The selected source stays in the desk until cleared, refreshed, or closed. Closing an export picker drops the unselected export. Saving a projection is an explicit download; imported `available` attachment claims are downgraded until bytes are selected again. Browser recovery, OS swap, clipboard history, and user-created downloads are outside the utility's in-memory lifetime; it does not claim secure erasure.
