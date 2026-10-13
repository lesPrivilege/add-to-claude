# Chrome chat handoff

The primary path uses the owner's existing signed-in Chrome ChatGPT app. Handoff's small controls live in Chrome's extension popup at the window edge. Normal capture/Add opens no local desk, initiates no conversation request and forces no refresh. The status-bar launcher opens or hides the existing Chrome chat app. The earlier WebKit/portable desk remains an explicit legacy tool, not the required login path.

## Build and install for local acceptance

```sh
npm run build:extension
bash scripts/build-macos.sh /opt/homebrew/bin/node /absolute/output/gpt-handoff-chrome.app
python3 scripts/install-native-host.py --check /absolute/output/gpt-handoff-chrome.app
```

The app bundles the unpacked extension at `Contents/Resources/extension` and the native helper at `Contents/MacOS/gpt-handoff-host`. The check command verifies that the actual binary accepts the exact extension origin and speaks the expected framed protocol; it changes no registration or permission. A CLI Accessibility result does not establish the result when Chrome launches the host.

After the owner approves the browser/native integration:

1. In `chrome://extensions`, use Developer mode → **Load unpacked** and select the app's `Contents/Resources/extension` folder. Use the normal Chrome UI; do not change managed policy or use `--load-extension` on branded Chrome.
2. Register the built helper for this one extension identity:

   ```sh
   python3 /absolute/output/gpt-handoff-chrome.app/Contents/Resources/install-native-host.py /absolute/output/gpt-handoff-chrome.app
   ```

   Registration is only `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/io.lesprivilege.gpt_handoff.json`. The installer first probes the actual executable and refuses to overwrite a different registration. Stable development extension ID: `hgaehbodpgfglgbbomlimgkekhapnjph`. No private signing key is stored.

3. Open the already-installed Chrome ChatGPT app. On this Mac, Chrome's **Cast, save, and share → Open in ChatGPT** reuses the existing login. Pin Handoff's extension button in that app window.
4. Open Handoff's popup and choose **Use this Chrome chat window**. Approve the requested ChatGPT host access. Only this selected top-level tab/document is activated; bootstrap scripts in other tabs remain dormant. Open the desired conversation normally to observe its original data. Enabling the reader cannot recover responses that finished before it was installed.
5. **Preview** shows complete prepared Markdown and explicit gaps. **Choose composer** discovers real running windows through the native helper. Focus the intended composer once, then select its exact window. If needed, explicitly grant Accessibility to the helper/app in System Settings; the UI does not accept that grant for the owner.
6. **Add** is enabled only for current verified context within the native size limit and a bound target. It appends to the latest readable draft, checks exact readback and never sends. The native helper asks Chrome to revalidate the operation's source revision/hash immediately before writing. A stale source, target change, missing permit, timeout or disconnect rejects insertion. An uncertain write must be inspected before retrying; there is no automatic retry.

The popup may close when the target app gains focus. Reopening it shows the last operation's receipt. **Save Markdown** exports the full projection as `context.md`; it does not attach files or claim their bytes are included. Native target attachment delivery remains unfinished. WebSocket replay remains explicitly partial until a normal authoritative response repairs its coverage.

## Permissions and retention

Primary required permissions are `activeTab`, `scripting`, `storage` and `nativeMessaging`. ChatGPT host access, legacy loopback access and download assistance remain optional. The primary manifest has no debugger permission and the legacy original/reload action is hidden and rejected. Only selected-tab/window metadata goes into `chrome.storage.session`; source content, target handles and operation state remain in memory. No cookies, passwords, browser profile files or global history are read.

Only the extension-owned popup can request native actions. The isolated page bridge carries bounded source packets only; webpage messages cannot invoke target selection or Add. The worker owns source receipt ordering, compilation, revisions and Add intent. The native process owns opaque target tokens backed by PID/launch/window/editor identity. Native messaging accepts the one exact extension origin, bounded length-framed JSON and a small fixed command set; it has no generic shell/path/URL execution command. A final source permit is short-lived and single-use. This is a bounded cross-process check, not an atomic transaction between Chrome and Accessibility.

Removing host access deactivates the selected reader. Closing the selected tab clears its state and disconnects the helper. Closing Chrome/its native port ends the helper. Quitting the status-bar launcher does not close the user's Chrome windows; helper lifetime follows the extension connection. To uninstall, remove the extension in Chrome, remove the exact native-host registration file above, and remove the app. Revoke its Accessibility access if granted. No daemon, login item or transcript archive is installed.

## Evidence and remaining gates

`npm run test:chrome` uses a real installed extension and real action-popup/source/scripting APIs in a temporary Chrome for Testing profile, with synthetic ChatGPT routes and pregranted hosts. On macOS, Chrome itself launches a native fixture executable over real `connectNative` pipes. It shares production framing, protocol, source-permit validation and AppKit process lifetime; only the composer backend is synthetic. The scenario verifies draft preservation, Unicode/Markdown, receipt recovery and native process exit after the selected tab closes. Its native-host manifest and executable stay under the disposable test directory; no owner-profile registration is changed. This proves the integrated transport, not AX insertion. `scripts/test-native-host.sh` separately tests actual framing and the permit state machine with a synthetic composer backend. The built helper also passes a real framed CLI ping/origin check.

`npm run test:extension` retains 13 legacy API-harness cases and ten installed legacy cases. Its fixture explicitly adds debugger permission and switches to the legacy popup; those capabilities are absent from the primary production manifest. Tests do not change managed Chrome policy. Owner-profile installation, normal permission prompts, real native target writes, live selected-source capture and native file delivery remain acceptance gates. See [Mac acceptance](mac-acceptance.md), [support matrix](support-matrix.md) and [release checklist](release-checklist.md).

The rendered primary popup is recorded in `artifacts/12-chrome-handoff-popup.png`. It contains only synthetic source/target information. Older screenshots depict the portable desk and API harness, not current browser/native integration.

## Legacy portable tools

**Setup & import tools** opens rendered-source collection and the existing export/desk flow. DOM captures remain unverified even when all rendered boundaries are observed. Download assistance uses Chrome's normal downloader and exact returned download IDs; completed names/sizes are hints until the user selects actual bytes in the desk, which computes SHA-256. The legacy desk can transfer to its controlled browser composer; those receipts are not real-client certification. Start the legacy workspace/server explicitly when using these tools.

The original-response debugger adapter remains in source for its existing tests/reference path, but it is not available in the primary build. It must not be silently substituted for passive capture because it deliberately reloads the source.
