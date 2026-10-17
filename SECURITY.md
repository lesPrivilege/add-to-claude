# Security

## Reporting a problem

Please report a vulnerability privately, through GitHub's **Report a vulnerability** on the repository's Security tab, not in a public issue or pull request. Include what an attacker controls, what they gain, and the steps to see it; a synthetic page or fixture is better than a real conversation.

You can expect an acknowledgement within a week. A fix goes into the next release, and the release notes credit you unless you ask otherwise.

## What counts

The app sits between a signed-in ChatGPT page and other apps' text boxes, so these matter most:

- text from a conversation that is run, sent, or rendered as active content instead of being written as plain text;
- the app sending, submitting or pressing Return in a target app;
- the page's session token, cookies or account id reaching the native app, the disk, a file name or the hand-off text;
- a page or file that makes the app download from a host other than the one it asked, write outside the chosen folder, or overwrite a file it did not save;
- message text reaching the delivery log, saved-files record or diagnostics;
- a way for a web page other than ChatGPT's to talk to the bridge.

## Supported versions

Only the latest release is supported. Releases are private technical betas: signed with the author's own certificate, not with a Developer ID, and not notarized.
