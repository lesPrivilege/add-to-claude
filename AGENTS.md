# gpt-handoff

This is an independent project. Never modify or push `/workspace/Praxis`.

Build a small local conversation-to-composer utility. Never send, execute, or press Enter for the user. No transcript service, telemetry, credential collection, background history scraping, or persistent conversation archive. Tests use synthetic fixtures only.

Use plain ES modules for the Chrome extension and Swift/AppKit for the menu-bar app and its native-messaging relay. Node.js is for build and tests only. Keep dependencies small and locked. Isolate adapters. Text is data, never shell commands or executable HTML. Validate callers, origins, payload sizes, filenames, and target identity at boundaries.

Preserve source order, locators, original Markdown where available, and explicit verification state. A DOM snapshot is partial/unverified. File contents selected by the user stay in memory until discarded or explicitly exported. Clipboard copied does not mean pasted.

Run `npm test`, `npm run test:browser`, `npm run test:chrome` and `npm run test:native` before a release. Record checks that ran, checks that were not run, and real-machine evidence separately. Never change managed browser policy to make a test pass. An independent reviewer must inspect security, functionality, and rendered UX. Update docs/support-matrix.md and docs/release-checklist.md for actual evidence.
