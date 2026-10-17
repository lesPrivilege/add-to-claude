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
- **Which turns.** A small menu left of Add shows what Add will put in: "All · 42", "New · 6" or "3 selected". It picks by itself (Auto), and you can override it for one Add.
- **Settings** (⌘,) opens in the panel's place; closing it brings the panel back. It has open at login, show at launch, keep the panel open, a shortcut to show the panel, start with the last window, download files on Add, the files folder, what Add remembers and for how long, clearing the web cache (the sign-in is kept), a diagnostics export without message text, Accessibility status, and sign out.

### Adding again and choosing turns

- **New target.** The first Add into a conversation puts in every turn ("All · 42").
- **Continue a target.**
  - When the target window says which conversation it shows (Claude's page address, for one), the next Add into that same conversation offers only the turns after the furthest one added: "New · 6", with the range under it, e.g. "Turns 37–42 of 42 · new since last add".
  - If you skipped turns by hand, it says how many were never added. If an earlier turn changed since you added it (an edit, a new version), it says so and does not resend it; choose **New and changed** or **Choose turns…** to include it.
- **A window that doesn't say which conversation it is.**
  - Add always offers every turn. After one Add, **Continue in this conversation** appears: click it if the window still shows the conversation you added to, and Add offers what's new.
  - **Stop continuing** undoes it. It also ends by itself when the window closes or its title changes.
- **Switch back.** Each target conversation keeps its own progress, so going back to an earlier one picks up where that one left off.
- **Add again.**
  - If nothing is new, or you click Add on exactly what you just added, the bar asks "Add again?" first. Nothing is inserted twice by accident.
  - If the app took the text but it could not be read back exactly, the bar says **Could not confirm** and asks whether it is in the draft. Only a confirmed Add counts as added.
- **Choose turns.**
  - **Choose turns…** lists every turn with its role, number, a short preview and its files; turns already added are marked "added".
  - Click anywhere on a row to check or clear it, or drag across rows to give them all the same state; shift-click covers a run; All and None select everything or nothing. The choice applies to the next Add only.
- **Files.** A chosen turn brings its own files and references, and only the checks that concern it. The text says which turns it carries, e.g. "Selected turns: 3, 5–9 of 42".

### Terminals

A terminal may be showing a shell rather than an agent, so it never receives the conversation itself, and Add never types or pastes into it.

- **The picker** lists the windows of any terminal app (Terminal, iTerm2, Ghostty, WezTerm, Warp, Kitty…) under **Terminals**.
- **Add** saves the text as `handoff-<id>.add-to-claude.md` in the conversation's files folder (`<id>` is the start of the ChatGPT conversation's id), puts one line on the clipboard, `@"/path/to/handoff-<id>.add-to-claude.md"`, and brings that terminal window forward. Click into the tab you want and press ⌘V. In an agent the line is a file mention; at a shell prompt it is an unexecuted line, and the path holds nothing a shell would act on (`$`, backticks, `\`, `!`, `"`).
- **Then say** whether it is there: **It's There** counts it as added; **It's Not** copies the line again. A copied line is not a pasted one, so Add does not assume it.
- **One file per conversation**, replaced by each Add. Clear History removes them, and each is removed once a day old, when the app starts or the panel opens. A file of that name that Add did not write, or that you edited, is left alone.
- A terminal never says which conversation an agent in it holds, so Add treats each terminal window as a window that doesn't say (above).

### Privacy

- It reads only the conversation the page has loaded.
- The prepared conversation is held in memory only.
- To get a file, it asks the page for the file's download link through the page's own session. The session token never leaves the page.
- What stays on disk: the panel's ChatGPT login (WebKit's own data), your settings, and the files you download, in the folder you choose.
- **What Add remembers** is the one other thing it writes, to `~/Library/Application Support/add-to-claude/`.
  - `delivery-log.json` holds which turns went into which identified conversation: message ids, positions, content hashes, states and times. It never holds message text.
  - `saved-files.json` holds where Add saved each file and its SHA-256, so a later Add reuses the copy while its bytes are unchanged.
  - Both are kept for 30 days by default. Settings → History turns it off, changes how long it is kept, or clears it.
- The hand-off file for a terminal sits in the conversation's files folder until it is a day old and the app starts or the panel opens (see Terminals).
- No telemetry, no history archive, no server of its own.

### Install the beta

> Add to Claude is an independent tool, not affiliated with or approved by OpenAI or Anthropic. It reads the ChatGPT page you have open through your own session; check that this fits the terms that apply to your account.

0.6.1 is a private technical beta for Apple silicon Macs on macOS 14 or later. It is signed with the author's own certificate, not an Apple Developer ID, and not notarized, so macOS asks once before the first launch.

