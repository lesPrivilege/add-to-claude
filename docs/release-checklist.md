# Release checklist (0.4.0)

## Done on 2026-10-14 (synthetic data, plus the owner's own login)

- [x] `npm test`, `npm run test:browser` and the WebKit half of `npm run test:native` pass. Counts are in [support-matrix.md](support-matrix.md).
- [x] The owner ran the Accessibility half: 49 checks, including "append never activates the target app".
- [x] The owner's ChatGPT login works in the embedded `WKWebView` and survives restart.
- [x] The unsigned app builds for macOS 14 or later on arm64.
- [x] No Praxis file or remote is modified; no runtime npm dependency; no history, telemetry or credential access.

## Required before release

- [ ] Owner's Mac:
  - Open the panel from the menu bar and confirm that hiding and reopening keeps the page and a streaming reply.
  - Check that the bar shows the open conversation.
  - Add it to a real Claude window and a second app; confirm the draft is preserved, nothing is sent, and no window moves or flickers.
  - Repeat with the composer unfocused, the conversation changed during Add, and Accessibility revoked.
- [ ] Live ChatGPT data formats in the panel: opening an old chat, a new chat over SSE, a reply over the socket, branches, and a long conversation.
- [ ] Uploads, downloads, external links, the sign-in popup, Escape, keyboard use, VoiceOver and dark appearance.
- [ ] The owner confirms the service-terms question.
- [ ] Signing, hardened runtime, notarization and Gatekeeper, or an explicit decision to ship unsigned.
- [ ] Independent review of the embedded design: security, functionality and rendered UX.
