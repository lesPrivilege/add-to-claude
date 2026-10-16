# Support matrix

Evidence for Add to Claude 0.6.1 (build 14, tag `v0.6.1`) is in its [release notes](release/0.6.1.md#review-and-checks): `npm test` 120/120, delivery log 120, WebKit 34, Accessibility 54 (owner's terminal), browser 14/14 carried over from 0.6.0 (observer unchanged), and the owner's run on rc.2 and rc.3. Everything below is unchanged by 0.6.1 unless that page says otherwise.

Evidence for Add to Claude 0.6.0 (build 12, tag `v0.6.0`), a private technical beta, on the owner's Mac: macOS 27.0.1 (arm64), macOS SDK 26.5, Swift 6.3.3, Node 25.9.0, Google Chrome 155. The release code is the code of 0.6.0-rc.7; `v0.6.0` adds only documentation. The per-candidate records are in [archive/release-0.6.0/](archive/release-0.6.0/0.6.0-rc.3.md).

Three kinds of evidence, kept apart:

- **Owner** — the owner did it with a real ChatGPT account and real apps.
- **Synthetic** — automated, against synthetic pages, fixtures and app windows only. It shows the code does what it says, not that ChatGPT or Claude behave the same way.
- **Not run** — no recorded result. Not a failure, and not a pass.

Nothing here certifies a client that was not tried.

## Automated (synthetic)

| Suite                                           | Result at the release code                                                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                      | 116/116 (rc.7; run again on `v0.6.0`: 116/116)                                                                                                 |
| `npm run test:browser`: page observer in Chrome | 14/14 (rc.7)                                                                                                                                   |
| `npm run test:native`, delivery log and scope   | 111 (rc.7)                                                                                                                                     |
| `npm run test:native`, WebKit: real `WKWebView` | 34 (rc.7)                                                                                                                                      |
| `npm run test:native`, Accessibility: real AX   | 54, run from the owner's terminal on rc.2; carried over, since `native/Composer.swift` is unchanged since rc.2                                 |
| `npx prettier --check .`                        | Passes                                                                                                                                         |
| Published archive `add-to-claude-0.6.0.zip`     | arm64, build 12, signed with "add-to-claude Local" (no team, no hardened runtime); `codesign --verify --strict` passes on the unpacked archive |
| Gatekeeper (`spctl -a`)                         | Rejected, as expected: not Developer ID signed, not notarized                                                                                  |

## On the owner's Mac

| Area                                                                                                                 | Result                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in to ChatGPT in the panel, stay signed in across restarts, send messages                                       | Owner                                                                                                                                 |
| Panel under the menu-bar icon; hiding and showing keep the page and a streaming reply                                | Owner                                                                                                                                 |
| Long paged conversations load completely and in order; reasoning and tool entries hidden                             | Owner                                                                                                                                 |
| Preview, Copy and Save give the hand-off format with original Markdown and references                                | Owner                                                                                                                                 |
| Add into an empty Claude prompt, without activating Claude or sending (E04)                                          | Owner                                                                                                                                 |
| Files on Add: PDF, text, images and two same-name generated files (dogfooding corpus on rc.6, fixes checked on rc.7) | Owner: each file downloaded once, same-name files kept apart, every SHA-256 matched its line, no account id in file names or the text |
| Quoted instructions in a conversation arrive as material; the corpus's start and end markers arrive                  | Owner (rc.6)                                                                                                                          |
| Incremental New into a Claude Code session in Claude for Mac                                                         | Owner: "Turns 5–6 of 6 · new since last add" (rc.1 era), "Turns 13–14 of 14 · new since last add" (rc.7)                              |
| Claude for Mac exposes the conversation id of a Claude Code session (`claude.ai/epitaxy/local_<uuid>`)               | Owner                                                                                                                                 |
| Close or change the Claude target window between choosing it and Add (E16)                                           | Owner (rc.7): the target follows whichever session window is open; recorded as observed                                               |
| A reply in progress keeps Add off; the finished reply is read passively                                              | Owner                                                                                                                                 |
| Delivery log on disk holds no message text and no account id; diagnostics hold counts only                           | Owner (rc.7: 0 account-id matches in the log)                                                                                         |
| Accessibility grant kept across an update signed with the same certificate; About shows the version and signature    | Owner (rc.3)                                                                                                                          |
| Menu-bar mark in light and dark menu bars; Settings at 480 × 560                                                     | Owner (rc.4)                                                                                                                          |
| Accessibility revoked mid-session, then granted again (E09)                                                          | **Not run.** The owner's decision: regress on real use after the release                                                              |
| Network lost during a file download, then Add again (E10)                                                            | **Not run.** The owner's decision: regress on real use after the release                                                              |
| Add into a non-empty Claude draft (E05) and into a second app such as TextEdit (E06)                                 | **Not run** (no recorded result)                                                                                                      |
| Add the same scope twice (E07); Choose turns… with a gap; two Claude chats in one window                             | **Not run** (logic covered by the synthetic delivery-log suite)                                                                       |
| A plain Claude chat (`claude.ai/chat/<uuid>`) exposing its id; switching conversations inside one window             | **Not run**                                                                                                                           |
| "Could not confirm" after a reformatting paste, then It's There / It's Not                                           | **Not run** (logic tested only)                                                                                                       |
| Continue in this conversation / Stop continuing for a window without an id                                           | **Not run** (logic tested only)                                                                                                       |
| Settings opening in the panel's place and returning to it (rc.6 behaviour)                                           | **Not run** as a separate check (the rc.6 change answers the owner's rc.5 report)                                                     |
| Global shortcut, open at login, Esc, ⌘W, ⌘R, sign out (E01, E11)                                                     | **Not run**                                                                                                                           |
| Dark appearance and VoiceOver over the bar, Files popover, turn picker and Settings (E12)                            | **Not run**                                                                                                                           |
| Clear and Reload keeps the sign-in; Clear History; files folder (E13)                                                | **Not run**                                                                                                                           |
| Endurance: long sessions, many show/hide and Adds, sleep and wake, peak memory (E15)                                 | **Not run**                                                                                                                           |
| Developer ID signing, notarization, Gatekeeper launch without Open Anyway                                            | **Not done**: needs a paid Apple Developer account; required before a public release                                                  |

## Known and accepted for 0.6.0

- A scripted widget's lines that mix text with bound values (`**{c.id} · {c.title}**`) still come through; the "widgets not included" content check flags the turn.
- A long paste that ChatGPT turned into an unnamed attachment is listed as "…" and not downloaded.

## Reviews

- A ChatGPT review of `442220f` (F01–F07) and two independent Opus reviews; every finding was adjudicated and fixed or declined with a reason in [archive/release-0.6.0/0.6.0-rc.2.md](archive/release-0.6.0/0.6.0-rc.2.md).
- An earlier independent Opus review of the 0.5.0 → 0.6.0 work found nine defects (downloads, same-name files, file names, ⌘W); all were fixed with tests in `ae0875f`.

Whether reading ChatGPT's own page data and requesting file links through its session fits the applicable terms is the user's to check. The owner accepted that risk for this beta; these tests do not settle it.
