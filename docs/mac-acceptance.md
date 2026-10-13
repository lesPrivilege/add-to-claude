# Mac acceptance log

## Codex reconstruction checkpoint

At the current reconstruction checkpoint, `npm test` passed **68/68** and the full `npm run test:extension` passed **23/23** on Node 25.9.0, Google Chrome 154 and headed Chrome for Testing 149. The extension split is **13 API-mocked cases plus 10 installed-extension cases**. The three added installed cases read a synthetic page's real JSON response across a deliberate reload, preserve and deliver 128 original turns, refuse reload when an unsent draft exists, and cancel/detach before a subsequent capture. Hosts remain pregranted and the toolbar popup remains programmatically opened in this suite. This is not live-account, toolbar-grant or idle-worker-suspension acceptance.

The ordinary browser suite has not yet been repeated for the reconstruction. The Node 25 build failure was independently reproduced in `scripts/build.js`, then repaired along with the remaining lockfile engine bound; `npm run build` now succeeds on Node 25.9.0.

Earlier in this chat Codex independently built and launched both native apps, inspected the real status menu with composer access denied, opened the desk through that menu, checked the bundled Node child and health marker, and verified that Quit removed both the app and its child listener. These checks apply to the prior menu-based UI, not the embedded chat reconstruction now required by the user. The test-only Chrome source-navigation experiment timed out and provides no acceptance evidence. Its processes were closed. The original package's complete SHA256SUMS check passed.

The user now requires ChatGPT embedded in the app, small outer-frame Add/target controls, and no extra blocking screen, flicker or forced refresh during handoff. Native embedded login/navigation, passive selected-page original-data capture, actual client insertion, attachments and complete interaction acceptance remain open. A gpt-handoff Accessibility grant and a synthetic logged-in conversation were requested; no confirmation or URL has been received. See [product contract](product-contract.md) for the full acceptance scope. No release readiness is claimed.

## Embedded workspace observations

For the embedded reconstruction, Codex has these additional observations: `native/Workspace.swift` compiles with WebKit and the app launches its own 940×740 chat window. Computer Use inspected the actual ChatGPT signed-out homepage inside that window, including the site's composer and login controls, with Handoff's small outer-frame target/Preview/Add controls. No separate browser was opened. Login itself was not exercised. The owner was asked to sign in in this embedded window and open a synthetic conversation; that input is pending.

The five `embedded-source.spec.js` cases passed in the installed Chrome browser: the observer adds no request or reload, preserves the site's response, ignores auth/other-conversation responses, invalidates old snapshots on navigation/new-message requests, bounds input bytes and rejects late responses. These are synthetic observer checks, not native WebKit or authenticated-page evidence. The current observer handles a selected conversation GET response; it deliberately invalidates that snapshot on a new-message POST and does **not yet reconstruct streaming responses**. Completing that path without refreshing the chat is a required remaining step. Native target insertion from the new outer-frame Add control also remains unverified.

## Previous worker's report

2026-10-12 · macOS 27.0.1 (arm64) · Xcode SDK 26.5 / Swift 6.3.3 · Node 25.9.0 · Google Chrome 154.0.8037.98 · Chrome for Testing 149.0.7827.55 · synthetic data only.

This is the first run outside the Linux VM. It is partial: the functional real-machine pass (status-bar menu, Accessibility append, real toolbar capture) is being continued separately. Fixture results below are not real-client evidence.

## Executed here

