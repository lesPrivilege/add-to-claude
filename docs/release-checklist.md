# Release checklist

How to cut a release candidate and a release, drawn from how 0.6.0 was made. Replace `X.Y.Z`, `N` (the candidate) and `B` (the build number) throughout. Record what ran, what did not, and what the owner saw, separately, in [support-matrix.md](support-matrix.md).

## Gates

A release goes out only when each line is checked or carries an explicit owner decision.

- [ ] `npm test`, `npm run test:browser` and `npm run test:native` pass on the release code. The Accessibility half of `test:native` reports NOT RUN unless the terminal has Accessibility; run it from one that does (the owner's terminal) whenever `native/Composer.swift` changed since the last run.
- [ ] `npx prettier --check .` passes.
- [ ] An independent review of everything since the last release, covering security, behaviour and the rendered UI. Each finding is fixed with a test or declined with a reason.
- [ ] The owner's run on the candidate build with a real ChatGPT account (see [On the owner's Mac](#on-the-owners-mac)). Lines that are not run are recorded as not run, with the reason.
- [ ] No runtime npm dependency; no telemetry, history archive or credential collection; the delivery log and diagnostics hold no message text. The page's session token stays in the page.
- [ ] The terms statement in the README and the release notes still says what the app reads and through which session.
- [ ] Signing: the build is signed with the stable identity, so an update keeps the Accessibility grant. **A public release** also needs Developer ID signing, hardened runtime, notarization and a Gatekeeper launch without Open Anyway; until then a release is a private technical beta marked as a pre-release.
- [ ] Updates: `native/Info.plist` carries the project's `SUPublicEDKey` (the build refuses without one) and a build number above the last release's. The previous release, installed, finds and installs this one through **Check for Updates…** (from 0.8.0 on). For a release that changes the updater (0.8.0 first of all), also prove it can update _away_: install the candidate, build a throwaway next build (B+1) signed the same way, serve it and a feed for it from `localhost` (`python3 -m http.server` in a folder holding the zip and an `appcast.xml` written like `scripts/appcast.sh` writes it), point the candidate at it with `defaults write io.lesprivilege.add-to-claude SUFeedURL http://localhost:8000/appcast.xml`, check for updates, quit, and see B+1 open with the Accessibility grant kept. Then `defaults delete io.lesprivilege.add-to-claude SUFeedURL`.
- [ ] [support-matrix.md](support-matrix.md), the README (both languages) and the release notes describe this version.

## On the owner's Mac

Use throwaway conversations. Mark each line PASS, FAIL, BLOCKED or NOT RUN. Items with no owner result for 0.6.0 are marked ◦.

- Start: launch from the new location; still signed in; Accessibility still allowed; open at login off and on ◦.
- Keys: global shortcut, click-away, pin, Esc, ⌘W, ⌘R, ⌘, ◦.
- Reading: several old conversations in turn; a long paged one; a branched turn ◦; one with cards, entities or citations ◦; a reply in progress keeps Add off.
- Writing: an empty Claude draft; a non-empty draft with the caret in the middle ◦; a second app such as TextEdit ◦; the same scope twice ◦; Choose turns… with a gap ◦; New after replying in ChatGPT; a switch between Claude conversations in one window ◦.
- Files: an uploaded PDF or text file, an image, and two same-name generated files; each saved once, with its own path and SHA-256.
- Terminals, in Terminal and one other terminal app: Add copies the line and brings the window forward; ⌘V into a tab running Claude Code and one running Codex (nothing runs; the agent reads the file on send); ⌘V at a shell prompt (an unexecuted line); Copy Again copies the line and keeps the question open; a minimized terminal window comes back; one conversation added to two terminal windows gets two files; drag across turns in Choose turns…, also sideways out of the popover; Clear History removes the hand-off files.
- Failure: Accessibility revoked mid-session (E09) ◦; network lost during a download (E10) ◦; the target window closed before Add (E16).
- Appearance: dark appearance and VoiceOver over the bar, Files popover, turn picker and Settings ◦.
- Storage: Clear and Reload keeps the sign-in ◦; Clear History ◦; the delivery log holds no message text and no account id.
- Endurance, over a day of normal use: long sessions, many shows and Adds, sleep and wake, peak memory from Activity Monitor ◦.
- Afterwards: Settings → Storage & Diagnostics → Export… and keep the file with the results.

## Cut a release candidate

1. Bump the version: `version` in `package.json`, and `CFBundleShortVersionString` (X.Y.Z) and `CFBundleVersion` (B, one more than the last build) in `native/Info.plist`. Commit as "Version X.Y.Z (release candidate N, build B)".
2. Run the suites on that commit after a clean `npm ci`.
3. Tag it: `git tag -a vX.Y.Z-rc.N -m "Add to Claude X.Y.Z release candidate N"`.
4. Build into a fresh folder (the script refuses to overwrite) and check the signature:

   ```bash
   bash scripts/build-macos.sh "$PWD/dist/rc-N/Add to Claude.app"
   codesign --verify --strict "dist/rc-N/Add to Claude.app"
   codesign -dv "dist/rc-N/Add to Claude.app"   # Authority=add-to-claude Local
   spctl -a -vv "dist/rc-N/Add to Claude.app"   # rejected until Developer ID and notarization
   ```

   The build signs with "add-to-claude Local" when that identity is in the login keychain (`bash scripts/make-signing-identity.sh` creates it, once per Mac), and ad-hoc otherwise. Do not ship an ad-hoc build: it loses the Accessibility grant on every update.

5. Archive and checksum:

   ```bash
   ditto -c -k --keepParent "dist/rc-N/Add to Claude.app" dist/rc-N/add-to-claude-X.Y.Z-rc.N.zip
   shasum -a 256 dist/rc-N/add-to-claude-X.Y.Z-rc.N.zip
   ```

6. Record the candidate's evidence (suites, bundle id, build, signature, archive SHA-256, Gatekeeper) and hand the build to the owner for the run above. `dist/` is not committed.

## Publish the release

1. Write the release notes in `docs/release/X.Y.Z.md`: what is new, install steps with the archive's SHA-256, known limits, the terms statement, and the evidence. Link evidence files by paths that exist at the release tag.
2. Build the release archive from the final commit as in steps 4–5, as `dist/release/add-to-claude-X.Y.Z.zip`, and put its SHA-256 into the notes. Commit.
3. Tag the commit that carries the notes and push the branch and the tag:

   ```bash
   git tag -a vX.Y.Z -m "Add to Claude X.Y.Z"
   git push origin main vX.Y.Z
   ```

4. Create the GitHub release. Use `--prerelease` while the build is not notarized:

   ```bash
   gh release create vX.Y.Z dist/release/add-to-claude-X.Y.Z.zip \
     --title "Add to Claude X.Y.Z" --notes-file docs/release/X.Y.Z.md --prerelease
   ```

5. Download the asset from the release page, compare its SHA-256 with the notes, unpack it and run `codesign --verify --strict` on the app.
6. Publish the update feed, only now that the asset is downloadable. On the owner's Mac (`sign_update` reads the EdDSA key from the login keychain, created once with `vendor/Sparkle/bin/generate_keys`):

   ```bash
   bash scripts/appcast.sh "$PWD/dist/release/add-to-claude-X.Y.Z.zip"
   git commit -m "Update feed for X.Y.Z" appcast.xml
   git push origin main
   ```

   Installed copies find it on their next daily check. Keep the private key backed up (`generate_keys -x`); without it no later update can reach them.

7. Afterwards, move the candidates' evidence to `docs/archive/release-X.Y.Z/`, fix the notes' relative links, and update [support-matrix.md](support-matrix.md).
