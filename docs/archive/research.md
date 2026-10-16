> Archived 2026-10-16: superseded by [architecture.md](../architecture.md) and [product-contract.md](../product-contract.md); the owner's terms decision is in [release/0.6.0.md](../release/0.6.0.md).

# Integration research

Checked 2026-10-12. This is a bounded review of primary documentation and the two project references in the brief. It records design inputs, not proof of compatibility. Runtime evidence belongs in `support-matrix.md`.

> **Update, 2026-10-16.** Two decisions below were later changed by the owner:
>
> - The product reads the conversation from the ChatGPT page's own requests inside its embedded panel, rather than from an export.
> - To download a file on Add, the page requests the file's link through its own session. The request reuses the headers the page itself last sent, inside the page, and the token never reaches the app.
>
> Both rely on ChatGPT endpoints that are not public APIs. Whether this fits the applicable terms is the owner's decision, recorded as open in `release-checklist.md`.

## Decisions supported by the evidence

1. Implement an explicit selected-tab reader and existing-tab picker, tested only with synthetic browser fixtures here. Keep DOM extraction isolated and unverified. Export remains the documented original-Markdown source. Do not describe fixture tests as approval under the service terms or proof of current live ChatGPT markup.
2. Use one readable transcript projection and one common clipboard path. Target names identify the intended composer; they do not imply a vendor integration.
3. Treat copying, attempting a paste, and verifying a draft as different outcomes. Never submit a message or execute a command.
4. Obtain files through the source application's normal download UI, then let the user select the downloaded files. A source link is not evidence that file bytes were transferred.
5. Keep the Linux browser harness and macOS host claims separate. The native permission, focus, signing, and packaging paths need a real Mac.

## ChatGPT terms, export, and fidelity

