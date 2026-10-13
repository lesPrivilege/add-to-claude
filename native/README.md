# macOS embedded chat workspace

The status-bar app displays the real ChatGPT website in its own WebKit window. Target selection, Preview and Add are small controls in the outer frame. The reconstructed app has compiled and displayed the signed-out ChatGPT homepage on the Mac. **Login, complete embedded capture and real-client insertion are not yet accepted.** See [Mac acceptance](../docs/mac-acceptance.md) and the [product contract](../docs/product-contract.md). The utility does not install or run an agent.

The icon opens or hides the retained chat window; right-click exposes the utility menu. Normal use opens no separate browser. WebKit uses the app's own login session, not Chrome's cookies. The optional [Chrome extension](../docs/browser-extension.md) is a separate source adapter. No Apple Events/Automation permission is needed by the app.

## Local build

Requirements: macOS 13 or later, an already-installed Node.js 24 or newer, and Xcode command-line tools. WebKit is supplied by macOS; Chrome is only required for the optional extension. No installer or build step downloads a runtime or accepts a license. If Xcode asks for a license, the owner must resolve it before building.

From the repository root, use the absolute path of the Node executable you already trust:

```sh
npm ci
npm test
npm run test:e2e
npm run build
bash scripts/build-macos.sh /opt/homebrew/bin/node
open 'dist/gpt-handoff.app'
```

Use `/usr/local/bin/node` or another installed path if appropriate. The script builds for the current Mac architecture and stores that path in the bundle's `Runtime.plist`. It does not embed Node or produce a portable installer. Moving or removing that Node executable requires rebuilding. Move an earlier `.app` aside before rebuilding, or pass a second absolute output `.app` path to build a separate candidate without touching the running app. The result is unsigned and intended for local acceptance checks; it is not a signed distributable release.

`Info.plist` sets `LSUIElement`, so the launcher lives in the menu bar. The app bundle includes only `src/`, `web/`, and package metadata. Server launch uses Foundation `Process` with fixed arguments and a small environment, never a shell. No transcript is passed as a process argument. Output is discarded rather than retained in logs.

## Use

1. Open Handoff and sign in to ChatGPT in its own window. The local compiler starts separately; a port or Node failure is shown in the outer frame and does not block the chat with an app modal.
2. Open the conversation normally. The observer reads only the currently displayed conversation's own response and introduces no fetch or refresh. The observer handles selected GET responses and normal classic/v1 SSE replies, including ongoing and new conversations. WebSocket/handoff delivery remains explicitly partial; actual logged-in compatibility is unverified.
3. Focus the intended target composer once, then return to Handoff. Enable composer access when wanted, using the system's Accessibility grant. Choose the exact app/window in **Choose Agent**. Selection does not activate that target. Unsupported fields stay unavailable.
4. The source prepares automatically. **Preview** is available before target selection; **Add to Agent** becomes available only for verified current data and a selected target. Add focuses the bound target, rechecks source identity, appends and compares exact text. The button is the explicit action; this primary path has no additional modal confirmation. Preview is a separate, nonmodal view. Partial source data and actual-client support still need the remaining acceptance work. **Save…** provides a complete Markdown/file export when the text cannot fit the 2 MiB native append limit; it does not attach files to a target. Send remains the user's action.

**Save…** chooses a destination folder, then downloads up to ten supported exposed source files through normal WebKit downloads (5 MiB each, 10 MiB total). No refresh or separate browser is opened. **Cancel save** cancels pending work. The output contains `context.md`, `conversation.json`, `files/` and `manifest.json` with source associations and actual SHA-256 hashes. The source model remains capture evidence; the manifest records what was exported. Missing files remain explicit. All temporary download files are removed; only an explicit completed export persists. Exporting does not send text or prove that a target received files. The full native Save interaction and signed-in file compatibility remain unaccepted.

Discovery reads app names and window titles when the workspace or utility menu opens after Accessibility access has been granted. It does not read target editor contents until Add. Discovery is asynchronous, bounded to 80 apps and 30 windows per app. Every accessibility attribute read applies a 150 ms messaging timeout. Window titles and target selections remain in memory.

The native path requires a readable, writable `AXTextArea`. It rejects single-line text fields, known terminal hosts, and text areas whose accessibility names identify terminal, shell, or code panes. That is deliberately narrow: many browser/Electron/editor composers do not expose a writable accessibility value and therefore need manual paste. The user confirms composer identity because accessibility roles cannot prove the business purpose of every text area. Unknown apps are not declared compatible merely because they appear in the picker.

Before insertion the app rechecks process identity and launch time, live window identity and title, frontmost app, focused window, focused editor identity and writable role. Add uses a prepared immutable string and does not change the clipboard. The app appends to the latest readable plain-text value, caps the resulting plain text at 2 MiB, then compares readback exactly. It emits no keyboard events, never presses Return and never handles an attachment as executable input. If readback fails, the outer-frame status asks the user to inspect the draft before retrying because some text may already have changed. The old separate clipboard/confirmation menu path has been removed.

