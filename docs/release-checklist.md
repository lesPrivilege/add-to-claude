# Release checklist (0.4.0)

## Done on 2026-10-14 (synthetic data only)

- [x] `npm test`, `npm run test:browser`, `npm run test:chrome` and the link half of `npm run test:native` pass. Counts are in [support-matrix.md](support-matrix.md).
- [x] The unsigned app and relay build for macOS 14 or later on arm64.
- [x] No Praxis file or remote is modified; no runtime npm dependency; no history, telemetry or credential access.

## Required before release

- [x] `npm run test:native` from a terminal with Accessibility access: 21 link checks and 49 Accessibility checks pass, including "append never activates the target app".
- [ ] Owner's Mac:
  - Set up Chrome from the popover and load the extension.
  - Open a synthetic ChatGPT conversation and check that the popover shows it.
  - Add it to a real Claude window and a second app; confirm the draft is preserved, nothing is sent, and no window moves or flickers.
  - Repeat with the target in the background, the composer unfocused, the conversation changed during Add, and Accessibility revoked.
- [ ] Live ChatGPT data formats: initial GET, a new chat over SSE, a reply delivered over the socket, branches, and a long conversation.
- [ ] Popover from the real menu bar: Escape, focus hand-back, keyboard use, VoiceOver, dark appearance.
- [ ] The owner confirms the service-terms question.
- [ ] Signing, hardened runtime, notarization and Gatekeeper, or an explicit decision to ship unsigned.
- [ ] Independent review of security (link peer check, relay origin), functionality and rendered UX.
