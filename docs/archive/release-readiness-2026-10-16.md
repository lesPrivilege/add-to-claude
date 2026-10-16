> Archived 2026-10-16: superseded by [support-matrix.md](../support-matrix.md) and [release-checklist.md](../release-checklist.md).

# Add to Claude · Release Readiness Review

> **Note on merge (2026-10-16):** written from `main` before incremental Add, the Arc Insert icons, the local signing identity and the storage/diagnostics work landed. R1.7 now applies: incremental Add ships, scoped to provider + conversation + destination with per-turn hashes (see `docs/decisions/incremental-handoff.md`). Current evidence is in `support-matrix.md`.

**Recorded:** 2026-10-16  
**Target:** macOS menu-bar app `0.5.0` → Release Candidate (not an approval to publish)  
**Source:** `lesPrivilege/add-to-claude`, `main` at review time  
**Status:** **NO-GO for public release**; prepare evidence and close blockers.  
**Scope:** menu-bar application only. The DeepSeek Harness mod was shelved on 2026-10-16 (see `decisions/deepseek-harness-plugin.md`).

## 0. Product invariant

One user journey: **Open ChatGPT → inspect the current conversation → choose an existing composer → Add a draft**.

- **Add never submits.** It only appends to a selected, existing, editable composer. No automatic window activation.
- A conversation is not “Verified” if turns/files are missing or unverified. The difference between `Verified` and `Partial` must remain visible and accurate.
- No silent clipping, silent retargeting, duplicate injection on retry, or silent file loss.
- Not a model router, conversation archive, full browser or agent controller. Keep the main panel small.
- Two icon tracks: **monochrome native menu-bar template** vs **color/volume App Icon**; do not reuse one asset for both. Avoid the antenna/handle/radio reading, printer silhouette and generic four-point AI sparkle.
- New providers, terminal destinations, “Chat from any browser,” and extensions are **not required** for the first menu-bar release.

## 1. Evidence currently recorded (not rerun for this document)

Source: [support-matrix](../support-matrix.md), [architecture](../architecture.md), [roadmap](../roadmap.md), [README](../../README.md), checked 2026-10-16.

| Evidence               | Current description                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests             | 136/136 recorded (99 core + 37 plugin), synthetic                                                                                                             |
| Real WKWebView         | 21 checks recorded                                                                                                                                            |
| AX real native harness | 49 checks **from a prior run**, not run in the latest recorded round                                                                                          |
| Real Chromium          | 14/14 **from a prior run**, not run in the latest recorded round                                                                                              |
| Real owner smoke       | ChatGPT sign-in/persistence; conversation capture; empty Claude draft; one generated Markdown attachment                                                      |
| Not owner-verified     | Nonempty Claude draft; another target app; uploaded file/images; shortcut/login item/sign-out; renamed stable bundle; dark mode/VoiceOver/keyboard navigation |
| Distribution           | Unsigned build; no Developer ID/notarization/Gatekeeper evidence                                                                                              |

**Inference:** implementation and synthetic correctness are established for portions of the path. End-to-end proof and signed distribution are not. Never silently promote an earlier or synthetic result to current-round real-device evidence.

## 2. External references distilled into product-specific tests