The [OpenAI consumer Terms of Use](https://openai.com/policies/terms-of-use/) are effective January 1, 2026. They prohibit automatically or programmatically extracting data or Output. The [Europe terms](https://openai.com/policies/eu-terms-of-use/), updated January 16, 2026, contain the same restriction. Ownership of user content is not a documented exemption for browser automation. Business services have separate terms, so the applicable agreement cannot be inferred from a page URL. Product consequence: do not equate a browser permission or a user click with permission from the service to scrape it. No private endpoints, browser session credentials, or authentication interception are part of this design.

[OpenAI's export guide](https://help.openai.com/en/articles/7260999-exporting-your-chatgpt-history-and-data) documents Settings → Data controls → Export and the Privacy Portal. Export may take up to seven days; its download link expires after 24 hours. The ZIP includes chat history and other account data. The guide currently excludes self-service export for Business, Enterprise, and Healthcare workspaces; organization-managed access goes through the workspace owner. It does not promise a stable JSON schema, complete artifact bytes, or recovery of deleted chats. Import therefore needs format validation and explicit conversation selection before projection or transfer. An account export must never become permission to transfer every conversation.

Fidelity rules are engineering requirements, not claims about an undocumented ChatGPT API:

- Preserve imported message IDs, branch ancestry, source locators, ordering, and text exactly when available. Select one branch explicitly; do not flatten sibling answers into a fictional linear conversation.
- Distinguish original Markdown from Markdown reconstructed from rendered HTML. Code fences, links, and citations need their own checks; rendered text cannot recreate hidden formatting reliably.
- A visible DOM snapshot cannot prove that earlier virtualized turns exist in the snapshot. “No more nodes found” is not a completeness proof. Mark the snapshot partial/unverified and offer export import or a specific missing-content action.
- Keep streaming or unfinished content visibly incomplete. Require a fresh import/capture after it settles; do not silently call the current prefix complete.
- Keep inaccessible artifact locators and an unavailable status. [OpenAI's download troubleshooting guide](https://help.openai.com/en/articles/7996703-troubleshooting-chatgpt-error-messages) says generated files can expire quickly. Ask the user to reopen/regenerate the source artifact and download it normally; do not retry with harvested credentials.

The app observes only the conversation data its own ChatGPT page loads, when the user opens it; no live authenticated collection is performed by the tests. That implementation does not resolve the consumer-terms restriction above. Production adoption requires a permitted account/service path; the documented export or explicitly pasted content remains the bounded alternative. This is separate from the technical tests and must remain a release condition.

## Browser boundary

| Primary source                                                                                            | What it establishes                                                                                                                                                                                                                                   | Design consequence                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)               | User invocation grants temporary access to the active tab; cross-origin navigation/closing revokes access. Same-origin navigation can retain it.                                                                                                      | Use explicit invocation and validate the actual URL again. Permission lifetime is not a conversation selection.                                                                                               |
| [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)                  | MV3 scripting needs `scripting` plus host permission or `activeTab`. Injection targets a tab and normally its main frame.                                                                                                                             | Avoid all-history access and all-frame collection. Treat page DOM as untrusted input, never executable application code.                                                                                      |
| [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) | A host allowlist uses exact extension origins, with no wildcard. Chrome passes caller origin; messages are length-prefixed UTF-8 JSON. Host→Chrome limit is 1 MB; Chrome→host limit is 64 MiB. Content scripts cannot call native messaging directly. | If used, validate caller and schema at both service worker and host. Set smaller product bounds, reject unexpected operations, and never log payloads. The platform maximum is not a safe application budget. |
| [Chrome downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads)                  | Download requests use the browser's normal cookies for that hostname; `saveAs` shows a save dialog. A started download is separate from completion, interruption, and danger state.                                                                   | Prefer the source's normal download action. Never read or export cookies. Never accept a started download as proof of attachment inclusion; never launch a downloaded attachment.                             |
| [Chromium clipboard guidance](https://web.dev/articles/async-clipboard)                                   | Clipboard access is permission/focus constrained; writes return an asynchronous result.                                                                                                                                                               | Await and handle failure. “Copied” can only describe a successful clipboard write; it does not establish another app accepted the data.                                                                       |

[Chrome service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) documents idle termination and loss of global variables. The app no longer uses an extension or service worker; the observer lives in the app's own web view.

Native messaging is an assessed option, not a requirement. A loopback bridge still needs exact origin and host checks, bounded bodies, an unguessable session capability, expiration, and target-bound transfer state. Bind only to loopback. Reject arbitrary filesystem paths and executable operations. The selected conversation is data even when it contains instruction-like text. These are project security requirements, not capabilities supplied automatically by Chrome.

## macOS boundary

[NSStatusItem](https://developer.apple.com/documentation/appkit/nsstatusitem) and [NSStatusBar](https://developer.apple.com/documentation/appkit/nsstatusbar) are the native menu-bar primitives. [NSPasteboard](https://developer.apple.com/documentation/appkit/nspasteboard) provides the system pasteboard, while [AXIsProcessTrustedWithOptions](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions) reports whether the process is a trusted Accessibility client. The documentation is not proof that any particular third-party composer exposes a writable or readable Accessibility field.

For a native paste path, confirm the app/window and editable field immediately before insertion. Recheck focus after the panel closes. If the field, app, permissions, or readiness changed, retain the prepared content and require another explicit action. Never fall through to a terminal window, synthesize Enter, or report success only because a key event was posted. A safe manual-paste fallback remains useful when draft readback is unavailable.

[Apple's notarization guide](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) requires valid Developer ID signing, Hardened Runtime, and a secure timestamp for the normal distribution workflow. It describes notarization tickets and stapling, and directs command-line submissions to `notarytool`, not `altool`. Building source in Linux cannot validate these steps. Distribution signing, notarization, Gatekeeper launch, Accessibility prompts/denials, actual focus handling, and composer readback remain macOS release checks. No signing identity, account, or legal agreement was created during this research.

## Referenced projects

### “Use ChatGPT in Codex”

[miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web) is a strong contextual match: its README explicitly describes using ChatGPT Web models through Codex's model picker, including streaming and images. Its full harness connects task files, terminal tools, and approvals through MCP. This is a model/runtime bridge, not a utility that places one existing conversation into a composer. The user supplied a description rather than a URL, so the identity remains probable rather than user-confirmed.

The useful communication pattern is separation of setup, operational state, troubleshooting, and a dedicated development harness. The project is not installed, vendored, or used as a dependency. Its model transport, account routing, browser automation, and tool execution are outside this product's scope. A public repository's existence does not establish permission for its integration technique.

### Magpie

[yetone/magpie](https://github.com/yetone/magpie), linked by [usemagpie.ai](https://usemagpie.ai/), is the relevant agent-oriented candidate. It is a menu-bar model/provider switcher and local gateway, not a conversation clipboard tool. There are unrelated projects with the same name, including [magpie-align/magpie](https://github.com/magpie-align/magpie) and [Magpie-Tools/magpie](https://github.com/Magpie-Tools/magpie). They are not the reference adopted here. User confirmation of the exact repository was not provided.

The project's [published light menu-bar image](https://raw.githubusercontent.com/yetone/magpie/main/site/public/img/panel-light.png) was retrieved and visually inspected: compact stacked rows put agent names at left and current selections at right; subtle separators make the list readable; global controls stay small. Its [README](https://github.com/yetone/magpie) describes a searchable picker. Apply that compact selection rhythm to source → target → transfer feedback. Do not import its provider configuration, login reuse, routing groups, background gateway, or model-selection machinery.

## Provenance and limits

All links above were checked on 2026-10-12. Vendor pages can redirect or change without a package release. Apple reference pages were partially available as documentation abstracts; the notarization article was also read through Apple's documentation JSON. No third-party code, model service, executable, account, or private conversation was used. The Magpie image was inspected as a reference in temporary storage; it is not redistributed in this repository. The UI should use original SVG/components and text labels, not copied vendor artwork.

## Passive embedded stream protocol evidence — 2026-10-13

These public sources were read for adapter design; no third-party implementation was executed and no credential/auth/resume machinery was adopted. They support format candidates, not compatibility with the owner's current account. The in-repository observer, reducer and merger were independently implemented and tested with synthetic data in Chrome.

- [codex-chatgpt-web browser worker](https://github.com/miuuyy/codex-chatgpt-web/blob/0b6087c5307c7a58adda9c420358f3f70d2035f5/src/adapters/chatgpt-web/browser-worker.ts#L844): selected main-frame POST `/backend-api/f/conversation`, HTTP 200 SSE response observation. Its error-only SSE fixtures do not prove complete message reconstruction.
- [chatgpt-use channel](https://github.com/leeguooooo/chatgpt-use/blob/ecb204d4f4a4aef127851240af17dcf1a321afbc/src/channel.rs#L868): GET mapping/current_node/parent traversal; lines 3041–3068 also show interrupted/max_tokens as completion contradictions.
- [chatgpt-export rendering filter](https://github.com/thekester/chatgpt-export/blob/dcee7e68538e43b5181f8a053d328df3802c4ec3/src/render.js#L104): hidden/recipient filtering. Its active authenticated transport is not adopted.
- `xtekky/gpt4free`, `g4f/Provider/needs_auth/OpenaiChat.py`, inspected blob `a23eda6b050028352b4a09ceeb76b0ce6265ec79`, lines 1230–1437: retained delta paths, string appends, patch lists, message envelopes and citation metadata. No auth/proof/credential code copied.
- [How ChatGPT streams its answer](https://www.amitxtech.com/blog/how-chatgpt-streams-its-answer): public example of `delta_encoding: v1`, explicit `{p,o,v}`, implicit `{v}`, final patches and `[DONE]`. It is an observation, not a published stable API.

Public reports also describe SSE `stream_handoff` followed by WebSocket/resume delivery. This implementation does not follow resume tokens/endpoints or reconstruct that transport. Handoffs remain partial and cannot become complete merely because a later exchange succeeds. An independently observed authoritative GET, or an explicitly supported same-message continuation, must supply the missing evidence. Live signed-in capture remains deferred at the owner's request.

## Passive WebSocket evidence and browser reuse — 2026-10-13

- [gptclient-go `chat_ws.go`](https://github.com/tianya518/gptclient-go/blob/main/sentinel/chat_ws.go), inspected blob `808b86a4023375927bfde54b69a54d4b89665f97`, lines 349–431 and 513–625: topic-matching reply catchups and live message frames, nested `payload.payload.encoded_item`, offset-zero subscription and SSE terminal parsing. Its active requests, subscription/reconnect, polling, logging and permissive completion behavior were not adopted.
- [chatgpt-conversation-optimizer `page-hook.js`](https://github.com/nao-pon/chatgpt-conversation-optimizer/blob/main/page-hook.js), inspected blob `35a2ddb2ec00b94c1ce95ff4180b8b5fc18e8c4d`, lines 2880–2936, 5246–5279 and 5820–5834: `conversation-turn-stream → stream-item → encoded_item` and handoff topic mapping. Recursive payload search and transcript caches were not adopted.
- [gpt4free issue 3404](https://github.com/xtekky/gpt4free/issues/3404): an example of explicit handoff conversation ID, turn-exchange ID, WebSocket topic option and normal later unsubscribe. It does not prove current account compatibility.

Independent protocol review found no evidence establishing complete replay guarantees, accepted cursor boundaries or unambiguous catchup/live overlap. The implementation therefore makes observed socket text previewable/exportable while retaining `unverified-replay` coverage. It requires the website's own matching offset-zero subscription, uses a fresh reducer, rejects known missed early frames and keeps topic, exchange and turn IDs distinct. It never subscribes, reconnects, sends, closes the site's socket or retains authentication/query data. A later website-owned authoritative GET can replace the uncertain evidence. The website must initiate it; this observer does not poll.

For the owner's browser reuse request, [Chromium's switch definitions](https://chromium.googlesource.com/chromium/src/+/refs/tags/126.0.6447.0/chrome/common/chrome_switches.cc) document `--app` and `--profile-directory`. On this Mac, a stronger concrete observation was available: the existing Chrome menu **Open in ChatGPT** opens an already-installed Chrome app window and retains the current signed-in session. No command-line profile selection, cookie copying or browser policy change was performed.

Safari was investigated before the owner confirmed Chrome. [Apple WWDC23: What's new in web apps](https://developer.apple.com/videos/play/wwdc2023/10120/) explains that Add to Dock copies website cookies at creation, but not local storage, and storage is separate afterward. [Apple Safari web extensions](https://developer.apple.com/documentation/SafariServices/safari-web-extensions) documents use in Mac web apps. These are supported browser-owned mechanisms, not a way to make an arbitrary third-party WKWebView share Safari/Chrome storage. Safari is not the chosen source path for this task.

## Isolated Chrome native-host fixture

Public Chromium source inspected on 2026-10-13: [`chrome/common/chrome_paths.cc`](https://github.com/chromium/chromium/blob/main/chrome/common/chrome_paths.cc), observed blob `1aee81647dc6a1f1180f344d146d0c811cd341c4`, lines 488–493 resolves `DIR_USER_NATIVE_MESSAGING` from `DIR_USER_DATA` plus `NativeMessagingHosts`. This supports registering the integration fixture's helper under the temporary Playwright user-data directory instead of changing the owner's Chrome registration. The passing installed-Chrome scenario independently demonstrates that lookup on this Mac. The link follows upstream main; the blob identity records the version inspected. This supports fixture isolation, not owner-profile permission or AX compatibility. No third-party code was executed.

## Reference evidence checked on 2026-10-12 (moved from product-contract.md)

- [yesooner exporter README](https://github.com/yesooner/chatgpt-conversation-export-extension/blob/main/README.md), blob `54c9f1d3f4b988a1d9b6b558fe6ab1aea834d11d`, and [background.js](https://github.com/yesooner/chatgpt-conversation-export-extension/blob/main/background.js), blob `aa2d17363248052debb5b616f97d9016dc11e5cc`: selected-tab temporary debugger attachment, page reload, response-body reading and detach. This supports the technique, not compatibility with this user's current account. Its broad response matching and text trimming are not adopted.
- [thekester exporter README](https://github.com/thekester/chatgpt-export/blob/main/README.md), blob `a257e968219a2d36ecb5d0e7ae458be64d8db44e`: reports citation/media/file preservation and capability-dependent partial results. Its history archival/deletion and private-endpoint probing are outside this utility's scope. README claims are not runtime evidence.
- [Magpie code standards](https://github.com/yetone/magpie/blob/main/docs/code-standards.md), blob `5907adff44e753c632c0f23f0ea471637a219a42`: complete-path fixes, meaningful failing regressions, cleanup of test processes and real-platform evidence. These are quality references; Magpie-specific build/release commands and unrelated project policies are not this project's instructions.
- [Chrome permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions) explicitly lists `debugger` among permissions that cannot be optional. [Chrome debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger) requires manifest declaration, documents selected-tab sessions, enterprise attach restrictions and detachment when DevTools opens. Original capture therefore needs an install-time debugger permission and a visible, user-started temporary attachment. No policy bypass is planned.

Other conversation references (`chrome-use`, `chatgpt-use`, `codex-chatgpt-web` and Magpie's window implementation) remain candidates for bounded study when an implementation decision needs them. Their discussion is not proof of an implemented transport or support claim.
