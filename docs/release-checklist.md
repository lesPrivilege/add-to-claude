# Release checklist (0.5.0)

## Done

- [x] `npm test` (99/99) and the WebKit half of `npm run test:native` (21 checks) pass at the release source.
- [x] The owner's ChatGPT login works in the panel and survives restart.
- [x] Live conversations, including long paged ones, project in order with original Markdown and references.
- [x] Add places the text into an empty Claude prompt without sending or activating Claude.
- [x] Add downloads a generated file and puts its local path and SHA-256 into the text.
- [x] Temporary diagnostics are removed.
- [x] Independent review of all changes since `902166b`; its nine defects are fixed with tests.
- [x] The app builds unsigned for macOS 14 or later on arm64, with its app icon.
- [x] No runtime npm dependency; no history, telemetry or credential collection. The page's session token stays in the page.

## Before release

- [ ] Owner's Mac, renamed build:
  - Sign in again and grant Accessibility to Add to Claude.
  - Add a conversation that has rendering markup (cards, entities, citations) and check that the text reads cleanly.
  - Add a conversation with an uploaded file or image, and one with two same-name generated files.
  - Add into a non-empty Claude prompt and into a second app; confirm nothing is sent and no window moves.
  - Try the global shortcut, open at login, sign out, Escape and ⌘W.
- [ ] Run `npm run test:browser` and the Accessibility half of `npm run test:native` from a terminal that has the browser and Accessibility.
- [ ] Dark appearance and VoiceOver pass over the bar, the Files popover and Settings.
- [ ] The owner decides the service-terms question.
- [ ] Signing, hardened runtime, notarization and Gatekeeper, or an explicit decision to ship unsigned.
