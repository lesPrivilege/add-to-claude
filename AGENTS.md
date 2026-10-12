# gpt-handoff

This is an independent project. Never modify or push `/workspace/Praxis`.

Build a small local conversation-to-composer utility. Never send, execute, or press Enter for the user. No transcript service, telemetry, credential collection, background history scraping, or persistent conversation archive. Tests use synthetic fixtures only.

Use Node.js built-ins for the local bridge, plain ES modules for browser UI, and Swift/AppKit for the optional macOS status item. Keep dependencies small and locked. Isolate adapters. Text is data, never shell commands or executable HTML. Validate callers, origins, payload sizes, filenames, and target identity at boundaries.

Preserve source order, locators, original Markdown where available, and explicit verification state. A DOM snapshot is partial/unverified. File contents selected by the user stay in memory until discarded or explicitly exported. Clipboard copied does not mean pasted.

Run `npm test`, `npm run test:e2e`, `npm run test:extension`, and `npm run build` before a release. Record actual browser fixture checks, API-mocked extension harness checks, blocked extension lifecycle checks, and unexecuted macOS checks separately. Never change managed browser policy to make a test pass. An independent reviewer must inspect security, functionality, and rendered UX. Update docs/support-matrix.md and docs/release-checklist.md for actual evidence.
