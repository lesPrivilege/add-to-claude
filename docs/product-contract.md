# Product contract

The goal is a small macOS menu-bar utility that passes functional and real-machine acceptance and is ready to release. A passing fixture suite alone is not enough.

## Current design (owner decisions, 2026-10-13 to 2026-10-16)

- **Name.** Add to Claude (`add-to-claude`), named for the destination most people use. The button names the actual destination ("Add to Codex", "Add to Claude"). Earlier working names were gpt-handoff and Ferry.

- **Surface.** A menu-bar panel that is the ChatGPT website itself, in the app's own persistent WebKit session, with a thin handoff bar beneath it. Hiding never destroys the page. No handoff may open a browser, refresh the page, raise or switch windows, flicker, or put a blocking overlay over the chat.
- **Sign-in stays honest.** The panel is its own browser and says so before the first sign-in, including that ChatGPT may send a new-device email. It never reads another browser's cookies and never disguises its user agent. If a provider refuses embedded sign-in (Google does), the panel says so and suggests email and password.
- **Stable identity.** The app id `io.lesprivilege.add-to-claude` and, once there is one, the signing identity stay fixed, so updates keep the sign-in and the Accessibility grant.
- **Session.** The owner signs in once inside the panel. Their sign-in method was confirmed to work in the embedded view, survive restart and send messages (login probe, 2026-10-14). That result superseded the Chrome-session route and its extension, which were removed. Browser credentials are never copied.
- **Target.** An exact window that is already open in another app. Text is appended into its composer in the background and read back to confirm. Nothing is sent.
- **Memory only.** No session journal or conversation archive. WebKit's login data, the settings and the files the user downloads are the only things on disk.
- **Files.** Add downloads the conversation's files into a folder per conversation and points the text at each local copy, unless the user turns that off.
- **Scope.** The owner authorized a complete first-principles refactor. Earlier paths were removed: the local HTTP desk, the DOM/scroll collector, the popups, and the Chrome extension with its relay.

## Source and interpretation

