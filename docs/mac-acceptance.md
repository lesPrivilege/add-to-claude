# Mac acceptance log

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
