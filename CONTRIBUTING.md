# Contributing

Thank you for helping. Add to Claude is small on purpose; a change is easiest to accept when it is small too.

## The rules a change must keep

These are the project's boundaries. A pull request that crosses one is declined, however useful it is otherwise.

- **Never send.** The app writes into a composer and stops. It never presses Return, clicks Send, or runs what it wrote.
- **Nothing leaves the Mac.** No telemetry, no server of its own, no transcript service, no credential collection.
- **No archive.** Conversations are read only when the user asks, held in memory, and dropped. The delivery log and diagnostics never hold message text or account ids.
- **Text is data.** Conversation text is never run as a shell command or rendered as executable HTML. Boundaries validate callers, origins, sizes, file names and the target.
- **Synthetic fixtures only.** Tests and fixtures are written by hand. Never commit a real conversation, a HAR, a cookie, a token or a screenshot of a real account.
- **No runtime npm dependency.** Node.js builds the page scripts and runs the tests; the app ships without it. Development dependencies stay few and locked.
- **No compatibility layers.** When a shape changes, the old path is removed rather than kept beside the new one.

Why these exist, and the decisions behind the less obvious behaviour (cards read as plain text, reading is passive), are in [docs/roadmap.md](docs/roadmap.md) and [docs/decisions/](docs/decisions/). A change to the hand-off text follows [docs/handoff-format.md](docs/handoff-format.md); a change at a trust boundary updates [docs/threat-model.md](docs/threat-model.md).

## Setting up

You need macOS 14 or later, the Xcode command-line tools and Node.js 24 or later.

```bash
npm ci
```

```bash
bash scripts/build-macos.sh
```

The README's [Build and set up](README.md#build-and-set-up) covers signing in, Accessibility and a stable signing identity.

## Checks

Run what your change touches; run all of them before asking for a review.

```bash
npm test
```

```bash
npm run test:native
```

```bash
CHROMIUM_PATH='<Chrome for Testing binary>' npm run test:browser
```

```bash
npx prettier --check .
```

- The Accessibility half of `test:native` reports NOT RUN unless your terminal has Accessibility access. Say so in the pull request rather than leaving it out.
- A change to what the compiler sends the app regenerates the shared fixture (`node scripts/make-bridge-fixture.js`); review its diff, since the WebKit suite reads it too.
- A change to how ChatGPT's data is read comes with a synthetic fixture for the new shape, and says which real case it stands for, in words, without pasting the real one.

## A pull request

- One concern per pull request, with the cause it fixes stated, not only the symptom.
- Say which checks ran, which did not, and anything you saw on a real Mac, separately. "Not run" is a fine answer; a guess is not.
- Keep the code's own style: plain ES modules in `src/`, Swift and AppKit in `native/`, comments only where the reason is not obvious.
- Update the README (both languages) or `docs/` when behaviour a user can see changes.

Security problems go through [SECURITY.md](SECURITY.md), not a public issue.

By contributing you agree that your contribution is released under the project's [MIT License](LICENSE).
