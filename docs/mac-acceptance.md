# Mac acceptance log

## 2026-10-14 · 0.4.0 menu-bar rebuild

macOS 27.0.1 (arm64), Swift 6.3.3, Node 25.9.0, Chrome for Testing 149. Synthetic data only.

- `npm test` passed 90/90, and `npm run test:browser` passed 14/14.
- `npm run test:chrome` passed in real Chrome for Testing with the built extension and the real compiled relay. The app was replaced by a stand-in built on the real `ChromeLink`. It recorded:
  - the state;
  - the exact Markdown and its hash;
  - the final check turning false after in-page navigation;
  - reconnection after the stand-in app was restarted;
  - "none" after the tab closed.

  The page made only its own two requests.

- `npm run test:native` passed 21 link checks against the real relay. The Accessibility checks reported NOT RUN, because the shell used here has no Accessibility access.
- `scripts/build-macos.sh` builds `gpt-handoff.app` with `gpt-handoff-host`, the icons and the extension, without warnings.
- Popover snapshots of the real view controller were reviewed in the disconnected, waiting, ready and partial states (light appearance).

An independent review (Opus) of this rebuild found eight defects, and all were fixed with tests:

- a data race on the window list;
- the relay not checking which process serves the socket;
- two Chrome relays displacing each other;
- a superseded response becoming ready;
- a frame-size exit;
- the replay URL check;
- an accept-loop spin;
- a second app copy silently taking the socket.

UX fixes from the same review: the status line now clears for a new conversation, Return no longer triggers Add, the picker no longer rebuilds while open, and focus is handed back after Save. The two new link checks were confirmed to fail without their fixes.

Earlier runs (0.3.0 and Codex's 34 Accessibility checks on the Codex branch) covered the previous design and are in git history. The append logic they exercised is unchanged except that it no longer activates the target or waits 0.35 s; that change still needs an Accessibility run.

## Notes for whoever continues

- The app is an accessory process (`LSUIElement`). Screen tools that filter by app allowlist may not show its popover.
- An unsigned rebuild changes the code signature, so macOS may ask for Accessibility again.
- Run the Chrome test with `EXTENSION_CHROMIUM_PATH='<Chrome for Testing binary>'`. It opens a visible window.
