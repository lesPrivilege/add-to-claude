# macOS menu-bar app

This is the optional menu-bar app for gpt-handoff's local transfer desk. **The source has not been compiled or exercised on macOS.** The Linux VM cannot verify AppKit, Accessibility permissions, native focus behavior, signing, or notarization. The utility does not install or run an agent.

The menu opens ChatGPT in the installed Google Chrome app, opens the local transfer desk, discovers running app windows, and offers an explicit append of text copied from the desk. Chrome controls whether opening the URL reuses a tab. Existing conversation-tab discovery and exact focusing are provided by the optional [Chrome extension](../docs/browser-extension.md), not this menu action. The launcher does not enumerate Chrome tabs or request Apple Events/Automation access. Activating Chrome alone would not establish that its current tab is ChatGPT, so the action truthfully opens the fixed ChatGPT URL instead.

## Local build

Requirements: macOS 13 or later, an already-installed Node.js 24 or newer, Google Chrome, and Xcode command-line tools. No installer or build step downloads a runtime or accepts a license. If Xcode asks for a license, the owner must resolve it before building.

From the repository root, use the absolute path of the Node executable you already trust:

```sh
npm ci
npm test
npm run test:e2e
npm run build
bash scripts/build-macos.sh /opt/homebrew/bin/node
open 'dist/gpt-handoff.app'
```

Use `/usr/local/bin/node` or another installed path if appropriate. The script builds for the current Mac architecture and stores that path in the bundle's `Runtime.plist`. It does not embed Node or produce a portable installer. Moving or removing that Node executable requires rebuilding. Move an earlier `.app` aside before rebuilding. The result is unsigned and intended for local acceptance checks; it is not a signed distributable release.

`Info.plist` sets `LSUIElement`, so the launcher lives in the menu bar. The app bundle includes only `src/`, `web/`, and package metadata. Server launch uses Foundation `Process` with fixed arguments and a small environment, never a shell. No transcript is passed as a process argument. Output is discarded rather than retained in logs.

## Use

1. Choose **Open transfer desk**. The launcher checks `http://127.0.0.1:43119/health`. It launches its bundled server only when no service accepts the connection. A server it starts must return the same random `ADD_IT_NATIVE_INSTANCE` marker before the desk opens. An already-running desk must return the exact app/protocol marker; this is a compatibility check, not authentication against other software running as the same user.
2. Capture the selected conversation with the Chrome extension, import an export, or manually prepare it in the transfer desk, then copy it. Copying alone does not insert text anywhere.
3. In the target app, focus the intended composer. Choose **Enable composer access…** only if native append is wanted; macOS controls the Accessibility grant. Then choose the app and exact window under **Choose composer window…**. Other running apps appear automatically, so an unknown client can be selected without a plugin or a persistent registration. No choice survives quit.
4. Choose **Append copied text…**, check the app/window title, confirm that the selected text area is the intended composer, then choose **Append text**. Cancel leaves the target untouched. Success says **Text appended and verified** only after exact readback. Review the draft and attach downloaded files manually. Send remains the user's action.

Discovery reads app names and window titles only while the menu is opened after Accessibility access has been granted. It does not read target editor contents until the explicit append action. Discovery is asynchronous, bounded to 80 apps and 30 windows per app, and refreshed whenever the menu opens. Every accessibility attribute read applies a 150 ms messaging timeout, including fresh app elements used for main-thread validation. Window titles and target selections remain in memory.

The native path requires a readable, writable `AXTextArea`. It rejects single-line text fields, known terminal hosts, and text areas whose accessibility names identify terminal, shell, or code panes. That is deliberately narrow: many browser/Electron/editor composers do not expose a writable accessibility value and therefore need manual paste. The user confirms composer identity because accessibility roles cannot prove the business purpose of every text area. Unknown apps are not declared compatible merely because they appear in the picker.

Before insertion the app rechecks process identity and launch time, live window identity and title, frontmost app, focused window, focused editor identity, writable role, and clipboard change counter. It appends to the latest readable plain-text value, caps the resulting plain text at 2 MiB, then compares readback exactly. It emits no keyboard events, never presses Return, never opens a terminal, and never handles an attachment as executable input. If readback fails, the UI asks the user to inspect the draft before retrying because some text may already have changed.

