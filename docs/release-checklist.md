# Release checklist (0.6.0)

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
- [ ] Incremental hand-off (WO-01), owner's Mac with Claude for Mac:
  - Run `bash scripts/probe-target-ax.sh` with two Claude conversations open, then again after switching conversations in one window. Record whether `AXURL` carries `claude.ai/chat/<uuid>` and whether it follows the switch; update the decision log.
  - [x] New into a Claude Code session in Claude for Mac: "Turns 5–6 of 6 · new since last add", verified (owner, 2026-10-16).
  - Add a long conversation, reply twice in ChatGPT, and check that Add offers "New · 2" with the right range. Switch Claude to another conversation and check that it offers All.
  - Choose turns… with a gap, Add, and check the text's scope line, references and file lines.
  - Click Add twice on the same scope and check that "Already added — Add again?" appears.
  - Paste into a non-empty Claude prompt and check that "Could not confirm" offers It's There / It's Not.
  - Check the log file holds no message text; Clear History, then turn Remember off.
- [x] Run `npm run test:browser` and the Accessibility half of `npm run test:native` from a terminal that has the browser and Accessibility (R0 on `v0.6.0-rc.1`: 14/14 and 49/49; see [release/0.6.0-rc.1.md](release/0.6.0-rc.1.md)).
- [ ] Dark appearance and VoiceOver pass over the bar, the Files popover and Settings.
- [ ] The owner decides the service-terms question.
- [x] Signing, hardened runtime, notarization and Gatekeeper, or an explicit decision to ship unsigned: the owner chose a **private technical beta** (2026-10-16). 0.6.0 ships as a GitHub pre-release signed with the local identity, labelled as needing right-click → Open on first launch. Developer ID and notarization stay required for a public release.

## DeepSeek Harness plugin (`dsh-chatgpt-panel` 0.1.0)

Done on 2026-10-16 with synthetic data only: `npm test` (41 plugin tests) and `npm run test:dsh-electron` (16 checks in real Electron 43.3.0). See [support-matrix.md](support-matrix.md).

- [ ] Owner installs `dist/dsh-chatgpt-panel` into the `desktop` profile of DeepSeek Harness 0.2.0-rc.2 and confirms it loads (Plugins page shows "ChatGPT panel", no boot error).
- [ ] **Add from ChatGPT** appears left of the model selector in every session; with the window closed one click opens it in front of the harness; its menu offers Add, Show window and Open ChatGPT tab.
- [ ] The **ChatGPT panel** row appears in the left bar and opens the plugin page; its status follows the window (open, hidden, closed) within about a second.
- [ ] The ChatGPT tab opens from the right sidebar's guide and from the button's menu, uses the harness's controls in light and dark; Open starts the window; sign-in persists across a helper restart and a Desktop restart.
- [ ] Add into an empty draft and a non-empty draft (with a file chip): appended at the end, nothing replaced, nothing sent.
- [ ] A conversation with an uploaded file and a generated file: both saved under `~/Downloads/Add to Claude/<title>/`, paths and SHA-256 in the text, verified.
- [ ] External links open in the default browser; sign-in popups (Google, Apple, Microsoft) complete.
- [ ] Quitting Desktop ends the helper; quitting the helper leaves the tab showing "closed".
- [ ] Independent review of the plugin: security, functionality and rendered UX.

## Release gates (runtime hygiene, 2026-10-16)

- [ ] Signing: builds signed with a stable identity (local "add-to-claude Local" now; Developer ID, hardened runtime and notarization before any public release). Check that an update keeps the Accessibility grant.
- [ ] Endurance pass on the owner's Mac: several long conversations opened in turn, repeated target switches, a hand-off with a large file, network loss, sleep and wake, a WebKit content-process crash, and Clear Web Cache followed by a check that the sign-in survived. Export diagnostics afterwards and record peak memory from Activity Monitor.