1. Download `add-to-claude-0.6.1.zip` from [Releases](https://github.com/lesPrivilege/add-to-claude/releases), check its SHA-256 against the release notes, unzip it and move **Add to Claude** to Applications.
2. Open it. macOS refuses the first time; go to System Settings → Privacy & Security, choose **Open Anyway** for Add to Claude, and confirm.
3. Sign in to ChatGPT in the panel, then choose **Allow…** in the bar for Accessibility (below). Later releases signed with the same certificate keep that permission.

### Build and set up

You need macOS 14 or later, the Xcode command-line tools, and Node.js 24 or later.

```bash
npm ci
```

```bash
bash scripts/build-macos.sh
```

```bash
open "dist/Add to Claude.app"
```

1. Sign in to ChatGPT in the panel.
2. Choose **Allow…** in the bar, then turn on Add to Claude in System Settings → Privacy & Security → Accessibility. An ad-hoc build needs this again after every rebuild; to keep it across updates, run `bash scripts/make-signing-identity.sh` once (it creates a local signing identity in your login keychain), then rebuild.
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

- `npm test` covers the model, the adapters, the compiler, the page observer, and the bundled bridge.
- `test:native` checks the delivery log and the scope rule, runs the real chat controller in a real `WKWebView`, checks the terminal adapter's logic (the one-line mention and the hand-off files), then the Accessibility checks against a synthetic app. No real terminal is touched. The Accessibility checks report NOT RUN unless the terminal has Accessibility access.
- `test:browser` runs the page observer in a real browser.

[docs/support-matrix.md](docs/support-matrix.md) records what has been verified and what has not. [docs/roadmap.md](docs/roadmap.md) has what comes next, and [docs/README.md](docs/README.md) lists the rest of the documentation.

### Contributing and licence

See [CONTRIBUTING.md](CONTRIBUTING.md) for the rules a change must keep and the checks to run, and [SECURITY.md](SECURITY.md) for reporting a vulnerability. Add to Claude is under the [MIT License](LICENSE).

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
- **哪些轮次。** Add 左边的小菜单显示这次会放进去什么：「All · 42」「New · 6」或「3 selected」。它会自动选择（Auto），你也可以只为这一次 Add 改选。
- **设置**（⌘,）在面板的位置打开，关闭后回到面板。包括：登录时打开、启动时显示面板、保持面板常开、显示面板的快捷键、默认使用上次的窗口、Add 时下载文件、文件夹位置、记住添加过什么以及保留多久、清除网页缓存（保留登录）、导出不含消息正文的诊断信息、辅助功能权限状态，以及退出登录。

### 再次添加与选择轮次

- **新目标。** 第一次 Add 到某个对话时，放入全部轮次（「All · 42」）。
- **继续同一个目标。**
  - 如果目标窗口能说明自己显示的是哪个对话（例如 Claude 的页面地址），下次 Add 到同一个对话时，只提供已添加的最远一轮之后的内容：「New · 6」，下方显示范围，例如「Turns 37–42 of 42 · new since last add」。
  - 如果你曾手动跳过某些轮次，会提示有几轮从未添加。如果之前添加过的某一轮后来变了（编辑或重新生成），会提示而不会重发；要包含它，选 **New and changed** 或 **Choose turns…**。
- **无法说明是哪个对话的窗口。**
  - Add 总是提供全部轮次。添加一次之后会出现 **Continue in this conversation**：如果这个窗口仍是你刚才添加到的对话，点它，Add 就只提供新增内容。
  - **Stop continuing** 可以撤销。窗口关闭或标题改变时，它也会自动结束。
- **切回之前的目标。** 每个目标对话各自记录进度，回到之前的对话会从那里接着来。
- **再次添加。**
  - 如果没有新内容，或者你对刚添加过的同一范围再点 Add，底栏会先问「Add again?」，不会无意中重复插入。
  - 如果目标应用收下了文字但无法逐字读回，底栏会显示 **Could not confirm**，并问你草稿里是否已有。只有确认过的才算已添加。
- **选择轮次。**
  - **Choose turns…** 列出每一轮的角色、序号、简短预览和文件；已添加的标为「added」。
  - 点击一行的任意位置即可勾选或取消，按住拖过多行会让它们统一变成同一状态；按住 Shift 点击可选中一段，All / None 全选或全不选。这个选择只用于下一次 Add。
- **文件。** 选中的轮次会带上它自己的文件和引用，以及只与它相关的检查项。文字里会写明包含哪些轮次，例如「Selected turns: 3, 5–9 of 42」。

### 终端

终端里显示的可能是 shell 而不是 agent，所以终端从不直接接收对话正文，Add 也从不往终端里输入或粘贴。

- **选择器**在 **Terminals** 下列出任意终端应用的窗口（Terminal、iTerm2、Ghostty、WezTerm、Warp、Kitty…）。
- **Add** 把文字存为这段对话文件夹里的 `handoff-<id>.add-to-claude.md`（`<id>` 是 ChatGPT 对话 id 的开头几位），把一行 `@"/path/to/handoff-<id>.add-to-claude.md"` 放到剪贴板，并把那个终端窗口带到前台。点进你要的标签页，按 ⌘V。在 agent 里它是一个文件引用；在 shell 提示符下它只是一行未执行的文字，路径里也不含 shell 会处理的字符（`$`、反引号、`\`、`!`、`"`）。
- **然后告诉 Add** 是否已经粘贴：**It's There** 记为已添加；**It's Not** 会再复制一次这一行。复制不等于已粘贴，Add 不会替你假定。
- **每段对话一个文件**，每次 Add 覆盖。清除历史（Clear History）会删除它们；满一天的文件会在应用启动或面板打开时删除。同名但不是 Add 写的、或你改过的文件不会被动。
- 终端无法说明其中的 agent 是哪个对话，所以 Add 把每个终端窗口当作「无法说明是哪个对话的窗口」（见上文）。

### 隐私

- 只读取页面已经加载的对话。
- 整理好的对话只保存在内存里。
- 下载文件时，通过页面自己的会话向页面请求下载链接，会话令牌不会离开页面。
- 留在磁盘上的只有：面板的 ChatGPT 登录数据（WebKit 自身保存）、你的设置，以及你下载到所选文件夹里的文件。
- **Add 记住的内容**是它唯一另外写入的东西，位于 `~/Library/Application Support/add-to-claude/`。
  - `delivery-log.json` 记录哪些轮次进入了哪个已识别的对话：消息 ID、位置、内容哈希、状态和时间，从不保存消息正文。
  - `saved-files.json` 记录 Add 把每个文件存在哪里及其 SHA-256，之后再 Add 时只要文件内容未变就直接复用。
  - 两者默认保留 30 天。在 设置 → History 中可以关闭、改变保留时长或清除。
- 给终端的交接文件放在这段对话的文件夹里，满一天后在应用启动或面板打开时删除（见「终端」）。
- 没有遥测，没有历史存档，也没有自己的服务器。

### 安装测试版

> Add to Claude 是独立工具，与 OpenAI 或 Anthropic 无关联，也未获其认可。它通过你自己的会话读取你打开的 ChatGPT 页面；请自行确认这符合你账号适用的条款。

0.6.1 是面向 Apple 芯片 Mac（macOS 14 或更高版本）的私有技术测试版。它用作者自己的证书签名，不是 Apple 开发者 ID，也未经公证，所以第一次打开前 macOS 会询问一次。

1. 从 [Releases](https://github.com/lesPrivilege/add-to-claude/releases) 下载 `add-to-claude-0.6.1.zip`，与发布说明核对 SHA-256，解压后把 **Add to Claude** 移到“应用程序”。
2. 打开它。第一次会被拒绝；到 系统设置 → 隐私与安全性，为 Add to Claude 选择 **仍要打开**，再确认。
3. 在面板里登录 ChatGPT，然后点击底栏的 **Allow…** 开启辅助功能（见下文）。之后用同一证书签名的版本会保留这项授权。

### 构建与设置

需要 macOS 14 或更高版本、Xcode 命令行工具，以及 Node.js 24 或更高版本。构建命令见上文英文部分。

1. 在面板里登录 ChatGPT。
2. 点击底栏的 **Allow…**，然后在 系统设置 → 隐私与安全性 → 辅助功能 中打开 Add to Claude。临时签名（ad-hoc）的构建每次重建后都要重新授权；运行一次 `bash scripts/make-signing-identity.sh`（在登录钥匙串中创建本机签名身份）再重建，之后的更新会保留授权。
3. 先在目标应用的输入框里点一下，在底栏选中它的窗口，再点击 **Add**。

### 测试

测试命令同上。[docs/support-matrix.md](docs/support-matrix.md) 记录了哪些已经验证、哪些尚未验证；后续计划见 [docs/roadmap.md](docs/roadmap.md)；其余文档见 [docs/README.md](docs/README.md)。

### 贡献与许可

修改须遵守的规则与要运行的检查见 [CONTRIBUTING.md](CONTRIBUTING.md)，报告安全漏洞见 [SECURITY.md](SECURITY.md)。Add to Claude 采用 [MIT 许可证](LICENSE)。
