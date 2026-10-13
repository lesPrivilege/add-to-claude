# Browser collection

This is the optional external-Chrome adapter; the main product is the [embedded macOS workspace](../native/README.md). **Read original conversation** temporarily attaches to the selected tab, checks for an unsent draft/streaming answer, reloads that tab and reads its own matching conversation JSON response. It preserves the selected branch's original Markdown and detaches on success, failure or cancellation. **Collect rendered turns** and **Capture visible turns only** remain explicit alternatives. **Open in local desk** passes the reviewed model to the portable utility. Nothing is submitted. The embedded app's normal Add flow does not use this reload-based adapter.

Every DOM result is **unverified**, including one that reaches both rendered boundaries. Those observations cannot establish server completeness, original Markdown, hidden variants or unexposed attachments. Original Markdown is available from a supported selected conversation export. The [Copy/download investigation](copy-download-research.md) explains why the implementation does not read the shared clipboard after clicking every turn's Copy button.

## Install and use

1. With installed Node 24 or newer, run `npm run build:extension` and `npm start`. Neither requires npm dependencies. The private development ZIP includes a ready-to-load `chrome-extension` folder; development builds use `dist/extension`.
2. In an authorized Chrome environment that permits unpacked extensions, open `chrome://extensions`, enable Developer mode and choose **Load unpacked**. Chrome 116+ supports the production APIs used; the automated action-popup recipe requires Chrome 127+.
3. Open the selected conversation and invoke the toolbar action. Save any unsent draft before **Read original conversation**; it deliberately reloads and shows Chrome's debugging banner. Keep the popup open and review the result. The rendered alternative scrolls the selected page and stops on user scrolling/navigation. Closing the popup cancels either reader.
4. For supported exposed HTTPS attachment links, choose **Download**. Grant the optional downloads permission if wanted. Chrome downloads to its normal folder and may rename a conflicting filename. The extension never opens the file. Links requiring a page handler, an expired URL, or unsupported file type retain a normal source Download/reopen action.
5. Choose **Open in local desk**. A loaded source requires explicit replacement confirmation. **Select downloaded files** accepts the completed files together and matches unique recorded final names/sizes. Ambiguous matches require the individual source row's **Select file** action. Matching is user-selected association; it is not proof of original source bytes.
6. Choose the existing destination composer. The controlled test composer verifies insertion and file bytes. Other targets use clearly labeled clipboard copying or the separate untested native path. No action sends or presses Enter.

**Find open ChatGPT tabs** requests optional access to `chatgpt.com` and `chat.openai.com`. The picker includes tab/window IDs so duplicate titles remain distinct. Discovery does not read the other conversations. **Show tab** focuses the selected existing tab; reopen the toolbar popup to collect it. Conversation, shared-conversation and custom-GPT conversation routes are recognized.

## Permissions and lifetime

The manifest requests `activeTab`, `scripting` and `debugger`. Chrome does not permit debugger as a runtime optional permission, so its warning is part of installation. Code attaches only after the original-read action and only to its selected tab. Discovery's ChatGPT hosts, downloads and local-desk access remain separate optional grants. There is no cookies, history, storage, all-sites or native-messaging permission. Declining an optional grant leaves the remaining paths available.

Chrome host patterns cannot restrict a port: the desk grant is `http://127.0.0.1/*`, while extension code restricts delivery to `http://127.0.0.1:43119/#capture`. The desk opens inactive, answers a transcript-free readiness probe and is pinned by document ID before focus/delivery. Server or readiness failures remain retryable. **Copy Markdown** reports **Copied** only after the clipboard write succeeds.

Collection is bounded by 90 seconds, 200 steps, 5,000 turns and an 8 MiB model. Stable source message IDs and overlapping windows establish order; identical text is never deduplicated by content. Missing IDs, conflicting content/order, disconnected windows, navigation, streaming or user takeover stop collection. The original visible position is restored when the same document/session still allows it. A time/size/step-limited partial result retains its stop reason and needs review; cancellation or inconsistent identity does not deliver a result.

Capture timestamps are unchanged by downloads; delivery and new download requests expire after 15 minutes. One download runs at a time in the popup, with completion/cancel feedback and a two-minute polling deadline. Only IDs returned by the extension's own download requests are queried. Absolute paths, global download history and file bytes are not exposed to the selected model. The JSON records only the completed basename/size hint until the user selects bytes in the desk.

Normal Chrome downloads can continue if the popup closes. Monitoring, cancellation and worker memory are not a hard network-byte cap or a guarantee under service-worker suspension. Check Chrome Downloads after an interruption. The desk enforces accepted file sizes/types and computes the selected bytes' SHA-256. Closing the popup drops its capture and association hints; downloaded files remain in Chrome's download folder. No directory picker or persistent filesystem handle is used.

## Caller and data boundary

The worker accepts requests from its own action popup only and rejects tab senders. It pins tab ID, window ID, exact supported URL and document ID, then rechecks every scroll/capture operation and delivery. Scripts run in the main frame's isolated world. There are no private endpoint calls, authentication reads, branch clicks, or scans of all history.

The worker and desk both validate the bounded model. Handoff uses exact same-window/same-origin messages, a random request ID and a one-use nonce. The worker deadline is 45 seconds; the desk offer expires after 35 seconds. Replacement is acknowledged only after the user's explicit choice. The Node API grants no extension CORS and never exposes its capability in that exchange. Desk adoption is separate from composer insertion.

Captures and transfers remain in popup/worker/desk memory. There is no telemetry, remote transcript service, extension storage or transcript URL. Remove optional grants in Chrome's extension Details page, or remove the extension at `chrome://extensions`. Remove normal downloaded files separately if desired. No native host, login item or daemon is installed by this extension.

## Test evidence and limits

`npm run test:extension` separates the **portable API harness** from **installed-extension lifecycle** cases. The harness runs actual popup HTML, rendered DOM, local desk and message exchange in Chromium, while mocking Chrome extension APIs. It covers collection progress/cancel/disconnect, selected-document checks, delayed discovery, concurrent work locks, readiness failure, capture expiry, download permission/completion/cancel and metadata handoff. It does not prove installed-extension behavior.

The installed-extension recipe uses an ephemeral profile, synthetic pages, fixture host grants and `chrome.action.openPopup()`. The Mac reconstruction run passed 23 cases: 13 API mocks and 10 installed-extension checks in Chrome for Testing 149. The earlier Linux VM blocked extension loading; that historical skip is not the current Mac result. Native toolbar invocation and permission prompts still require their separate acceptance run.

Actual toolbar lifetime, `activeTab` grants, optional permission prompts, service-worker suspension and live authenticated ChatGPT markup remain untested. See [test results](test-results.md), [support matrix](support-matrix.md) and [release checklist](release-checklist.md). Screenshots `08-browser-capture-harness.png` and `10-collection-progress-harness.png` are real rendered harness UI, not installed-toolbar captures.

## Platform and terms sources

Reviewed 2026-10-12: Chrome's [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs), [permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions), [downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads), and [action](https://developer.chrome.com/docs/extensions/reference/api/action) APIs. None was installed as a dependency.

[OpenAI's consumer terms](https://openai.com/policies/terms-of-use/) restrict automatic or programmatic extraction. A user gesture and fixture test do not establish an exemption. Applicable service permission remains an owner review item. The normal [ChatGPT export](https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data) remains the documented source-fidelity fallback.
