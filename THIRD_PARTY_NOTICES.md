# Third-party notices

Runtime application code has no npm dependencies. All utility code, SVG interface icons, and synthetic fixtures were written for this project. No Magpie, codex-chatgpt-web, third-party screenshot, font, or external conversation was copied into the application.

Development dependencies are locked in `package-lock.json`:

| Dependency                           | Version | License    |
| ------------------------------------ | ------- | ---------- |
| @playwright/test                     | 1.56.1  | Apache-2.0 |
| playwright                           | 1.56.1  | Apache-2.0 |
| playwright-core                      | 1.56.1  | Apache-2.0 |
| prettier                             | 3.6.2   | MIT        |
| fsevents (macOS optional dependency) | 2.3.2   | MIT        |

Their installed packages retain their own LICENSE/NOTICE files under `node_modules`; dependencies are not vendored into the source or portable runtime artifact. Chrome/Chromium, Node.js, macOS and Xcode are separately installed tools with their own licenses. Node.js is used only to build the WebKit scripts and run tests; the app does not use or redistribute it. Future redistribution of a runtime must include its applicable notices.

Source provenance and official documentation links are in `docs/archive/research.md`. Names of third-party applications identify possible destinations, not affiliation or guaranteed compatibility. The project itself is under the MIT License (`LICENSE`); it adds no end-user agreement of its own.
