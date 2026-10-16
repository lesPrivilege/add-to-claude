<p align="center"><img src="artifacts/app-icon.png" width="128" alt=""></p>

<h1 align="center">Add to Claude</h1>

<p align="center"><b>Talk it through in chat. Finish it in your agent.</b><br>
Add to Claude Code, Codex and other agent harnesses, from your chat.</p>

<p align="center"><a href="#english">English</a> · <a href="#中文">中文</a></p>

---

## English

Add to Claude is a macOS menu-bar panel for ChatGPT with one extra button. **Add** puts the conversation you have open into the message box of an agent window that is already open, such as Claude, Claude Code or Codex. It never sends anything. The text lands in that app's draft, and you decide what happens next.

### Why

Early versions of Codex had a small ChatGPT window with an **Add to Codex** button. One click took the conversation you were having straight into Codex's composer. A later update removed it, but the need stayed.

A lot of work starts in a chat: exploring a problem, getting an independent review, weighing options. It then finishes in an agent harness. Carrying the conversation across still meant copying it turn by turn, joining the pieces, downloading the files and pasting.

Add to Claude brings the button back and widens it. The chat lives in a menu-bar panel. Add hands the whole conversation to whichever agent window you choose: every turn in order, in its original Markdown, with its references and files. The name says where most people send it; the button names where this one is going.

Today the source is ChatGPT. The destination can be any app with a text box.

### What it does

- **The panel.** Click the menu-bar icon and ChatGPT opens under it, with its own login that survives restarts. Hiding the panel keeps the page, so a reply keeps streaming. Unless you pin it, the panel hides when you click into another app.
- **The bar.** Under the chat, a thin bar shows the open conversation (turns, files, Verified or Partial), Preview, Copy and Save, the files list, a picker of open windows, and **Add to {app}**.
- **Add.**
  - Files first: the conversation's files are downloaded into a folder for that conversation.
  - Then the text: every turn, with its role, original Markdown, references and each file's local path and SHA-256, goes into the end of the chosen message box.
  - The target app is not brought forward, and nothing is sent.
- **Settings** (⌘,): open at login, show at launch, keep the panel open, a shortcut to show the panel, start with the last window, download files on Add, the files folder, Accessibility status, and sign out.

### Privacy

- It reads only the conversation the page has loaded.
- The prepared conversation is held in memory only.
- To get a file, it asks the page for the file's download link through the page's own session. The session token never leaves the page.
- What stays on disk: the panel's ChatGPT login (WebKit's own data), your settings, and the files you download, in the folder you choose.
- No telemetry, no history archive, no server of its own.

### Build and set up

You need macOS 14 or later, the Xcode command-line tools, and Node.js 24 or later.

```bash
npm ci
```

```bash
bash scripts/build-macos.sh
```

```bash
open dist/add-to-claude.app
```

1. Sign in to ChatGPT in the panel.
2. Choose **Allow…** in the bar, then turn on Add to Claude in System Settings → Privacy & Security → Accessibility. An unsigned rebuild needs this again.
3. Click once into the target app's message box, choose its window in the bar, and click **Add**.

### Tests

```bash
npm test
```

```bash
npm run test:native
```

```bash
CHROMIUM_PATH='<Chrome for Testing binary>' npm run test:browser
```

- `npm test` covers the model, the adapters, the compiler, the page observer and the bundled bridge.
- `test:native` runs the real chat controller in a real `WKWebView`, then the Accessibility checks against a synthetic app. The Accessibility checks report NOT RUN unless the terminal has Accessibility access.
- `test:browser` runs the page observer in a real browser.

[docs/support-matrix.md](docs/support-matrix.md) records what has been verified and what has not.

---

## 中文

Add to Claude 是一个 macOS 菜单栏里的 ChatGPT 面板，只多了一个按钮。**Add** 会把你正在看的对话，放进一个已经打开的 agent 窗口的输入框，比如 Claude、Claude Code 或 Codex。它从不替你发送：文字只进入对方的草稿，接下来怎么做由你决定。

### 缘起

早期 Codex 的 ChatGPT 窗口里有一个 **Add to Codex** 按钮，一点就能把正在进行的对话送进 Codex 的输入框。后来的更新拿掉了它，需求却一直都在。

很多工作在聊天里开始：探索问题、请模型独立审阅、比较几种方案。然后到 agent harness 里完成。要把对话带过去，仍然只能逐轮复制、拼接、下载附件，再粘贴。

Add to Claude 把这个按钮找了回来，并放宽了它的范围。聊天留在菜单栏面板里。点一下 Add，整段对话会交到你选定的 agent 窗口：每一轮按原有顺序，保留原始 Markdown，连同引用和文件。名字写的是最常去的目的地，按钮上写的是这一次真正要去的地方。

目前的来源是 ChatGPT，目的地可以是任何带输入框的应用。

### 它做什么

- **面板。** 点击菜单栏图标，ChatGPT 在图标下方展开，使用独立登录，重启后依然保持。收起面板不会丢掉页面，正在生成的回复会继续。除非固定，点进其他应用时面板会自动收起。
- **底栏。** 聊天下方的细栏显示当前对话（轮数、文件、Verified 或 Partial），提供预览、复制、保存、文件列表、已打开窗口的选择器，以及 **Add to {应用}**。
- **Add。**
  - 先处理文件：对话中的文件下载到这段对话专属的文件夹。
  - 再写入文字：每一轮连同角色、原始 Markdown、引用，以及每个文件的本地路径和 SHA-256，追加到所选输入框的末尾。
  - 目标应用不会被切到前台，也不会发送任何内容。
- **设置**（⌘,）：登录时打开、启动时显示面板、保持面板常开、显示面板的快捷键、默认使用上次的窗口、Add 时下载文件、文件夹位置、辅助功能权限状态，以及退出登录。

### 隐私

- 只读取页面已经加载的对话。
- 整理好的对话只保存在内存里。
- 下载文件时，通过页面自己的会话向页面请求下载链接，会话令牌不会离开页面。
- 留在磁盘上的只有：面板的 ChatGPT 登录数据（WebKit 自身保存）、你的设置，以及你下载到所选文件夹里的文件。
- 没有遥测，没有历史存档，也没有自己的服务器。

### 构建与设置

需要 macOS 14 或更高版本、Xcode 命令行工具，以及 Node.js 24 或更高版本。构建命令见上文英文部分。

1. 在面板里登录 ChatGPT。
2. 点击底栏的 **Allow…**，然后在 系统设置 → 隐私与安全性 → 辅助功能 中打开 Add to Claude。未签名的重新构建需要再次授权。
3. 先在目标应用的输入框里点一下，在底栏选中它的窗口，再点击 **Add**。

### 测试

测试命令同上。[docs/support-matrix.md](docs/support-matrix.md) 记录了哪些已经验证、哪些尚未验证。
