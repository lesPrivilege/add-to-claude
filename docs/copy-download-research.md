# Copy and download boundaries

Checked 2026-10-12. This follow-up evaluates ordinary browser APIs for the selected-conversation collector. It does not change the terms finding in [research.md](research.md), and does not establish live ChatGPT or installed-extension compatibility. The VM's managed browser extension-loading restriction remains in force.

## Original Markdown through a turn's Copy action

A content script can find an exposed button and call `click()`, and it can interact with the shared DOM. It cannot directly read the page's private JavaScript state from its [isolated world](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts). Calling `click()` may run the page handler, but does not create a trusted input event or promise that the site's clipboard write will be permitted. [HTML's activation model](https://html.spec.whatwg.org/multipage/interaction.html#tracking-user-activation) distinguishes trusted activation-triggering input from scripted events.

Chrome's [`clipboardRead` permission](https://developer.chrome.com/docs/extensions/reference/permissions-list) allows clipboard reads and displays a broad clipboard-access warning. An [offscreen document](https://developer.chrome.com/docs/extensions/reference/api/offscreen) can provide a DOM context for clipboard work where the service worker cannot. Neither API binds the read to a particular page, button, message ID, or clipboard write. Reading after a Copy action is technically possible in some environments; it is not an atomic request/response operation with that turn.

The [Clipboard specification](https://www.w3.org/TR/clipboard-apis/) separates clipboard events and asynchronous reads/writes. Synthetic clipboard events do not expose the system clipboard. A `clipboardchange` notification, where available, identifies a clipboard change rather than its source turn; change notifications can be coalesced. Feature detection does not provide provenance. A timing window, two equal reads, or an unchanged change ID cannot identify who wrote the value. Comparing the captured result to visible text can detect some mismatches, but does not establish original Markdown or missing content.

Further practical constraints:

- A site can implement Copy with `navigator.clipboard.writeText()` without firing a DOM `copy` event. Listening for `copy` alone is not a general capture mechanism.
- A button's accessible label or “Copied” toast is not a documented Markdown contract. Its output may normalize Markdown, omit citation metadata, or include only a code block. No official source reviewed promises that ChatGPT's turn Copy action returns the exact stored Markdown.
- Other tabs, apps, clipboard managers, or the user can replace the clipboard between write and read. Reading the replacement can accidentally collect unrelated data. A previous-clipboard backup also reads unrelated content; restoring it can overwrite a newer user copy and lose unsupported formats.
- Main-world monkey-patching of the site's clipboard API would create a different interception architecture and still depend on site internals. It is excluded here. Do not harvest credentials or call private endpoints to fill the gap.

**Smallest useful path:** ship the bounded selected-tab collector with explicit `reconstructed` text provenance. Preserve original Markdown from a user-provided structured export when available. Do not add a silent per-turn Copy/read loop or a background clipboard listener. If a later optional Copy enrichment is built, make it a short explicitly invoked review operation; label it `site-copy / source-unverified`, verify the intended turn in the preview, and require review before incorporating it. A page Copy action alone must never upgrade conversation completeness or original-Markdown verification.

### Synthetic browser evidence

A transient loopback fixture was exercised in real headless **Chromium 151.0.7922.173**, using Playwright and clipboard read/write permissions granted only to the disposable test context. No private content, extension, external account, browser policy change, or persistent permission was involved.

| Probe                                                                       | Observed result                                                                                                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trusted browser click on a fixture button whose handler calls `writeText()` | Synthetic Markdown was written; `click.isTrusted === true`; zero DOM `copy` events.                                                                                 |
| `button.click()` on the same fixture                                        | Handler ran with `click.isTrusted === false`; zero DOM `copy` events. The fixture had clipboard permissions, so this is not evidence that all scripted clicks fail. |
| Another fixture tab writes a different value before the first tab reads     | The first tab read the replacement value. No API result associated it with the original turn.                                                                       |

Reproduce the mechanism with a local page containing the following script. Exercise a browser click and `document.querySelector('button').click()` separately, then write a different synthetic value in a second tab before reading in the first. Grant permissions only in an isolated test context; do not test using real clipboard contents.

```html
<button>Copy turn</button>
<script>
  window.copyEvents = 0;
  document.addEventListener('copy', () => window.copyEvents++);
  document.querySelector('button').addEventListener('click', async (event) => {
    window.lastClickTrusted = event.isTrusted;
    await navigator.clipboard.writeText('# Synthetic Markdown\n\n**original**');
    window.lastCopyDone = true;
  });
</script>
```

This tests web clipboard behavior only. It does not establish extension offscreen behavior, ChatGPT's Copy implementation, gesture propagation into the page, or original-Markdown fidelity.

## Download initiation is separate from byte access

[`chrome.downloads`](https://developer.chrome.com/docs/extensions/reference/api/downloads) supports authorized browser downloads, status events, and metadata. An HTTP(S) download uses the browser's normal cookies for that host without exposing those cookies to the extension. The returned ID can bind an extension-initiated download to the selected attachment. The API exposes final filename, MIME type, size, URL, and completion/danger state; it exposes neither a byte-reading method nor a content hash. Its absolute filename is metadata, not filesystem read authority. Existence information can also be stale.

When an exposed attachment is an ordinary downloadable HTTP(S) URL, a bounded user-requested batch may use the normal download API. If it requires the page's own handler, a POST flow, or a freshly generated link, use that visible source action instead of guessing an endpoint. Do not assume that the next `onCreated` event belongs to the selected attachment: page-initiated downloads lack the returned operation ID, and simultaneous downloads can be ambiguous. Retain an unresolved association when URL/referrer/time evidence is insufficient. Do not collect global download history to compensate.

**Smallest useful attachment flow:** download the selected available attachments as a bounded batch, monitor completion, then offer one **Choose downloaded files** multi-file picker. This replaces repeated downloads/selections with one batch and one selection without ongoing filesystem access. A regular `<input type="file" multiple>` is sufficient. The [File API](https://w3c.github.io/FileAPI/) supplies the selected bytes; calculate a local [SHA-256 digest](https://w3c.github.io/webcrypto/#SubtleCrypto-method-digest) and retain it with the exact bytes accepted by the transfer.

Match a selected file against the tracked **actual final filename** and completed post-decompression size, not a proposed name or network transfer length. Use a generated per-transfer prefix/subdirectory when the extension initiates a download to reduce collisions; account for Chrome renaming conflicts. Reject duplicate/ambiguous matches, unknown size, incomplete/interrupted downloads, oversized files, and disallowed executable types. Keep each artifact's original locator and imported display name separate from the generated download name. Never run or open a downloaded file automatically.

Filename plus size is an association check, not cryptographic source verification. Two files can share both. A hash computed after selection establishes the accepted bytes and supports transfer integrity, but Chrome supplies no independent expected hash to compare with. Store facts separately, for example `download: complete`, `association: user-selected-name-size-match`, and `bytes: sha256-recorded`. Do not label this `source-bytes-verified` unless a trusted independent digest actually exists. If the source's expired/inaccessible file cannot download, retain its locator and show the normal reopen/regenerate action.

## Shipped scope

Version 0.3.0 implements sequential explicit **Download** actions for exposed passive HTTPS URLs, Chrome’s normal folder and conflict renaming, exact returned-ID monitoring, and one multi-file picker in the desk. It stores only `download: { name, size }` as a matching hint; the original attachment status stays `download-needed` until bytes are selected. It does not implement a batch button, generated subfolders, a directory picker or clipboard interception. Unknown metadata retains the manual source/file-selection path. Popup closure and worker suspension are explicit acceptance limits. The broader options above are research, not claims of shipped behavior.

## Optional session folder flow

For many attachments, a user may explicitly choose a dedicated transfer folder once with [`showDirectoryPicker({ mode: 'read' })`](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access). Retain the handle in memory, read only the exact expected completed filenames, and discard it on cancel/finish. Do not enumerate the whole folder, recurse, store handles in IndexedDB, or request write access. The directory must be chosen by the user; an absolute path from downloads cannot be converted into a handle. A dedicated folder is narrower than granting access to the user's whole Downloads directory.

This is an optional convenience, not necessary for the first release. The [File System Access specification](https://wicg.github.io/file-system-access/) requires an appropriate user action for pickers; waiting for downloads before opening one can outlive transient activation, so show a fresh button. Chrome [supports persistent permission choices](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api); do not promise that merely dropping a JavaScript handle revokes a browser-granted permission. Avoid persistence, do not ask users to choose “Allow on every visit,” and provide the browser's revoke-access location if a permission was retained. This browser-managed folder path has not been executed in this research pass.

## Focused regression cases

For any implemented enrichment, use synthetic fixtures covering delayed Copy writes, zero `copy` events, a concurrent clipboard writer, identical successive turns, Copy failure, navigation/branch changes, and cancellation. For downloads, cover two files with identical names/sizes, Chrome's renamed filename, unrelated simultaneous downloads, interruption, permission denial, deleted/changed files, unknown size, path separators, and hash mismatch after bridge transfer. Never promote an ambiguous association or a partial scroll result to complete/verified simply because the happy-path fixture passes.
