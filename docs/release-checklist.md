# Release checklist (0.5.0)

## Done

- [x] `npm test` (136/136, of which 37 plugin) and the WebKit half of `npm run test:native` (21 checks) pass at the release source.
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

## DeepSeek Harness plugin (`dsh-chatgpt-panel` 0.1.0)

Done on 2026-10-16 with synthetic data only: `npm test` (37 plugin tests) and `npm run test:dsh-electron` (16 checks in real Electron 43.3.0). See [support-matrix.md](support-matrix.md).

- [ ] Owner installs `dist/dsh-chatgpt-panel` into the `desktop` profile of DeepSeek Harness 0.2.0-rc.2 and confirms it loads (Plugins page shows "ChatGPT panel", no boot error).
- [ ] The ChatGPT tab opens from the right sidebar's guide; Open starts the window; sign-in persists across a helper restart and a Desktop restart.
- [ ] Add into an empty draft and a non-empty draft (with a file chip): appended at the end, nothing replaced, nothing sent.
- [ ] A conversation with an uploaded file and a generated file: both saved under `~/Downloads/Add to Claude/<title>/`, paths and SHA-256 in the text, verified.
- [ ] External links open in the default browser; sign-in popups (Google, Apple, Microsoft) complete.
- [ ] Quitting Desktop ends the helper; quitting the helper leaves the tab showing "closed".
- [ ] Independent review of the plugin: security, functionality and rendered UX.