Exact string readback does not verify attachment chips or rich spans already in a third-party composer. Those hosts require explicit native acceptance before claiming draft preservation; the native test fixture uses plain text.

## Uninstall and privacy

Handoff keeps one selected response in memory and does not write a conversation archive. The embedded ChatGPT website and WebKit manage normal cookies, cache and site storage in the app's web data store; those are separate from Handoff's in-memory preparation data. Website content has no native target-operation handler. The local compilation webview has a separate nonpersistent data store and is never used to display website content.

Quit from the menu to terminate only the server process this launcher started. An independently started server is left running. Remove the `.app` bundle. Revoke this app under System Settings → Privacy & Security → Accessibility if access was granted. No login item, daemon, account, runtime, credential, transcript archive, or registration file is installed. Clipboard text remains on the system clipboard until the user or another app replaces it; the launcher does not silently clear unrelated clipboard contents.

## Repeatable native source fixture

```sh
bash scripts/test-native-source.sh
bash scripts/test-native-files.sh
```

This compiles a separate nonvisible WebKit runner using a nonpersistent data store, synthetic fetch responses and the same injected observer bundle. Seven scenarios passed on the current Mac. It exercises the real JavaScript engine and native message channel. The file runner adds 30 exporter checks and eight WKDownload scenarios against a synthetic loopback server. Neither runner establishes login, production protocol compatibility, Accessibility or Workspace control-state behavior.

## Remaining native acceptance checks

Use only synthetic text. The included test composer gives the owner a local AppKit target; it does not contact an agent or submit anything:

```sh
bash native/build-test-composer.sh
open 'dist/gpt-handoff test composer.app'
```

- Build and launch both apps on the intended macOS version and CPU architecture. Verify menu accessibility with VoiceOver, keyboard-only operation, light/dark appearance, enlarged text, and Reduce Motion. The menu contains no custom animation.
- Open the embedded chat; verify missing Node, slow startup, occupied port, wrong health marker, and mismatched native instance. Quit and verify the child exits. An external server must survive launcher quit.
- With Accessibility denied, verify discovery/append are unavailable and ordinary embedded chat opening works. Grant explicitly; revoke while an editor is selected and verify append fails closed. No Automation or screen-recording grant should be requested.
- Focus Composer A, select it, and append synthetic Markdown, Unicode, links, and a long payload. Verify exact text and preservation of the initial draft. A resulting draft over 2 MiB must be rejected. Attachments must remain a separate manual step.
- Select Composer A with Composer B also open; confirm the title and inspect that only A changes. Change title, close the selected window, restart the target app, or replace the editor after selection; verify the selection is rejected. Selecting a read-only editor or a known terminal host must fail.
- Switch the source or target focus during the Add delay and verify no insertion. Change the target draft before Add and verify that the latest draft is preserved. Test a host that rejects `AXValue` or changes the value during write; the app must report unverified insertion and require inspection rather than retrying automatically.
- Test a same-title conversation switch that reuses its editor, and preexisting target attachment chips/rich spans. AX string equality alone cannot verify conversation identity or rich state preservation.
- Exercise every real client to be claimed supported; record app/macOS versions and exact checks in `docs/support-matrix.md`. The common path has no native client certification yet.

For distribution, the owner must choose an existing Developer ID identity, sign with the hardened runtime, perform these checks again under the signed identity, notarize using an already-authorized account/profile, staple, and test Gatekeeper on a clean Mac. No new credential, Apple account agreement, signing identity, or permission was created for this project. No sandbox entitlement is claimed: the optional Accessibility client and explicitly configured external Node runtime require separate review before a store/sandbox distribution path.

## Platform sources

Reviewed 2026-10-12. Current Apple documentation pages are linked below; their full JavaScript/Markdown render was not retrievable in the VM, so the native API usage still requires compilation against the installed macOS SDK. The archived guide was accessible and is retained only as background, not evidence of current runtime compatibility.

- [NSStatusItem](https://developer.apple.com/documentation/appkit/nsstatusitem), [NSWorkspace targeted URL opening](<https://developer.apple.com/documentation/appkit/nsworkspace/open(_:withapplicationat:configuration:completionhandler:)>), and [LSUIElement](https://developer.apple.com/documentation/bundleresources/information-property-list/lsuielement): standard menu-bar shell and explicit app launch.
- [AXUIElement](https://developer.apple.com/documentation/applicationservices/axuielement) and [AXIsProcessTrustedWithOptions](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions): optional accessibility client boundary.
- [Accessibility Programming Guide](https://developer.apple.com/library/archive/documentation/Accessibility/Conceptual/AccessibilityMacOSX/index.html): semantics depend on what the target application exposes, and accessibility requires practical testing.
- [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution): signing/hardened-runtime and owner distribution work.