- [Magpie](https://github.com/yetone/magpie): a menu-bar app can be functionally correct and still fail macOS activation semantics. Test `Cmd+Tab`, Dock activation policy, Spaces, full screen and titlebar. [#1381](https://github.com/yetone/magpie/issues/1381), [#763](https://github.com/yetone/magpie/issues/763), [#1252](https://github.com/yetone/magpie/issues/1252). Do **not** copy its model-router UI or its high-frequency release cadence.
- [Raycast engineering analysis](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast): desktop-native feel requires real native popovers/settings, no flicker or web-style hover noise, consistent focus in a WebKit shell.
- [PopClip action guide](https://www.popclip.app/guide/actions) and [beta fixes](https://www.popclip.app/beta): one obvious contextual action; guard busy/reentrant actions and clipboard races rather than only showing a generic error.
- [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution): Developer ID, hardened runtime, secure timestamp, notarytool and stapled ticket for distribution outside the Mac App Store.
- [Apple SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice): launch-at-login registration needs a real installed app and explicit verification.
- [Apple packaging](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution): test the **distributed** app from the actual DMG/ZIP, on a clean machine where possible.

A reference is a candidate grammar, not proof the local implementation conforms.

## 3. Ordered work orders

Each item needs: changed path or rationale for no code change; one failing-before/fixed-after reproduction when applicable; automated coverage where reasonable; owner-device evidence; explicit status `PASS / FAIL / BLOCKED / NOT RUN`.

### R0 — Reconcile runtime, branch and evidence (P0)

1. Capture `git rev-parse HEAD`, app `CFBundleIdentifier`, `CFBundleVersion`, target macOS version, architecture, SDK and signing status. Avoid mismatches between GUI screenshots, Settings, `main`, build and support matrix.
2. Run clean `npm ci`, `npm test`, `npm run test:browser`, `npm run test:native` on one identified commit. Run plugin tests separately; do not confuse their successes with menu-bar release gates.
3. Record per-suite start/end, counts, real vs synthetic mode, skipped checks and relevant OS permission. **NOT RUN must not become PASS.**
4. Freeze an RC commit and do the subsequent manual matrix against that exact binary.

### R1 — Core conversation-to-composer contract (P0)

1. Real-world long conversation; after pagination verify all visible user/assistant turns, order, original Markdown, references, multiline formatting, and absence of hidden reasoning/tool traffic. `Partial` must explain precisely which checks failed.
2. Source revision changes **while Add is in progress**: cancel safely before writing. Source navigation, assistant stream completion, branching, reload, sign-out, WebKit crash and network loss must revoke stale preparations.
3. Selected target must remain the same `PID + window + editable element`; handle closed window, focus change, unavailable AX tree and reparented composer. Never send to a guessed fallback window.
4. Real **nonempty Claude draft**: preserve prefix/suffix/caret and append once; one additional explicitly supported GUI destination. Empty and nonempty fields must both be tested.
5. Clipboard fallback: restore clipboard only when safe and verify copy is not overwritten during concurrent user `Cmd+C`; if safe restoration cannot be proved, report the limitation and fail closed. Do not automatically send Enter.
6. Retry after an uncertain write: do not blindly append the same whole conversation again. Check readback or surface `May have been added — inspect draft` with the recipient. Explicitly distinguish `draft verified` from `request submitted`.
7. The present build is full-conversation Add. If incremental Add ships in the RC, its cursor must be scoped to `provider + conversation + branch + source revision + destination`; detect edits, resets, truncations and target switches. Otherwise label `Full conversation` and keep incremental out of the release scope.

### R2 — Attachment correctness and data boundaries (P0)

1. Real generated Markdown (existing smoke) + real uploaded text/PDF + image + two same-named files. Test temporary link expiry, 403, 404, timeout, parallel downloads, navigation and retry.
2. One conversation gets its own folder; prevent `..`, absolute paths, unsafe names, file collisions, cross-conversation reassignment and temporary partial files mistaken for completed downloads. Hash the actual bytes after saving, not the intended path.
3. A file's final line contains the **right local path and SHA-256**; missing files remain explicit `Partial`. Never claim “verified” merely because the resolver returned a link.
4. Respect configured `Download files on Add`. When disabled, explain that file references alone do not deliver the bytes. Preview downloadable files before starting; show progress, final count and actionable failure.
5. Existing limits: 2 MiB composer text, 16 MiB Markdown projection. Use Save/Copy export with clear user-visible size handling rather than silent truncation. Test threshold boundaries.
6. Do not delete user-chosen downloaded source files as part of cache clearing.

### R3 — macOS interaction grammar (P0 functional; P1 visual polish)

1. One deterministic panel state: anchored under menu-bar item, hidden but WebView kept alive, pinned, Settings foreground, and reopened. First click, click-away, pressing Esc, `Cmd+W`, `Cmd+R`, `Cmd+,`, global shortcut and repeated clicks have coherent meanings. Controls show pressed/disabled/busy/success/error.
2. No focus theft from the target app during Add. When the app opens Settings or another native window, its own click-away logic must not immediately hide the panel by mistake.
3. Real device matrix: internal/external monitor; menu-bar reflow/notch; different display scaling; multiple Spaces; a full-screen app; Stage Manager if available; sleep/wake; display disconnect; show/hide during streaming; lost network; slow WebKit. Verify placement and scroll continuity.
4. Native template menu-bar glyph tested at 16/18/20 pt on light/dark backgrounds, tinted menu bar and display scaling. Separate visually legible App Icon at 16/32/64/128/512/1024 px. **Design review is not passed by an SVG render alone.**
5. WebView remains a browser surface; avoid reconstructing its page grammar. Native bar remains visually quiet, with the Add action consistently discoverable; no hover-only essential operations; no fake disabled controls.
6. Keyboard navigation, VoiceOver labels, visible focus, minimum actionable targets and adequate contrast in light/dark appearance. Test `200%` text scaling where the OS permits and macOS accessibility text settings.

### R4 — Files, cache, logs and privacy lifecycle (P0)

1. Inventory actual persistent storage locations: WebKit website data (credentials/cookies), UserDefaults, chosen downloads, OS logs, app logs, previews, temporary files, crash diagnostics and update files. Measure disk footprint before/after use; do not conflate them.
2. Default minimal retention: prepared text in memory; no hidden conversation transcript archive. If cached derived data exists, define owner, size cap, TTL/invalidation, deletion trigger and no cross-account reuse.
3. Settings exposes **storage overview** (categories + sizes + paths where available), **clear derived cache**, **reveal downloads folder** and **sign out / clear site data** as distinct actions with distinct consequences. Never implement one indiscriminate `Clear everything` button that deletes user files.
4. A diagnostic log can record event ID, phase, duration, outcome, error code and file count. It must not contain message content, ChatGPT cookies/tokens, raw signed download URLs or full local paths unless the user explicitly exports a redacted diagnostic.
5. Bounded queues, download concurrency, cancellation, timeouts and crash recovery: no orphan handoff, no background CPU spin, no cumulative disk growth from repeatedly showing a panel. Profile 50 show/hide cycles + 10 Add operations + one long paginated conversation.
6. Test fresh login, sign-out, account switch and restart for isolation. Verify that clearing derived cache does not unexpectedly sign out, and that sign-out does not silently destroy user downloads.

### R5 — Trust, permission and failure copy (P0)

1. First-run explanation: reads only ChatGPT conversations loaded into the panel; asks for Accessibility **because it writes only to a chosen existing draft**; never presses Send.
2. Show permission states `Not granted / Granted / Needs retry` with a real path to System Settings and recover when a grant is revoked at runtime; avoid polling dialogs or hard-blocking browsing.
3. A disabled or absent destination shows `Choose an open editor window`, not a misleading Add success. `Partial` requires concise scope disclosure.
4. Model a finite state machine: `No conversation → Preparing → Ready (Verified|Partial) → Resolving files → Downloading → Writing draft → Confirmed|Uncertain|Failed`; stale jobs remain cancellable.
5. Honest messages: `Added to Claude · Draft ready` only after actual AX readback; `Copied — paste into Claude` is a different result. No premature success toast.
6. Explicit owner review of page instrumentation, third-party platform terms and distribution/privacy text; technical tests do not establish platform approval.

### R6 — Signed distribution, update & recovery (P0 public; P1 private beta)

1. Stable bundle identifier `io.lesprivilege.add-to-claude`, bundle version and signing team across builds. Test Developer ID signature and hardened runtime; `notarytool`, staple, `codesign --verify --deep --strict`, `spctl --assess`, quarantine-on-first-launch and the shipped DMG/ZIP.
2. Test clean-machine install and first-run Accessibility grant; upgrade from an older beta while retaining chosen settings/login **without unintentionally inheriting wrong profiles**; signed identity change should have an explained TCC re-grant path.
3. Choose **one** initial distribution route and update policy: manual release notes / download is acceptable for v1; avoid bolting on an unverified auto-updater. Document backup release artifact and rollback steps.
4. Record checksums for distributed archives; immutable tag, release notes, supported macOS/architectures, minimal privacy/support documentation and dependency license audit. `UNLICENSED` does not by itself settle the licensing of bundled dependencies.
5. No release based on unsigned development binary. Signing certificate availability is a **human dependency**, not an engineering failure to mask.

## 4. Manual test scenarios (minimum physical-device gate)

| ID  | Scenario                                                     | Expected evidence                                                       |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| E01 | Fresh app install; ChatGPT login and restart                 | Recording; persisted login or clearly explained SSO failure             |
| E02 | 2–3 old conversations; one `Cmd+R`; send a short new message | Capture order/count/version before and after; no stale handoff          |
| E03 | Long, paginated and branching chat                           | Visible message count and handoff count match; issues explicit          |
| E04 | Claude empty draft, real Add                                 | AX readback; target not activated; no Send                              |
| E05 | Claude nonempty draft with Unicode and cursor in middle      | Existing draft preserved and exactly one append                         |
| E06 | Second actual GUI target                                     | Correct PID/window; wrong target never modified                         |
| E07 | Repeat Add and interrupt at write boundary                   | Explicit dedupe/uncertain status; no silent duplicate                   |
| E08 | Generate file; upload text/PDF/image; two same-name files    | Per-file bytes, path, SHA-256, no collision                             |
| E09 | Revoke Accessibility during session                          | Safe stop, readable error, retry after grant                            |
| E10 | Disconnect, sleep/wake, restart mid-download                 | No corrupt completed file and no stale write                            |
| E11 | Panel anchored/pinned, multi-display, Spaces/fullscreen      | No jump, focus theft, lost panel or dead controls                       |
| E12 | Light/dark, keyboard-only, VoiceOver                         | Accessible complete core path and visible focus                         |
| E13 | Clear cache vs reveal downloads vs sign out                  | Correct distinct storage consequences; no surprise deletion             |
| E14 | Signed notarized DMG/ZIP clean install and upgrade           | Gatekeeper passes; known stable ID; upgrade/rollback evidence           |
| E15 | Idle + show/hide 50x + Add 10x + long session                | CPU/RSS/disk/p95 interaction traces and no unexplained monotonic growth |
| E16 | Content process crash, source navigation, target closes      | Stale revision rejected; no unintended destination edit                 |

Every E-test gets `PASS / FAIL / BLOCKED / NOT RUN`, binary SHA-256, `git HEAD`, OS, machine, date, reproduction, screenshot/video/log pointer. A successful synthetic test does not close an E-test.

## 5. Performance budgets: proposed acceptance targets, measure then calibrate

- Warm native panel show/hide: **provisional p95 ≤ 250 ms** (exclude network page rendering).
- Local prep to composer append, when no download occurs: **provisional p95 ≤ 2 s** on the named owner Mac; no arbitrary timeouts on user download.
- Show/hide 50 times, 10 Adds, one long session: monitor CPU/RSS/FDs/disk. Reject unbounded growth; compare two clean runs after a cooldown rather than comparing noisy instantaneous peaks.
- Every network/file/AX phase must have observable start/end/failure and cancellation semantics; publish measured percentiles and environment, not unsupported “fast” claims.
- Budgets are **initial targets**, not existing benchmark results.

## 6. Release gates and decision rights

- **Gate A, Functional:** E01–E10, E16 pass against frozen RC. No loss/duplication/wrong-target/false verification; any uncertain write is surfaced, not concealed.
- **Gate B, Interaction:** E11–E13 pass. Design owner accepts menu-bar/App Icon separately from the functional review; no critical keyboard/a11y deficit.
- **Gate C, Operations:** E15 passes with diagnostics; clear retention/storage semantics and a support path exist.
- **Gate D, Distribution:** E14 passes using the actual signed/notarized asset from a clean install. A stable identity and release provenance are recorded.
- **Gate E, Policy:** owner accepts third-party content/access terms and documentation.

**Public-release GO** requires A–E. **Private technical beta** can omit Gate D signing only with a clearly labelled unsigned/permission-friction limitation and only for a trusted test device; A's no-misdelivery invariants cannot be waived. A blocked test remains blocked, not passed.

## 7. Execution order and handoff roles

1. **Fresh reviewer (read only):** audit current `main`/new worktrees against R0–R6, reconcile 0.5.0 docs with actual code. Do not “fix” what is already complete. Produce gap sheet with path, evidence, owner and priority.
2. **Implementer (isolated branch):** close P0 one subsystem at a time. Reuse existing model/adapter/compiler, avoid sweeping rewrites. Run narrowly scoped tests and keep result artifacts.
3. **Independent reviewer:** negative testing on wrong recipient, nonempty draft, concurrent clipboard, competing file download and stale revision; verify that UI success text matches the completed write.
4. **Owner on real Mac:** physical device E01–E16 and icon/interaction visual signoff. Some system behaviors cannot be established by a cloud runner.
5. **Release steward:** hold GO/NO-GO meeting, freeze commit, sign/notarize/archive, verify clean install and preserve release evidence.

### Required handoff packet

```text
RC commit / branch / version / bundle ID / macOS build / machine:
Exact shipped binary checksum:
Summary of code changes:
Gates A–E with PASS/FAIL/BLOCKED/NOT RUN:
E01–E16 links to evidence:
Known residual defects (severity, reproduction, workaround):
Signed/notarized verification logs:
Privacy and platform-terms owner decision:
Release decision (GO / NO-GO) + approving reviewer:
```

## 8. Explicitly outside this work order

- No automatic merge to `main`; no release tag, distribution or self-updater triggered by this review.
- No feature expansion to CW orchestration, new chat providers, general model switching or terminal paste.
- No assumption that the DeepSeek Harness plugin's synthetic/electron tests release the menu-bar app or vice versa.
- No destructive cleanup of login sessions or user-managed attachments during tests without explicit owner authorization.
