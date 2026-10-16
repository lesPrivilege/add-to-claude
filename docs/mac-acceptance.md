# Mac acceptance log

## 2026-10-16 · Files on Add, Settings, rename

Confirmed by the owner:

- **Generated file.** Add downloads `topbar_attachment_test.md` into `~/Downloads/Ferry/Top Bar封装与登录继承/`, and the hand-off text carries its path and SHA-256 under the turn's `### Files`.
- **Panel controls and Settings.** The header controls, Settings window, pin and click-away hiding were used during the round without problems reported.

What was wrong before: Add never downloaded anything itself, and the Files list only offered files whose link the page had already fetched. A generated file is referred to by its sandbox path, so it never matched. Now the app asks the page for each missing link through the page's own session, then downloads.

Since then:

- The app is Add to Claude, with bundle id `io.lesprivilege.add-to-claude`. The panel's ChatGPT login and settings start fresh under the new id, and Accessibility must be granted again.
- The temporary diagnostics are gone.
- A linked file's "download this file" check is dropped, and a hand-off with no checks left reads verified. Not yet seen live.

## 2026-10-14 · Live round with the owner's account and Claude for Mac

What works now, confirmed by the owner:

- The panel opens under the menu-bar icon, keeps its own ChatGPT login across restarts, and keeps the page while hidden.
- Old and new conversations project completely and in order. The live site loads a conversation from `GET /backend-api/conversations/<id>?num_turns=…` (flat `messages`, `current_node`, `page_info`) and older pages from `/conversations/<id>/messages?before=…`. Both are observed passively, converted to the classic tree and merged. Reasoning (`thoughts`, `reasoning_recap`), memory context and tool entries are hidden.
- Preview, Copy and Save produce the hand-off format (`## Turn N — Role`, original Markdown, `### References`, per-turn `### Files`).
- Add puts the conversation into an empty Claude prompt without activating Claude or sending.

How Claude was reached, from the diagnostics:

- Claude reports no app-level focused element; the composer is the window's single writable `AXTextArea` ("Prompt", tiptap/ProseMirror).
- Its empty draft reads as one newline, and the caret cannot pass it.
- It accepts `AXSelectedText` writes but never applies them. Setting `AXValue` on the empty prompt works within about 0.3 s, with a readback equal apart from collapsed blank lines.
- The app remembers per bundle id that insertion is ignored and skips the 2 s wait next time.
- A non-empty prompt uses Command-V posted to Claude's process only; Claude turns the pasted Markdown into formatting, so success is "the draft changed".

Not working yet:

- Attachment downloads. The page fetches `/backend-api/files/download/<id>` (`status, download_url, metadata, file_name, creation_time, no_auth_user_upload, mime_type, file_size_bytes`) when it shows a file, and the observer keeps that link. But the chat's own file card does nothing in the panel (no navigation, new window or download was logged), and the Files list did not offer the generated `topbar_attachment_test.md` as downloadable even after name matching.
- Other target apps, non-empty Claude drafts, and panel stacking (the panel stays above other apps until the icon is clicked).

These findings came from temporary diagnostics in the unified log. They were removed on 2026-10-16.

## 2026-10-14 · Embedded panel (supersedes the Chrome extension route below)

The owner pasted a design note favouring an embedded web view. A throwaway login probe (a menu-bar panel with `WKWebView` and the default persistent store, user agent unchanged) then established:

- The owner can sign in to ChatGPT inside it.
- They stay signed in after a restart.
- Messages send normally.

The Chrome extension, the native-messaging relay and the socket link were therefore removed. The app now owns the WebKit view: the observer runs in the page world, and the compiler and bridge run in WebKit's isolated `defaultClient` world.

- `npm test` passed 83/83, and `npm run test:browser` passed 14/14.
- The WebKit half of `npm run test:native` passed 19 checks against the real `ChatController` in a real `WKWebView`. The page's own (stubbed) fetch fed the real observer, and page-forged packets were ignored.
- A second independent review (Opus) found that page scripts could forge a conversation through the shared `postMessage` channel. The observer now hands the bridge a private `MessagePort` at document start; the forging check was confirmed to fail without the fix. The same review's other fixes:
  - handler messages from popups are ignored;
  - top-level navigation is limited to ChatGPT and the sign-in hosts;
  - non-web schemes are no longer opened externally;
  - the panel hides when the app loses focus and is clamped on screen;
  - Escape hands focus back;
  - closed popups are released;
  - downloads are quarantined;
  - crash reloads are capped;
  - stale responses are dropped.
- The Accessibility append is unchanged from the owner's 49-check run below.
- Handoff bar snapshots were reviewed in four states.

## 2026-10-14 · Chrome extension route (removed)

macOS 27.0.1 (arm64), Swift 6.3.3, Node 25.9.0, Chrome for Testing 149. Synthetic data only.

- `npm test` passed 90/90, and `npm run test:browser` passed 14/14.
- `npm run test:chrome` passed in real Chrome for Testing with the built extension and the real compiled relay. The app was replaced by a stand-in built on the real `ChromeLink`. It recorded:
  - the state;
  - the exact Markdown and its hash;
  - the final check turning false after in-page navigation;
  - reconnection after the stand-in app was restarted;
  - "none" after the tab closed.

  The page made only its own two requests.

- `npm run test:native` passed 21 link checks against the real relay. The owner then ran it from a terminal with Accessibility access, and 49 Accessibility checks passed. Every append ran with the synthetic app in the background, and none activated it. On macOS 27, `NSApp.deactivate()` has no effect and an app that yielded focus cannot take it back. The harness therefore yields to Finder and re-opens the app through LaunchServices; probes on this Mac confirmed both behaviours.
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

Earlier runs (0.3.0 and Codex's 34 Accessibility checks on the Codex branch) covered the previous design and are in git history.

## Notes for whoever continues

- The app is an accessory process (`LSUIElement`). Screen tools that filter by app allowlist may not show its popover.
- An unsigned rebuild changes the code signature, so macOS may ask for Accessibility again.
- Run the Chrome test with `EXTENSION_CHROMIUM_PATH='<Chrome for Testing binary>'`. It opens a visible window.
