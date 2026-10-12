# Handoff for Claude

The user reserved final visual refinement for Claude. Version 0.3.0 stops at correctness and interaction evidence; it adds no framework or new visual direction. Keep the product a small conversation-to-existing-composer utility. Never send, execute, install an agent runtime or claim universal compatibility.

Start with `README.md`, `docs/test-results.md`, `docs/independent-review.md` and the actual screenshots under `artifacts/`. Run `npm start`; `/` is the desk and `/composer.html` is the controlled test target. `npm run build:extension` produces the popup/source adapter. This VM's managed browser cannot load extensions; the API harness is explicitly separate evidence.

## Correctness added in 0.3

- Selected-conversation traversal with stable IDs, overlapping ordered windows, progress/cancel, bounds and observed-boundary evidence. It never marks DOM content complete or original Markdown.
- Verbatim turn Markdown through projection, including angle-bracket links, autolinks, quotes and literal HTML; rendering remains plain text.
- Normal exposed-link download assistance, final filename/size hints, one multi-file selection and byte-integrity receipts in the controlled composer. No automatic byte access or source-origin authentication claim.

## Maintenance choices

Three pieces carry most complexity: collection identity/order across virtualized windows (`src/collect.js`), popup/worker lifetime and selected-document locking (`extension/worker.js`), and download metadata to user-selected byte association (`extension/downloads.js`, `web/app.js`). Keep their regressions if changing those boundaries. The single-snapshot capture stays independently testable.

The AppKit Accessibility adapter is optional source, uncompiled and untested on macOS. It is the largest optional platform surface. Validate it on a Mac before investing in additional client adapters. Named clipboard destinations are labels, not native integrations; do not build a per-vendor framework without an actual tested transport need.

Do not add clipboard interception, private ChatGPT API requests, directory handles, a hosted transcript relay, telemetry, or persistent conversation storage to reduce clicks. None is needed for the working bounded path. A later batch-download UI could be considered after real extension acceptance; current download buttons are sequential and the byte picker is shared.

## Remaining platform work

Authorized Chrome lifecycle/live synthetic-source acceptance, macOS compile/accessibility/permission and real-client checks, signing/notarization, and private GitHub publication remain outstanding. Existing GitHub authentication failed and the connected tool could not create a repository. Preserve the local Git history and all versioned archives; no remote publication or native release verification is claimed.
