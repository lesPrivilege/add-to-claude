# Decision log: incremental hand-off and turn selection

Work order: [WO-01](../workorders/WO-01-incremental-handoff.md). Decided by the owner (arbiter) on 2026-10-16; implemented on branch `feat/handoff-incremental-log`. Each decision names the code and the test that hold it.

## 1. Which turns Add offers

- **New or unconfirmed target conversation → All.** A target counts as the same conversation only when it is verified (§2) or the user confirmed it for this window session.
- **Same source conversation + same verified (or confirmed) target + a successful insertion → "New since last add".** New means the turns after the **furthest position successfully inserted** into that target from that source. (Furthest rather than most recent: re-adding an early turn by hand must not make New resend everything after it.) It does not mean "every turn never added": a manual choice that skipped turns 5 and 7 does not bring them back by itself. The range detail says so instead: "2 earlier turns were never added".
- **"Choose turns…" overrides for one Add.** The choice is not saved. It returns to Auto after an Add lands, and whenever the source conversation or the target changes.
- **Nothing new** shows "New · 0"; Add then asks "Add the last N turns again?" (re-adding the last batch is explicit).
- **The same scope, just added, unchanged** asks "Already added — Add again?" inline. It never inserts twice silently.
- Code: `analyzeScope`, `resolveScope` and `isAlreadyAdded` in `native/Delivery.swift`. Tests: `tests/native/DeliveryTests.swift` (the "WO" rows).

## 2. Target identity

- **Verified** only when the target window names its conversation: the URL of its `AXWebArea` (`AXURL`) or the window's `AXDocument` is `https://claude.ai/chat/<uuid> or https://claude.ai/epitaxy/local_<uuid>`. Several web areas naming different conversations count as none. The id is read when a window is chosen, each time the panel opens, and again right before writing. If it changed since the scope was worked out, Add stops with "The target conversation changed".
- **Never inferred** from the app, pid, window number, window title or paste history.
- **Otherwise:** the default is All. After a successful Add into such a window, the bar offers **Continue in this conversation**. It is visible, the user confirms it once per window session, and **Stop continuing** cancels it.
  - A window session lasts until the window closes, its app relaunches, or its title changes. A changed title only ever ends a binding; it never starts one.
  - Receipts for a window session stay in memory; they mean nothing after it ends.
- **What Claude for Mac exposes: unverified.** Claude for Mac is an Electron app. Add already sets `AXManualAccessibility` so its web content is exposed, and `native/Composer.swift` walks the window to find the prompt. Whether its `AXWebArea` carries `AXURL = https://claude.ai/chat/<uuid> or https://claude.ai/epitaxy/local_<uuid>` has not been observed: this work was done without driving Claude.
  - The owner can settle it with `bash scripts/probe-target-ax.sh` (read-only; the terminal needs Accessibility). Open two conversations, run the probe, switch conversations, and run it again.
  - **If the id shows and changes with the conversation:** incremental Add works as designed.
  - **If not:** every Add into Claude defaults to All, and New is available only through the explicit binding.
- Code: `targetConversationId` and `conversationIdentity` in `native/Composer.swift`; `identify`, `WindowSession` and `toggleBinding` in `native/Handoff.swift`.

## 3. Source identity and changed turns

- **Source:** the ChatGPT conversation id from the page URL (`/c/<id>`, `/g/<gpt>/c/<id>`). A new chat without an id has no history; it is always All and nothing is logged.
- **Turns:** each turn's message id plus `content_sha256`, the SHA-256 of the turn's projected body. The body is its role, Markdown, references and file lines, but not the numbered heading, so loading earlier turns does not change later hashes. The hash is computed in the shared compiler (`describeTurns` in `src/model.js`, `src/sha256.js`).
- **A turn added earlier whose hash now differs** is reported ("2 earlier turns changed since added"). It is left out of New and marked "changed" in the picker. The menu offers it through **New and changed** (shown only when there are changed turns) or Choose turns…; it is never re-sent silently.
- **A regenerated answer** has a new message id, so it is simply new.

## 4. Delivery log

- **States:** `prepared` → `insertion_attempted` → `composer_inserted` | `failed` | `unknown`. Only `composer_inserted` advances the cursor.
- **Inserted** means the text was read back from the draft.
  - When the draft changed but cannot be confirmed (for example, Claude's editor reformats pasted Markdown), the state is `unknown`. The bar says "Could not confirm" and asks: **It's There** moves it to `composer_inserted` (marked `confirmed_by_user`); **It's Not** moves it to `failed`. Nothing else moves an unknown receipt.
  - Receipts in `prepared` or `insertion_attempted` are not written to disk. An Add cut off by a quit or crash therefore leaves no receipt, and its turns count as not added, exactly as an `unknown` one would: the next Add offers them again. A receipt found in either state at launch (a file from an older build) becomes `unknown`.
- **Where it is kept:** in memory, plus `~/Library/Application Support/add-to-claude/delivery-log.json` (folder 0700, file 0600, from FileManager's application-support URL). Only finished receipts for **verified** targets are written.
- **What a record holds:** handoff id, source provider and conversation id, target app bundle id, target conversation id and confidence, mode, message ids with positions and hashes, file keys, state, times. **Never message text.**
- **Retention:** Settings → History.
  - "Remember what was added" (default on). Off removes the file and keeps receipts in memory only.
  - "Keep for" 7, 30 (default) or 90 days. Older receipts are pruned at launch and when the setting changes.
  - "Clear History…" asks, then forgets everything.
- **Bounds:** at most 2,000 receipts. A malformed file or record is dropped, never trusted.
- **Parallel targets:** each source × target pair has its own history. Several sources are never deduplicated against each other.

## 5. Projection of a subset

- **Where:** in the shared JS compiler, so every form uses one projection (`projectMarkdown(model, lines, { turnIds, note })`, `selectTurns`, `scopeLine` in `src/model.js`; `handoff()` in `src/compile.js`).
- **What a subset carries:** the chosen turns, in source order, keeping their numbers in the whole conversation; only their references and files; and only the content checks about them.
  - A check that names no turn or file (the conversation as a whole, e.g. "earlier turns were not loaded") always goes.
  - Files that belong to no turn go with every subset.
- **Verification:** a subset reads verified when nothing it carries needs a check.
- **Scope line,** under the Source line:
  - "Turns 15–21 of 42 · new since last add"
  - "Selected turns: 3, 5–9 of 42"
  - "Turn 4 of 12 · added again"
- **Choosing every turn gives exactly the whole text.**
- **Line numbers:** file and check line numbers are those of the subset text, so `linkFiles` points the right lines at local copies.
- **The bridge** keeps the last compiled model in its isolated world and exposes `addToClaudeProject(page, turns, note)`. It answers only when the page matches and every named turn still has the hash the app was shown.

## 6. Large conversations

The picker is an `NSTableView`, so thousands of turns scroll without building thousands of views. A subset larger than the 2 MiB composer limit fails with its size and "Choose fewer turns, or Save". It is never truncated.

## Not covered by automated tests

These need a real Claude (or another real app) and the owner's machine:

- Reading Claude's conversation id
- Paste confirmation in Claude
- Existing drafts
- Switching conversations in one window

See [support-matrix.md](../support-matrix.md).
