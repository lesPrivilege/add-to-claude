# 0.3.0 acceptance checklist

Runnable development handoff. Not a release-verified macOS build.

The reconstruction must satisfy **R1–R8 in [product-contract.md](product-contract.md)**, including the user's later embedded-chat/no-refresh UX requirements. Its native window renders, original-response parsing is implemented, and focused checks pass, but synthetic GET/SSE/new-chat updates now pass, while live protocol compatibility, WebSocket/handoff streams, native Save UI/live downloads and target file delivery (explicit long-context export is implemented), real-client insertion and the remaining real-machine matrix are open. Earlier counts below do not substitute for a final-state verification run. The independent foundation review found four transition defects; fixes and remaining runtime limits are recorded in [independent-review.md](independent-review.md).

## Current Chrome integration gates

- [x] Preserve existing Chrome session through the already-installed ChatGPT app; real signed-in homepage/app-window observation.
- [x] Implement small extension-popup controls, selected-document passive source bridge, immutable Add intent and exact-origin native messaging.
- [x] Remove debugger permission/reload action from the primary build; retain scoped legacy tests separately.
- [x] Build candidate launcher/helper and verify real native framing/origin handshake; independent code/rendered-popup review.
- [x] Exercise real Chrome-launched native messaging and selected-tab-close process exit in a disposable profile, with synthetic composer state.
- [ ] Install in the owner's Chrome profile and verify actual popup/host permission flow.
- [x] Run `bash scripts/test-native-accessibility.sh` on the unlocked Mac: 34 real AX checks against owned synthetic windows, including rich-draft preservation and late selection/normalization failures. Actual client/permission checks remain separate.
- [ ] Verify live selected synthetic-source capture and real native target insertion/readback, cancellation and failure modes.
- [ ] Complete primary attachment-byte delivery and long-context target acceptance; Save Markdown alone does not close these gates.

## Completed in the cloud VM

- [x] Independent repository; no Praxis file or remote modified.
- [x] Locked development dependencies; no runtime npm dependencies.
- [x] Explicit selected-tab source reader and existing ChatGPT tab picker/focus, with no history scraping or credential access.
- [x] Bounded selected-conversation traversal, virtualized turn accumulation, progress/cancel and explicit observed-boundary evidence.
- [x] Optional normal browser download assistance and one-picker attachment pairing; no implicit byte-access claim.
- [x] Verbatim Markdown projection, including angle-bracket link destinations, autolinks and quotes.
- [x] Selected export model, branch choice, original Markdown/locators, and explicit fidelity states.
- [x] Local transfer desk and synthetic composer; confirmed insertion differs from clipboard copying.
- [x] Bounds, caller/origin checks, safe file names, inert text, cancel/receipt lifecycle.
- [x] Independent functionality/security/UX review and repair round; see the review record for actual findings.
- [x] Rendered desktop/compact screenshots, keyboard dialog behavior, reduced-motion check.
- [x] Native source, build configuration, and controlled AppKit test composer supplied.
- [x] Local Git history, original 0.1.0 and 0.2.0 archives, and separate 0.3.0 checkpoint retained.

## Required before calling the intended workflow release verified

- [ ] Confirm a permitted source path under the account's applicable service agreement. Consumer terms restrict programmatic extraction; a user gesture and fixture tests are not an exemption. Export/paste is the documented bounded alternative.
- [ ] Exercise the production extension's toolbar invocation, temporary `activeTab` access, optional grant/denial/revocation, source navigation, desk closed/unavailable and actual ChatGPT markup/virtualized scrolling with an authorized synthetic conversation. Exercise optional download permission, real download completion, popup closure, and service-worker suspension. The VM blocks all extension loading through managed Chromium policy. Actual DOM/desk browser tests and API harness checks do not validate extension installation, toolbar grants, or runtime messaging.
- [x] Build on the current macOS arm64 machine with installed Node 25/Xcode; explicit macOS 13 deployment target and unsigned build verified. Other OS/architecture combinations remain untested.
- [ ] Run the native acceptance matrix, including permission denial/revocation, focus races, editor replacement, same-title conversation changes, long text and multiple windows.
- [ ] Validate each real client's writable composer before claiming support. No agent runtime/account was installed here.
- [ ] Verify native keyboard/VoiceOver, appearance, contrast and Reduce Motion on the intended Mac.
- [ ] Sign using the owner's existing Developer ID, hardened runtime, notarize/staple, and test clean-Mac Gatekeeper. The current Mac reports 0 valid code-signing identities (2026-10-13). No new credential/agreement was created.
- [x] Private repository and preserved base history verified: `lesPrivilege/gpt-handoff`, `main` at `e0a7fca`, Mac base at `e60dc03`. Reconstruction work is local on `codex/session-handoff`; no release publication is implied.

The prior VM GitHub authentication blocker was resolved before this reconstruction. Codex verified private visibility and cloned the existing Mac branch. Do not create a duplicate repository or infer that new reconstruction changes have been pushed.

The remaining owner/platform work is an extension acceptance run in an authorized Chrome environment, a Mac acceptance run, a permitted service-use path, distribution signing, and authorized private-repository publication. The original 0.1.0 and 0.2.0 Library archives are preserved. Version 0.3.0 adds bounded traversal, download assistance and fidelity fixes. Final visual refinement is deferred to Claude at the user’s request.
