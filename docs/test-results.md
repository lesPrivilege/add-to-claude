# Validation record

Current reconstruction evidence (2026-10-13) is in [Mac acceptance](mac-acceptance.md): **101/101 unit checks, 58/58 ordinary browser checks, 23/23 extension checks**, seven native WebKit synthetic scenarios, Swift typecheck and unsigned native build. Source-level independent review covers the new stream boundary and automatic preparation. These are scoped checkpoints, not final R1–R8 acceptance. Live login, native composer insertion, file transport and distribution checks remain open. The record below preserves earlier Linux delivery evidence.

Native file follow-up: 30 exporter checks and eight actual WKWebView download scenarios passed on synthetic data; separate candidate build passed without replacing the app being used for login. See the native file/export section of [Mac acceptance](mac-acceptance.md) for fixture assumptions and remaining runtime gaps.

2026-10-12 · Linux cloud VM · synthetic data only.

| Check                                                          | Result                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                     | 54/54 passed; independently repeated by the reviewer.                                                                                                                                                                                                                |
| Full `npm run test:e2e`                                        | 47/48 passed before final fixture repair and added count-conflict regression. The new download test initially used a route-mocked download filename incorrectly.                                                                                                     |
| Final collection regressions                                   | 14/14 passed, including structural IDs under capped diagnostics, anchor restoration, cancellation cleanup and contradictory page counts.                                                                                                                             |
| Final attachment regressions                                   | Both new cases passed: real loopback HTTP → Chromium download → multi-file selection → source association/hash → two exact controlled-composer files; ambiguous names/sizes and mismatch rejection. The transfer test explicitly acknowledges its unverified source. |
| `npm run test:extension`                                       | 13 passed with real Chromium UI/DOM and mocked extension APIs; 6 installed-extension cases explicitly blocked/skipped by managed policy. Three affected cleanup/UI checks passed again afterward.                                                                    |
| `npm run format:check`                                         | Passed.                                                                                                                                                                                                                                                              |
| `npm run build`, repeated, compared `SHA256SUMS`               | Byte-identical source-file manifests.                                                                                                                                                                                                                                |
| `npm audit --audit-level=high`                                 | 0 vulnerabilities reported at 0.1.0 checkpoint; locked dependency versions unchanged.                                                                                                                                                                                |
| `bash -n scripts/build-macos.sh native/build-test-composer.sh` | Passed.                                                                                                                                                                                                                                                              |
| Python plist parsing/assertions                                | `LSUIElement`, executable identity, 0.3.0/build3 verified.                                                                                                                                                                                                           |
| Native build on Linux                                          | Correctly refused at the prior checkpoint; no native binary produced.                                                                                                                                                                                                |
| Swift compile/runtime/signing/notarization                     | **Not executed.**                                                                                                                                                                                                                                                    |

All **49 distinct current ordinary browser scenarios** have passing evidence: 12 capture, 14 collection, four source handoff and 19 transfer cases. This combines the full run and affected-path reruns, not a claim that the final full suite was repeated. The first download fixture failure was corrected to use a real temporary loopback server; the next run reached the required review gate, which the test then acknowledged. No production bypass was added to make the test pass. Installed-extension skips are not passing evidence.

A smoke test also started the packaged server from `dist/gpt-handoff` and verified its health, utility HTML, module, and controlled-composer routes.

Environment: Node 24.19.0, npm 11.9.0, installed Chromium 151.0.7922.173, Playwright 1.56.1. Browser automation used the installed VM Chromium; no browser, Claude, agent runtime, OAuth credential, or private account was installed for these tests.

The 17 baseline transfer scenarios cover keyboard dialog focus and Escape, 360 px layout and reduced motion, approximately 300 KB of Markdown/Unicode/links, append and explicit replace, exact attachment bytes, wrong windows, paused targets, changed drafts and conversations, actual closed-window heartbeat expiry, cancellation before claim, failed insertion/retry, expired claim rejection, truthful clipboard success/failure, export branch isolation, unverified pasted content and inert HTML, file type/size bounds, combined encoded-request limit, explicit attachment binding/hash save/reimport, empty MIME fallback, delayed file reads/source changes, mistaken binding removal/reselection, manual target registration, and incomplete-source gating.

The 12 capture cases exercise ordered rendered Markdown/code/citations, normal file references and generated-image download controls, missing indices/counts, hidden variants, streaming, unsupported content, supported URL identities, no fetch/scroll/click/clipboard side effects, size truncation, and source mutation during both asynchronous checks. The scoped observer always disconnects. DOM snapshots remain unverified.

The 14 collection cases exercise overlapping virtualized windows (24 total turns with seven mounted in the extension fixture), delayed earlier/later loading without a total, stable-ID and identical-text behavior, aggregate hidden/branch evidence, gaps and contradictory totals, unindexed order, conflicting/disconnected windows, initial-cancel cleanup, pinned-route checks, streaming/navigation/user takeover, time/step/payload/stall bounds and scroll-anchor restoration. Neither observed boundary upgrades source verification.

The four source cases cover same-origin/same-window nonce exchange, replay/bad-source rejection, explicit replacement or keeping existing files, and a complete synthetic rendered-chat → model → desk → selected controlled composer transfer. The other composer remains untouched. File references remain references until bytes are explicitly selected.

Screenshots in `artifacts/` are real Chromium captures using synthetic content:

- `01-transfer-desk.png`: initial utility.
- `02-compact-review.png`: 360 px layout and visible keyboard focus.
- `03-confirmed-transfer.png`: matching successful receipt with two files.
- `04-composer-receipt.png`: controlled draft and verified file state.
- `05-destination-picker.png`: two actual same-title test windows with distinct identity cues.
- `06-incomplete-source.png`: streaming-content checks and review gate.
- `07-browser-source-handoff.png`: captured rendered source after confirmed insertion, with unresolved file references.
- `08-browser-capture-harness.png`: actual popup HTML rendered with mocked Chrome APIs; **not** an installed-extension toolbar capture.
- `10-collection-progress-harness.png`: active collection count and Cancel, also a rendered API harness.

The independent reviewer and implementation owner inspected the new screenshots. Final aesthetic refinement is reserved for Claude; this pass changed collection/download feedback only.

Managed Chromium policy blocks unpacked extension installation. Actual toolbar invocation, native permission prompts, service-worker suspension, source focus through Chrome APIs, and authenticated ChatGPT markup remain untested. The [browser instructions](browser-extension.md) distinguish those paths from the portable API harness.

The browser composer is a harness owned by this utility. Its receipts do not establish that an external agent or native rich composer is compatible. See [support matrix](support-matrix.md), [independent review](independent-review.md), and [release checklist](release-checklist.md).
