# gpt-handoff

A macOS menu-bar ChatGPT panel with one extra button. **Add** puts the conversation you have open into the message box of a window that is already open in another app, for example Claude. It never sends anything: the text lands in that app's draft and you decide what to do with it.

It replaces copying each turn by hand, joining them, switching windows and pasting.

## How it works

- **The panel.** Click the menu-bar icon and ChatGPT opens in a panel under it. It is the full website in an embedded WebKit view with its own persistent login: you sign in once, and the login survives restarts. Clicking elsewhere only hides the panel, so a reply keeps streaming and the page stays where it was. Uploads, downloads and sign-in popups work in the panel; other links open in your default browser.
- **The handoff bar.** Under the chat, a thin bar shows the open conversation (turns, files, Verified or Partial), a picker of open windows, and **Add**.
  - A page observer watches only the conversation data the page loads by itself. It makes no extra requests and never reloads.
  - A compiler in an isolated script world turns that data into Markdown: each turn in order, with its role, the original Markdown, source locators and file references.
  - The observer hands the compiler a private channel before any page script runs. Page scripts therefore cannot post into it, cannot see the compiler, and cannot reach the app. The app still trusts chatgpt.com itself: "Verified" means the data is internally consistent, not that it is authentic.
- **Add.** Add writes the Markdown at the end of the chosen window's message box through Accessibility, in the background, and reads it back to confirm. Nothing is raised, activated, pasted or typed, and your existing draft, formatting and attachments are kept.

Nothing is stored apart from WebKit's own login data. The prepared conversation lives in memory only. File references are not file contents.

## Build and set up

You need macOS 14 or later, the Xcode command-line tools, and Node.js 24 or later.

```bash
npm ci
```

```bash
bash scripts/build-macos.sh
```

```bash
open dist/gpt-handoff.app
```

1. Sign in to ChatGPT in the panel.
2. Choose **Allow Accessibility…** in the bar, and turn on gpt-handoff in System Settings. A rebuilt unsigned app may need this again.

To use it, click into the target app's message box once, so that box has focus. Then choose that window in the bar and click **Add**.

## Tests

```bash
npm test
```

```bash
CHROMIUM_PATH='<Chrome for Testing binary>' npm run test:browser
```

```bash
npm run test:native
```

- `npm test` runs the model, adapters, compiler, page observer and the bundled bridge.
- `test:browser` runs the page observer in a real browser.
- `test:native` runs the real chat controller in a real `WKWebView`, then the real Accessibility checks against a synthetic app. The Accessibility part reports NOT RUN unless the terminal has Accessibility access.

[docs/support-matrix.md](docs/support-matrix.md) records what has actually been verified and what has not.
