# Mac acceptance log

## Codex reconstruction checkpoint — 2026-10-13

Synthetic data only, on macOS 27.0.1 arm64, Node 25.9.0, installed Google Chrome 154 and Chrome for Testing 149. The owner explicitly deferred embedded login and asked to continue implementation and synthetic tests. No Accessibility grant or real-client insertion is assumed.

| Check                          | Actual evidence                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit suite                     | 101/101 passed after streaming and independent-review repairs.                                                                                                                                                                                                                                   |
| Ordinary browser suite         | 58/58 passed in one final run, including eight embedded observer scenarios and the served native compiler/dependency boundary.                                                                                                                                                                   |
| Extension suite                | 23/23 passed: 13 API mocks and ten installed-extension cases. Hosts pregranted, popup opened programmatically, worker kept alive.                                                                                                                                                                |
| Native WebKit synthetic runner | Seven scenarios passed through actual WKWebView/WKScriptMessageHandler: selected GET, SSE with Request/Response cloning, exact Markdown/Unicode, incomplete transport, historical uncertainty, unchanged draft/no extra requests, navigation invalidation. `bash scripts/test-native-source.sh`. |
| Native source/build            | Swift typecheck and unsigned arm64 app build passed. Runtime target explicitly macOS 13.                                                                                                                                                                                                         |
| Native workspace controls      | 24 subsequent native controller/WebKit checks cover automatic preparation, readiness, delayed source-validity and recovery. Target callbacks are synthetic; real insertion and rendered interaction remain open.                                                                                                     |

The first WebKit runner attempts failed because its navigation policy rejected loadHTMLString's base URL, then because evaluateJavaScript returned an unsupported Promise. These were test-runner repairs, not passing evidence. The final runner blocks subsequent navigation, replaces fetch with synthetic responses and uses a nonpersistent data store. It does not contact ChatGPT or another app.

The stream observer watches only selected GET and normal conversation POST responses already initiated by the website. It reconstructs classic messages and v1 deltas without refresh, preserves request/reply provenance, and retains unresolved completion evidence across subsequent exchanges and branch changes. An authoritative later GET or supported continuation can repair the relevant evidence. WebSocket/handoff reconstruction remains unsupported and explicitly partial; public protocol references do not establish live-account compatibility.

Earlier in this chat Codex built and launched both native apps, inspected the old status menu with composer access denied, started the bundled Node child and verified Quit removed both processes. The embedded reconstruction was separately launched and visually inspected: the signed-out ChatGPT homepage rendered in Handoff with small outer-frame controls and no separate browser. The latest rebuilt app was also launched and inspected through CUA: signed-out ChatGPT rendered in the same window, Preview/Add were disabled without a source/target, the target menu showed Enable composer access, and Escape dismissed that menu back to the chat composer. This does not exercise a prepared source or positive native insertion. Login, current native keyboard/focus/appearance, real target insertion, downloads/file delivery and signing remain open.

The pre-streaming app and its owned server were stopped for rebuilding; its bundle was preserved as `dist/gpt-handoff-before-streaming.app`. A CUA attempt to inspect that older running app timed out; the rebuilt app subsequently opened and rendered successfully. The original package/bundle remains untouched. See [product contract](product-contract.md) for R1–R8 and [independent review](independent-review.md) for reviewed defects. No release readiness is claimed.

## Native file/export checkpoint — 2026-10-13

The owner's current login attempt reached Google's passkey challenge and showed a Bluetooth/device-proximity failure. CUA selected the provider's existing **Try another way** action and confirmed that a password sign-in option was offered. No credential was entered, no account setting changed, and no browser cookie/cache was copied. Authentication remains unverified. WKWebView uses Handoff's own persistent website data store; Chrome/Safari cookies are not shared with it. No auth URL, challenge token or account identifier is recorded here.

The new **Save…** outer-frame control is implemented for a prepared current source. It asks for an export folder only after the explicit action, downloads supported exposed HTTPS files through that webview's ordinary `startDownload` API, and saves full `context.md`, original `conversation.json`, actual file bytes and a SHA-256 receipt manifest. Missing/expired/unsupported files remain unresolved. It never changes Add's completeness decision or calls a saved file attached/inserted. Native file insertion into a real target remains unfinished.

Validation: `bash scripts/test-native-files.sh` passed **30 exporter checks** and **eight native WKWebView download scenarios**, including exact Unicode bytes, same-name files with distinct ownership, stale redirect callbacks, login HTML/type refusal, chunked oversize, size mismatch, interruption, cancellation and source-change cleanup. Export checks cover >2 MiB text without truncation, unsafe/NFD filenames, hashes, source mismatch, missing files and cancellation around staging/publication. The fixture uses a loopback HTTP server and an injected URL-eligibility function; production eligibility requires HTTPS. WebKit emitted `sandbox_extension_issue_file failed` diagnostics in the unbundled runner, but the observed files/bytes and cleanup assertions passed. This does not establish live signed-in file-download compatibility.

Swift typecheck and a separate unsigned app build passed. `dist/gpt-handoff-files-reviewed.app` is the latest file/export checkpoint; it was **not launched**, preserving the owner's active login in `dist/gpt-handoff.app` (streaming checkpoint). The actual Save chooser, positive export from that running native UI, cancellation responsiveness and real-client attachment reception still require runtime acceptance. The build script accepts an optional absolute output `.app` path so a candidate can be built without replacing a running app.

## Workspace runtime checkpoint — 2026-10-13

`bash scripts/test-native-workspace.sh` passed **24 checks** through the production Workspace controller, real AppKit controls, the actual source observer and the real local compiler in separate WKWebViews. Synthetic source data and a nonpersistent website store are injected; the fixture has no external network/account and uses an ephemeral loopback server. It checks initial disabled controls, automatic Preview/Save without a target, target-dependent Add, immutable exact text, suppression of duplicate/automatic Add, source change during a pending callback, partial/long-context gating, successful-callback selection clearing, compiler recovery without source refetch and an older delayed compiler result arriving after a newer source.

The test reproduced a genuine recovery failure: `window.handoffCore.compile` was undefined after the core navigation's `didFinish`. WebKit had finished navigation before evaluating the module. The repaired app waits for a local-core readiness signal and verifies the current document's compiler function, with origin, loading and navigation-generation guards. The previously failing recovery now passes. The test invokes the compiler-stop notification directly; it does **not** kill a WebKit process. Target insertion is an injected callback, **not Accessibility/real-client acceptance**. No fixture window is presented, so these checks do not certify rendered layout, keyboard navigation, VoiceOver or the Save chooser.

The focused served-core browser regression and the unsigned candidate build passed after this fix. `dist/gpt-handoff-workspace-reviewed.app` is the new candidate and was not launched; the owner's login process remains untouched. `security find-identity -v -p codesigning` reported **0 valid identities** on this Mac. Distribution signing/notarization remains unresolved; no signing identity or credential was created.

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
