# Support matrix

Evidence for Add to Claude 0.5.0 on macOS 27.0.1 (arm64), recorded 2026-10-16. Automated checks use synthetic data only. "Verified by the owner" means the owner ran it with a real ChatGPT account. Nothing here certifies a client that was not tried.

## Automated

| Check                                                                                                                                                                                                                              | Result                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm test`: model, adapters, compiler, rendering-markup cleanup, page observer and file-link resolver, bundled bridge, per-file line positions                                                                                     | 136/136 (99 core, 37 plugin)                                                                     |
| `npm run test:native`, WebKit half: the real `ChatController` in a real `WKWebView`; page-forged packets and late ports ignored; responses prepared in order; revocation on navigation; same-name files linked to their own copies | 21 checks                                                                                        |
| `npm run test:native`, Accessibility half: background append with exact readback, target never activated                                                                                                                           | 49 checks in the owner's earlier run; **not run** in this round (the runner lacks Accessibility) |
| `npm run test:browser`: page observer in Chrome for Testing                                                                                                                                                                        | **Not run** in this round (browser not installed on the runner); 14/14 earlier                   |
| App build (unsigned, macOS 14 target) and snapshot render of the bar and Settings                                                                                                                                                  | Builds without warnings                                                                          |

## On the owner's Mac

| Area                                                                                                                        | Status                                                       |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Sign in to ChatGPT in the panel, stay signed in across restarts, send messages                                              | Verified by the owner                                        |
| Panel opens under the menu-bar icon; hide and show keep the page and a streaming reply                                      | Verified by the owner                                        |
| Live conversation load, including long paged conversations; reasoning and tool entries hidden                               | Verified by the owner                                        |
| Preview, Copy and Save produce the hand-off format with original Markdown and references                                    | Verified by the owner                                        |
| Add into Claude for Mac with an empty prompt, without activating it or sending                                              | Verified by the owner                                        |
| Add into a non-empty Claude prompt (⌘V fallback) and into a second app                                                      | **Not verified**                                             |
| Generated file downloaded on Add, its path and SHA-256 in the text                                                          | Verified by the owner (one Markdown file)                    |
| Uploaded files and images on Add                                                                                            | **Not verified**                                             |
| Rendering markup (`<box>`, `<Entity/>`, `<Cite/>`, private-use markers) read as clean Markdown; repeated checks listed once | Synthetic only; **not yet seen live**                        |
| Header controls, Settings, pin, click-away hiding                                                                           | Used by the owner in the 0.4 build without problems reported |
| Global shortcut, login item, sign out                                                                                       | **Not verified**                                             |
| Renamed build (`io.lesprivilege.add-to-claude`): fresh login, fresh Accessibility grant                                     | **Not verified**                                             |
| Dark appearance, VoiceOver, keyboard-only use                                                                               | **Not verified**                                             |
| Signing, notarization, Gatekeeper                                                                                           | **Not done**: no signing identity on this Mac                |

## DeepSeek Harness plugin (`dsh-chatgpt-panel` 0.1.0)

| Check                                                                                                                                                                                                                                                    | Result           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Node unit tests in `npm test`: navigation policy, payload validation, file names and the `linkFiles` port, appending to the draft, host routes, helper channel, built preload, client bundle (composer button, tab, page)                                | 41 pass          |
| `npm run test:dsh-electron`: the ChatGPT window in real Electron 43.3.0, throwaway profile, synthetic chatgpt.com served in memory; observer, compiled text, file link, download with SHA-256, verified text, link policy                                | 16 checks        |
| Inside DeepSeek Harness 0.2.0-rc.2: installed in the owner's `desktop` profile (linked); the guide entry and tab rendered. The restyled tab, composer button, left-bar page, routes and appending into the real composer are not yet verified end to end | **Partly seen**  |
| Real ChatGPT sign-in and a live conversation in the plugin's window                                                                                                                                                                                      | **Not verified** |

## Review

An independent review (Opus, 2026-10-16) of every change since `902166b` found nine defects: overlapping downloads, same-name files merging, downloads recorded under the wrong conversation, resolve timeouts and queuing, the verified upgrade, a `..` file name, unescaped names, and ⌘W. All nine are fixed in `ae0875f`. The new checks for same-name files are in the WebKit suite.

Whether reading ChatGPT's own page data and requesting file links through its session fits the applicable terms is the owner's decision. These tests do not settle it.