| Check                                                                                                   | Result                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test` (Node 25.9)                                                                                  | 54/54 passed.                                                                                                                                                          |
| `npm run test:e2e` against installed Google Chrome 154, headless                                        | 49/49 passed in one run.                                                                                                                                               |
| `npm run test:extension`, API-mocked harness                                                            | 13/13 passed.                                                                                                                                                          |
| Installed-extension lifecycle, headed Chrome for Testing 149, real extension APIs and real action popup | 7/7 passed after repairing the test harness (below). Host permissions are pregranted in the fixture manifest and the popup is opened with `chrome.action.openPopup()`. |
| `scripts/build-macos.sh`, `native/build-test-composer.sh`                                               | Both compile and launch after the deployment-target fix (below). One deprecation warning: `activateIgnoringOtherApps`.                                                 |
| Status item                                                                                             | The `text.badge.plus` item appears in the menu bar and highlights on click. Menu contents were **not** inspected.                                                      |
| Native test composer                                                                                    | Both fixture windows open and render.                                                                                                                                  |

## Defects found and fixed

- **Native builds could not launch.** `MACOSX_DEPLOYMENT_TARGET=13.0 xcrun swiftc` produced binaries with `minos 28.0` on this toolchain, and `open` failed with LaunchServices error -10825 on macOS 27. Both scripts now pass `-target <arch>-apple-macos13.0` explicitly; `vtool` reports `minos 13.0`.
- **Node 25 was refused.** The `<25` cap in `package.json` and the build script had no technical basis; the full unit and browser suites pass on 25.9. The requirement is now Node 24 or newer.
- **The installed-extension lifecycle suite had never run and could not pass.** Playwright does not surface the action popup as a `Page`, so every case timed out waiting for one; one case used `import()` inside a service worker, which the platform forbids. The suite now drives the real popup through its own DevTools target, requires `EXTENSION_CHROMIUM_PATH`, and gained real collection, cancel and popup-close cases. Branded Chrome 137+ ignores `--load-extension`, so this suite needs Chromium or Chrome for Testing.

No product defect in `src/`, `extension/` or `web/` was found by these runs.

## Still unverified

- Real toolbar click on the production manifest: `activeTab` grant, optional host and downloads permission prompts, denial and revocation. `openPopup()` plus pregranted hosts does not exercise them.
- Capture and collection against live authenticated ChatGPT markup and its real virtualized scrolling. All selectors are so far proven only against synthetic fixtures. The service-terms question in `research.md` is separate and remains the owner's call.
- Service-worker suspension. The lifecycle suite keeps the worker alive on purpose.
- Extension loaded unpacked into the owner's everyday Google Chrome profile.
- Download assistance through the real `chrome.downloads` grant.
- Every status-bar menu action: open ChatGPT, open desk and bundled server start, occupied port, quit terminating the child.
- Accessibility: denial, grant, revocation, window discovery, window selection, confirmed append with exact readback into the native test composer, wrong focus, read-only or replaced editor, changed title, clipboard change during confirmation.
- Any real client composer (Claude, Codex, Cursor and the others are labels only).
- VoiceOver, keyboard-only menu use, dark appearance, Reduce Motion.
- Signing, hardened runtime, notarization, Gatekeeper.

## Notes for whoever continues

- The menu-bar app is an accessory (`LSUIElement`) process. Screen-control tools that filter by app allowlist may not list it, and its menu is then invisible in filtered screenshots.
- Run the lifecycle suite with `EXTENSION_CHROMIUM_PATH='<Chrome for Testing binary>' npm run test:extension`. It opens a visible browser window.

## Foundation review follow-up

A separate read-only reviewer identified four defects: a draft created during Chrome debugger setup could be reloaded; an older selected GET could overwrite a newer snapshot; a failed old response could clear a newer conversation; and preview text survived source navigation. Three new executable regressions first failed for those exact behaviors, then passed after fixes. The native fix validates source identity before mutation and clears/dismisses preview during URL/navigation/process invalidation. The reviewer inspected the fixes and found those four findings addressed. Native preview behavior is still awaiting runtime acceptance.

After these repairs, the full unit suite passed **71/71**, the focused observer/original regressions passed **11/11**, and the five embedded-observer browser cases passed again using an isolated headless configuration that did not interrupt the running native app. Latest Swift source passed typechecking. The visually inspected running app predates the review repairs and is being left open for the owner to log in; rebuild/relaunch and full final-state suites remain required.