Exact string readback does not verify attachment chips or rich spans already in a third-party composer. Those hosts require explicit native acceptance before claiming draft preservation; the native test fixture uses plain text.

## Uninstall and privacy

Quit from the menu to terminate only the server process this launcher started. An independently started server is left running. Remove the `.app` bundle. Revoke this app under System Settings → Privacy & Security → Accessibility if access was granted. No login item, daemon, account, runtime, credential, transcript archive, or registration file is installed. Clipboard text remains on the system clipboard until the user or another app replaces it; the launcher does not silently clear unrelated clipboard contents.

## Native acceptance checks — not yet executed

Use only synthetic text. The included test composer gives the owner a local AppKit target; it does not contact an agent or submit anything:

```sh
bash native/build-test-composer.sh
open 'dist/gpt-handoff test composer.app'
```

- Build and launch both apps on the intended macOS version and CPU architecture. Verify menu accessibility with VoiceOver, keyboard-only operation, light/dark appearance, enlarged text, and Reduce Motion. The menu contains no custom animation.
- Open Chrome and the desk; verify missing Chrome, missing Node, slow startup, occupied port, wrong health marker, and mismatched native instance. Quit and verify the child exits. An external server must survive launcher quit.
- With Accessibility denied, verify discovery/append are unavailable and ordinary Chrome/desk opening works. Grant explicitly; revoke while an editor is selected and verify append fails closed. No Automation or screen-recording grant should be requested.
- Focus Composer A, select it, and append synthetic Markdown, Unicode, links, and a long payload. Verify exact text and preservation of the initial draft. A clipboard over 2 MiB must be rejected. Attachments must remain a separate manual step.
- Select Composer A with Composer B also open; confirm the title and inspect that only A changes. Change title, close the selected window, restart the target app, or replace the editor after selection; verify the selection is rejected. Selecting a read-only editor or a known terminal host must fail.
- Cancel confirmation and verify no change. Change the clipboard while confirmation is open and verify rejection. Switch focus during the post-confirmation delay and verify rejection. Test a host that rejects `AXValue` or changes the value during write; the app must report unverified insertion and require inspection rather than retrying automatically.
- Test a same-title conversation switch that reuses its editor, and preexisting target attachment chips/rich spans. AX string equality alone cannot verify conversation identity or rich state preservation.
- Exercise every real client to be claimed supported; record app/macOS versions and exact checks in `docs/support-matrix.md`. The common path has no native client certification yet.

For distribution, the owner must choose an existing Developer ID identity, sign with the hardened runtime, perform these checks again under the signed identity, notarize using an already-authorized account/profile, staple, and test Gatekeeper on a clean Mac. No new credential, Apple account agreement, signing identity, or permission was created for this project. No sandbox entitlement is claimed: the optional Accessibility client and explicitly configured external Node runtime require separate review before a store/sandbox distribution path.

## Platform sources

Reviewed 2026-10-12. Current Apple documentation pages are linked below; their full JavaScript/Markdown render was not retrievable in the VM, so the native API usage still requires compilation against the installed macOS SDK. The archived guide was accessible and is retained only as background, not evidence of current runtime compatibility.

- [NSStatusItem](https://developer.apple.com/documentation/appkit/nsstatusitem), [NSWorkspace targeted URL opening](<https://developer.apple.com/documentation/appkit/nsworkspace/open(_:withapplicationat:configuration:completionhandler:)>), and [LSUIElement](https://developer.apple.com/documentation/bundleresources/information-property-list/lsuielement): standard menu-bar shell and explicit app launch.
- [AXUIElement](https://developer.apple.com/documentation/applicationservices/axuielement) and [AXIsProcessTrustedWithOptions](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions): optional accessibility client boundary.
- [Accessibility Programming Guide](https://developer.apple.com/library/archive/documentation/Accessibility/Conceptual/AccessibilityMacOSX/index.html): semantics depend on what the target application exposes, and accessibility requires practical testing.
- [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution): signing/hardened-runtime and owner distribution work.