The user requested that Codex read [开源工具读取ChatGPT会话](chatgpt-conversation://6acb722f-383c-83ec-91f6-66d491c0af55), restructure the project, and complete the goal. The [source record](sources/chatgpt-6acb722f-383c-83ec-91f6-66d491c0af55/README.md) preserves the accessible conversation separately from this accepted project state.

The latest user messages converge on a single action: replace manual per-turn copying, concatenation, downloading, window switching and pasting. The user explicitly wants already-open client windows, role labels, original Markdown, references, attachments, verification, a status-bar GUI and interaction quality comparable to Magpie. Small scope and low ongoing maintenance matter more than expanding features.

Assistant suggestions in that conversation are design candidates, not independent authorizations or verified facts. Earlier MCP/reference-only/new-session proposals were superseded by the user's simpler existing-window paste flow. The missing embedded examples are not reconstructed from guesswork.

## Required behavior

| ID  | Requirement                                                                                                                                                         | Evidence needed for acceptance                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Capture one explicitly selected, already-open ChatGPT conversation and its selected branch. Preserve source IDs, order, User/Assistant roles and original Markdown. | Original-source adapter tests plus real logged-in page acceptance; long virtualized conversations must not silently lose unmounted turns.                                                                                                                                                 |
| R2  | Preserve citations and attachment locators. Download accessible files through the browser's normal download path; record actual local results and hashes.           | End-to-end selected-source → downloaded bytes checks; unavailable, expired and ambiguous files are explicit. A filename or URL is not file delivery.                                                                                                                                      |
| R3  | Select an actual running app and exact existing window, including multiple windows or same-title cases.                                                             | Real macOS discovery/selection and selected-window-only tests. Static app-name labels and opening a new chat do not satisfy this.                                                                                                                                                         |
| R4  | Add the compiled context to the selected existing composer, preserving the draft. Never send or execute it.                                                         | Real client draft insertion/readback, wrong focus/window/editor rejection, cancellation and permission denial/revocation. A successful clipboard write is not a successful handoff. Terminal-hosted agents require an identified composer adapter; generic shell pasting is insufficient. |
| R5  | Do not truncate long text or hide partial attachment results. Offer an explicit usable long-context/file path when required by a target.                            | Boundary and failure tests, with the resulting actual client draft/files inspected. Text success and file failure remain separately visible and retryable.                                                                                                                                |
| R6  | A coherent status-bar GUI provides source, target and Add to Agent, with preview/detail access and truthful progress/results.                                       | Actual rendered app and full-path acceptance: open/close/reopen, Escape, focus, keyboard, accessibility, appearance and local retries. Avoid requiring users to orchestrate several disconnected tools.                                                                                   |
| R7  | Keep the stable model/compiler/verification core separate from changing browser and client adapters.                                                                | Reviewed interfaces, focused regressions, small locked dependencies and a discoverable maintenance entry point. No history database, model gateway, runtime management, RAG or automatic summarization.                                                                                   |
| R8  | Prepare a reproducible release candidate with all required functional and real-machine evidence recorded.                                                           | Unit, browser, WebKit, Accessibility and build checks at the final source state, independent review, native acceptance and an explicit distribution/signing status. Unrun checks remain open.                                                                                             |

Original Markdown, source coverage, citation resolution, downloaded bytes and target insertion are separate facts. A selected branch can be accounted for without proving that the service exposed every hidden variant. A degraded DOM or manual-copy fallback is useful but does not close R1 or R4.

## Status

See [support-matrix.md](support-matrix.md) and [release-checklist.md](release-checklist.md).

- **R1** holds for the owner's live conversations, including long paged ones.
- **R2** holds for a generated Markdown file: downloaded on Add, with its path and SHA-256 in the text. Uploaded files and images are implemented but not yet seen live.
- **R3 and R4** pass the synthetic Accessibility suite and Claude for Mac with an empty prompt. A non-empty prompt and a second client are open.
- **R6** has its controls, Settings and icons; keyboard, VoiceOver and dark appearance are unchecked.
- **R8** is open: signing, notarization and an independent review remain.

## Reference evidence checked on 2026-10-12

- [yesooner exporter README](https://github.com/yesooner/chatgpt-conversation-export-extension/blob/main/README.md), blob `54c9f1d3f4b988a1d9b6b558fe6ab1aea834d11d`, and [background.js](https://github.com/yesooner/chatgpt-conversation-export-extension/blob/main/background.js), blob `aa2d17363248052debb5b616f97d9016dc11e5cc`: selected-tab temporary debugger attachment, page reload, response-body reading and detach. This supports the technique, not compatibility with this user's current account. Its broad response matching and text trimming are not adopted.
- [thekester exporter README](https://github.com/thekester/chatgpt-export/blob/main/README.md), blob `a257e968219a2d36ecb5d0e7ae458be64d8db44e`: reports citation/media/file preservation and capability-dependent partial results. Its history archival/deletion and private-endpoint probing are outside this utility's scope. README claims are not runtime evidence.
- [Magpie code standards](https://github.com/yetone/magpie/blob/main/docs/code-standards.md), blob `5907adff44e753c632c0f23f0ea471637a219a42`: complete-path fixes, meaningful failing regressions, cleanup of test processes and real-platform evidence. These are quality references; Magpie-specific build/release commands and unrelated project policies are not this project's instructions.
- [Chrome permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions) explicitly lists `debugger` among permissions that cannot be optional. [Chrome debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger) requires manifest declaration, documents selected-tab sessions, enterprise attach restrictions and detachment when DevTools opens. Original capture therefore needs an install-time debugger permission and a visible, user-started temporary attachment. No policy bypass is planned.

Other conversation references (`chrome-use`, `chatgpt-use`, `codex-chatgpt-web` and Magpie's window implementation) remain candidates for bounded study when an implementation decision needs them. Their discussion is not proof of an implemented transport or support claim.
