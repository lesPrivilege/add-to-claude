# gpt-handoff

A small local utility for moving one selected ChatGPT conversation into a composer you already have open. Agent names are choices in a shared handoff flow. Nothing is sent or executed automatically.

**Active work:** [product contract and acceptance requirements](docs/product-contract.md), derived from the user's referenced ChatGPT session and subsequent embedded-chat clarification. The reconstruction starts from the Mac acceptance branch; the full acceptance goal remains open.

**Status: Chrome-session integration implemented for acceptance; not release ready.** The primary surface is the owner's existing signed-in Chrome ChatGPT app. The status-bar launcher opens/hides that window; Handoff's small extension popup prepares the selected conversation, previews it and requests an append through an allowlisted native helper. Normal capture/Add does not force a refresh or open a local desk. See [Chrome setup and boundaries](docs/browser-extension.md).

Current checks cover passive source parsing, a real installed popup with a simulated native transport, native protocol/framing and candidate builds. Owner-profile installation, live selected-source acceptance and real target insertion/files are still open. WebSocket replay remains explicitly partial. The prior WebKit/portable desk is retained as a legacy component. [Mac acceptance](docs/mac-acceptance.md) distinguishes every result and limit.

## Run on the cloud VM

Use an installed Node.js 24 or newer runtime. The utility has no runtime npm dependencies.

```sh
cd /workspace/gpt-handoff
node src/server.js
```

Open `http://127.0.0.1:43119/` in the same machine's browser. The local test composer is at `/composer.html`; open two windows to test selection. The server deliberately listens on loopback. Do not expose it through a public tunnel. In a different checkout, use its own directory instead of `/workspace/gpt-handoff`.

## Legacy portable desk use

1. Build and load the [Chrome extension](docs/browser-extension.md). Open the intended ChatGPT conversation, click gpt-handoff → **Use this conversation** → **Open in local desk**. **Find open ChatGPT tabs** offers exact tab/window choices after an optional site-access grant. To preserve original Markdown instead, choose **Choose export** and select `conversations.json` from the ZIP you downloaded through ChatGPT's normal export flow. Pick one conversation and its current or alternate branch. The rest of the export is released after selection. **Paste turns** accepts Markdown separated by `## User` and `## Assistant` headings and stays unverified.
2. Review the turns, source links, branch, and missing-content checks. “Selected branch verified” means the supported text in that export path was accounted for. It does not authenticate the export, prove live-page completeness, or include other branches. Missing, streaming, nontext, or unresolved citation content remains partial.
3. For exposed HTTPS attachment links, **Download** in the extension uses Chrome’s normal downloader after an optional permission grant. Then use **Select downloaded files** in the desk to choose the completed files together. Recorded final names and sizes provide matching hints; they do not prove source identity. **Select file** pairs an individual source reference when needed. Unsupported or expired links keep the normal source Download/reopen action. The JSON retains the locator and selected bytes’ SHA-256 without embedding bytes; saved files must be selected again on import.
4. Choose a destination. The local test composer confirms insertion and file bytes; append is the default, with an explicit replace choice. Other names copy to the clipboard and say **Copied**. Paste into the intended client yourself, or use the native menu's confirmed append on a compatible writable text area. Files must be attached manually outside the controlled composer. No path presses Enter.

The native menu discovers app and window titles after an explicit Accessibility grant, then binds to the selected window and focused writable text area. It rejects known terminal hosts and code panes. An unreadable composer needs manual paste. See [native build/use/uninstall](native/README.md) and the [support matrix](docs/support-matrix.md).

## Build and test

```sh
npm ci --ignore-scripts
npm test
npm run test:e2e
npm run test:extension
npm run test:chrome
npm run build:extension
npm run build
```

Browser tests use the installed `/usr/bin/chromium`. Set `CHROMIUM_PATH` to another trusted installed Chrome/Chromium executable when needed. They use only synthetic data and never connect to an agent. On macOS, use `CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e`. The installed-extension lifecycle cases run only when `EXTENSION_CHROMIUM_PATH` names a Chromium or Chrome for Testing binary (branded Chrome ignores `--load-extension`); they open a visible window. See the [Mac acceptance log](docs/mac-acceptance.md).

`npm run build` creates a deterministic file manifest and a runnable copy at `dist/gpt-handoff`. Native build requires macOS 13+, Xcode command-line tools, and an installed Node 24 or newer path:

```sh
bash scripts/build-macos.sh /opt/homebrew/bin/node
open dist/gpt-handoff.app
```

This is an unsigned local build recipe, not a signed installer. The app relies on that installed Node path. [Release checklist](docs/release-checklist.md) records the native and publication work still outstanding.

After committing a reviewed checkpoint, `python3 scripts/package-release.py` creates a local ZIP with source, screenshots, checksums, a ready-to-load `chrome-extension` folder, and the full Git bundle. Existing version archives are never overwritten. It requires a clean Git tree and does not publish anything.

## Local data and removal

Conversation text, selected files, and target metadata stay in memory. The bridge clears transfer payloads after completion, failure, cancellation, or expiry. Refresh/close the desk to discard its selected content. Saving JSON/Markdown is explicit. Clipboard content remains until you replace it. No telemetry, account, credentials, transcript archive, browser history scraping, or cloud relay is installed. The optional extension uses temporary current-tab access. Finding existing ChatGPT tabs and reaching the local desk request separate optional host grants; remove those grants or the extension in Chrome at any time. Download assistance separately requests Chrome’s downloads permission. It queries only IDs returned for requested downloads, never global history. Normal downloaded files remain in Chrome’s download folder; remove them there if no longer wanted. No transcript enters extension storage.

Remove the extension at `chrome://extensions`, stop the Node process with Ctrl-C, and remove this directory to uninstall the portable utility. For the native build, quit and delete the app, then revoke its Accessibility permission if granted. No login item or daemon is installed. File and memory bounds, caller checks, and the local-user trust boundary are in [architecture](docs/architecture.md).

[Claude handoff](docs/claude-handoff.md) · [Independent review](docs/independent-review.md) · [Research and provenance](docs/research.md) · [Target inventory](docs/target-inventory.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)
