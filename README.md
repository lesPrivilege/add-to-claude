# gpt-handoff

A macOS menu-bar utility that adds the ChatGPT conversation you are viewing in Chrome to a message box that is already open in another app, for example Claude. It never sends anything: the text lands in that app's draft and you decide what to do with it.

It replaces copying each turn by hand, joining them, switching windows and pasting.

## How it works

1. **Chrome extension.** On chatgpt.com it observes the conversation data the page loads by itself. It makes no extra requests and never reloads the page. It follows the ChatGPT tab you last looked at and keeps only that tab's prepared Markdown, in memory.
2. **Relay.** Chrome starts the bundled `gpt-handoff-host` through native messaging. The relay only copies frames between Chrome and the running app, over a private socket in your temporary folder.
3. **Menu-bar app.** Click the icon to open a small popover. It shows the current conversation (turns, files, Verified or Partial), lets you pick an open window, and has one **Add** button. Add asks the extension for the exact text, writes it at the end of that window's message box through Accessibility, and reads it back to confirm.

Nothing is raised, activated, pasted or typed. The target window stays where it is, and your existing draft, formatting and attachments are kept. The popover hands focus back when it closes.

The Markdown keeps each turn in order with its role, the original Markdown, source locators and file references. File references are not file contents.

## Build and set up

You need macOS 14 or later, the Xcode command-line tools, Node.js 24 or later, and Google Chrome.

```bash
npm ci
```

```bash
bash scripts/build-macos.sh
```

1. Open `dist/gpt-handoff.app`. Its icon appears in the menu bar.
2. In the popover, choose **Set up Chrome…**. This registers the relay with Chrome and shows the extension folder. In Chrome, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and pick that folder.
3. Reload any ChatGPT tab that was already open.
4. Choose **Allow Accessibility…** and turn on gpt-handoff in System Settings. A rebuilt unsigned app may need this again.

To use it, click into the target app's message box once so that box has focus. Then open the popover, choose that window and click **Add**.

## Tests

```bash
npm test
```

```bash
CHROMIUM_PATH='<Chrome for Testing binary>' npm run test:browser
```

```bash
EXTENSION_CHROMIUM_PATH='<Chrome for Testing binary>' npm run test:chrome
```

```bash
npm run test:native
```

- `npm test` runs the model, adapters, page observer and extension logic.
- `test:browser` runs the page observer in a real browser.
- `test:chrome` loads the built extension into Chrome for Testing with the real compiled relay. The app is replaced by a socket stand-in. Branded Chrome ignores `--load-extension`.
- `test:native` checks the relay and app link, then runs the real Accessibility checks against a synthetic app. The Accessibility part reports NOT RUN unless the terminal has Accessibility access.

[docs/support-matrix.md](docs/support-matrix.md) records what has actually been verified and what has not.
