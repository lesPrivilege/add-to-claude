# DeepSeek Harness plugin: shelved

**Decision (owner, 2026-10-16):** the DeepSeek Harness plugin is shelved. 0.6.0 ships the menu-bar app alone. The plugin's code leaves the tree; it stays in history at the tag `archive/dsh-plugin-0.1.0`. The direction is kept on the [roadmap](../roadmap.md) as one that waits for the harness to open the interfaces below.

## Why

The owner wanted ChatGPT to live inside the harness, as an internal panel that opens from the harness's own interface. DeepSeek Harness 0.2.0-rc.2 does not let a plugin build that. The only shape left is a separate Electron window run by the plugin, which is a thinner version of what the menu-bar app already does better: the menu-bar app reaches every editor, the Electron window only one.

## What was built

`dsh-chatgpt-panel` 0.1.0 ("ChatGPT panel", tagline "Talk it through in ChatGPT. Finish it in DeepSeek Harness."), pinned to DeepSeek Harness 0.2.0-rc.2 exactly. Checked with 41 unit tests and 16 checks in real Electron 43.3.0; installed in the owner's `desktop` profile, where the left-bar page and the composer button rendered. A live hand-off inside the harness was never verified.

```
Harness page (client half)            Host (Cordis plugin, Node)          Electron helper (own process)
composer button, right-sidebar tab,   /api/chatgpt-panel.* routes  ──▶    ChatGPT window, persist: session,
left-bar page ── fetch ──▶            behind the harness's /api fence      preload bridge, downloads
inputActions.insertText (append only; submit never called)  ◀── state and hand-off text over IPC (fd 3)
```

What carried over unchanged from the menu-bar app: the page observer, the compiler and the hand-off format. That part of the design held; a second destination needed only a destination adapter and a host for the source page.

## What the harness allows (0.2.0-rc.2, read from its app bundle)

- **Plugin client code** runs in the harness's main frame, in the same world as its UI (React and primitives from the shell's module table, no CSP). Large slots exist: `main` (the centre column), the right sidebar (up to 70% wide; push, float, full-screen) and `shell.overlay`.
- **chatgpt.com cannot be framed**: it refuses `frame-ancestors`.
- **`<webview>` works only through a lease** (`window.dshDesktop.browser.acquire`, undocumented). The harness's `will-attach-webview` handler then:
  - replaces every web preference, so there is no preload and no isolated world for the bridge;
  - forces a random, non-persistent partition (`dsh-sidebar-browser-<uuid>`), so the ChatGPT sign-in is lost at every quit;
  - denies popups, which breaks Google, Apple and Microsoft sign-in;
  - cancels downloads and denies permissions.
- **The plugin host is plain Node** started by the harness, with no Electron. It cannot reach the harness window, its bounds or its guests.
- **There is no API** for a plugin to create a child window or a `WebContentsView`, or to learn the harness window's id or bounds.

## Options considered

| Option                                                                                       | Result                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-page `<dialog>`, as Courtwork's assistant does                                            | Not possible: that works for an app's own content, and chatgpt.com cannot be framed                                                                                                                                  |
| The harness's leased `<webview>` in the plugin's tab                                         | Truly internal, but a fresh sign-in after every restart, no social sign-in, no downloads, and it depends on undocumented internals                                                                                   |
| Separate Electron window (what was built)                                                    | Works, but it is a second window beside the harness, not part of it                                                                                                                                                  |
| That window frameless, glued over a placeholder in the plugin's tab by tracking its position | Looks internal, but tracking another process's window from page coordinates lags while dragging and is fragile with Spaces, full screen and zoom. The owner judged it no better than the menu-bar app and stopped it |

## What would reopen it

Any one of these, offered by DeepSeek Harness as a stable plugin interface:

1. A plugin-owned `<webview>` or `WebContentsView` with a **persistent partition** the plugin names, **popups** allowed for sign-in, and **downloads** delegated to the plugin.
2. A **content script in an isolated world** for that view (a preload, or `executeJavaScriptInIsolatedWorld`), so the observer and bridge keep their trust boundary.
3. Or a **child window** API: a frameless window owned by the harness and parented to its main window, positioned against a slot's rectangle.

With 1 and 2, the plugin becomes a right-sidebar tab holding ChatGPT itself, which is the form the owner asked for.

## Restoring the code

```bash
git checkout archive/dsh-plugin-0.1.0 -- plugins/deepseek-harness
```

Then add back the scripts it used in `package.json`: `build:dsh` (`node plugins/deepseek-harness/build.js`), `test:dsh-electron` (`node plugins/deepseek-harness/tests/electron/run.js`), and `plugins/deepseek-harness/tests/*.test.js` in `test`. Its README there covers build, install, the client, host and helper halves, and the security boundaries. Port `linkFiles` from `native/Handoff.swift` again if it changed, and adopt incremental hand-off (it needs the session id as its target identity).
