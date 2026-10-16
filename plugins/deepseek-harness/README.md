<h1 align="center">ChatGPT panel</h1>

<p align="center"><b>Talk it through in ChatGPT. Finish it in DeepSeek Harness.</b><br>
Pull your ChatGPT conversation into DeepSeek Harness.</p>

<p align="center"><a href="#english">English</a> · <a href="#中文">中文</a></p>

---

## English

ChatGPT panel (`dsh-chatgpt-panel`) is the DeepSeek Harness form of [Add to Claude](../../README.md). It opens ChatGPT in its own small window, and a **ChatGPT** tab in the harness's right sidebar shows the conversation you have open there. **Add to composer** puts that conversation at the end of the current session's draft. It never sends anything: the text waits in the draft until you decide.

"ChatGPT" here only says where the conversation comes from. The project is still Add to Claude, and this plugin shares its compiler, page observer and hand-off format with the macOS menu-bar app.

### What it does

- **The ChatGPT window.** A separate window shows chatgpt.com with its own login, kept in the window's own persistent session, so you sign in once. Closing it only hides it, and a reply keeps streaming. It can stay on top of other windows.
- **The ChatGPT tab.** In a session, open the right sidebar's guide (the **+** in its tab strip) and pick **ChatGPT panel**. The tab shows whether the window is open, the conversation's title, its turns and files, and **Verified** or **Partial** with any content checks.
- **Add to composer.**
  - Files first (unless you untick **Download files on Add**): the conversation's files are downloaded into `~/Downloads/Add to Claude/<conversation title>/`, with safe file names, through the window's own session.
  - Then the text: every turn in order, with its role, original Markdown, references, and each saved file's local path and SHA-256, the same text the macOS app adds.
  - The text is appended to the end of the draft. Nothing you wrote is replaced, and nothing is submitted. If the draft changes at that moment, or the composer is busy, nothing is written and the tab says so.

### Requirements

- **DeepSeek Harness 0.2.0-rc.2 exactly**: tag `dsh-v0.2.0-rc.2`, commit `639ed015397290b3745d163aafe02ffee4aa3f84`. The package declares exact `0.2.0-rc.2` peers, so another release refuses it at boot unless you exempt it. The plugin interfaces it uses (`ctx.connection.fetch`, right-sidebar tab types, session input actions) are not versioned and may change between release candidates.
- **Electron 43**, the one the dsh-pet plugin keeps at `~/.dsh/electron/Electron.app` (it downloads it once). This plugin downloads nothing; without that copy, set `DSH_CHATGPT_PANEL_ELECTRON` to an Electron executable in the environment DeepSeek Harness starts from.
- macOS. Windows and Linux paths exist in the code but were never run.
- To build: Node.js 24 or later.

### Build

```bash
npm ci
npm run build:dsh
```

This writes the installable package to `dist/dsh-chatgpt-panel/`. To get a tarball as well:

```bash
npm pack ./dist/dsh-chatgpt-panel --pack-destination dist
```

### Install locally

Either way, the plugin goes into your `desktop` profile.

- **In the app:** open **Plugins**, choose install, and enter the absolute path of `dist/dsh-chatgpt-panel` (the field takes a package name, a GitHub address or a local folder).
- **From a terminal:** quit DeepSeek Harness Desktop first. If you have installed the `dsh` command (menu **Manage dsh Command…**), run:

  ```bash
  dsh plugin --profile desktop add "$PWD/dist/dsh-chatgpt-panel"
  ```

  A folder install is a link: rebuild and restart Desktop to pick up changes. `dsh plugin --profile desktop remove dsh-chatgpt-panel` removes it.

### Use

1. Open a session, open the right sidebar's guide, and pick **ChatGPT panel**.
2. Click **Open ChatGPT** and sign in in the window that appears. The sign-in stays.
3. Open the conversation you want in that window. The tab shows its title, turns and files.
4. In the session that should get it, click **Add to composer**. Review the draft and send it yourself.

### How it fits together

```
DeepSeek Harness page (client half)          Host (Cordis plugin)              Electron helper
ChatGPT tab ── fetch api/chatgpt-panel.* ──▶ Connection /api fence ──▶ routes ── Node IPC (fd 3) ──▶ ChatGPT window
            ◀── state, hand-off text ─────                                     ◀── state, text ─── observer → bridge → compiler
inputActions.insertText (append, never submit)
```

- **Client half** (`client/panel.js`, built to `client/client.js`): a right-sidebar tab type registered with `ctx.sidebarRightTabs` and its body in the `sidebar.right.pane.tab` slot. The body receives the session's `inputActions` and `useInput` as standard props and appends with `captureInsertion` and `insertText` at the end of the draft; `setDraft` only for an empty draft. `submit` is never called.
- **Host half** (`host/index.js`): registers four exact routes (`/api/chatgpt-panel.state|open|pin|add`) through `ctx.connection.fetch.register`. They sit on the harness's shared `/api` channel, so Connection's Host/Origin checks and browser-session cookie apply before any handler runs; Desktop forwards the app window's requests to the host with that cookie.
- **Helper** (`helper/`): an Electron main process spawned by the host with an IPC pipe as its only channel (no port or socket). The ChatGPT window uses the partition `persist:add-to-claude`, a sandboxed preload with context isolation, and the repository's own `src/page-observer.js` in the page's main world and the bundled compiler and `src/bridge.js` in the isolated world. Top-level pages stay on ChatGPT and its sign-in hosts; other web links open in your default browser; other schemes are dropped.

### Privacy

- It reads only the conversation the ChatGPT page has loaded. The prepared conversation is held in memory, in the helper, until the page moves on.
- To get a file, it asks the page for the file's link through the page's own session. The session token never leaves the page.
- The hand-off text goes from the helper to the host only when you click Add, and from there only to this harness page, over the authenticated `/api` channel. The tab's status carries the title and counts, never the text.
- What stays on disk: the window's ChatGPT login (Electron's data under `~/Library/Application Support/dsh-chatgpt-panel-helper/`), and the files you download.
- No telemetry, no history archive, no server of its own.

### Limits

- **A separate window, not embedded.** The harness's in-app browser tab cannot keep a login: it forces a non-persistent session, allows no preload, and refuses downloads. ChatGPT therefore runs in its own window beside the harness, not inside the sidebar.
- The Electron window appears in the Dock as a separate app.
- Text that goes into the composer is capped at 2 MiB.
- File paths are listed in the Markdown, as in the macOS app; they are not turned into the composer's `@` file chips.
- Microphone, camera and notifications are refused in the ChatGPT window.
- This has been checked with synthetic data only, and not yet inside a running DeepSeek Harness. See [docs/support-matrix.md](../../docs/support-matrix.md).

### Tests

```bash
npm test
npm run test:dsh-electron
```

`npm test` includes this plugin's unit tests: navigation policy, payload validation, file names and file lines, appending to the draft, the host routes and helper channel, the built preload and client bundle. `test:dsh-electron` builds the package and runs the real ChatGPT window in Electron against a synthetic chatgpt.com served from memory, with a throwaway profile: observer to hand-off text, file link, download and SHA-256, and navigation. It reports NOT RUN when Electron is missing.

---

## 中文

ChatGPT 面板（`dsh-chatgpt-panel`）是 [Add to Claude](../../README.md#中文) 的 DeepSeek Harness 形态。它在独立的小窗口里打开 ChatGPT；harness 右侧边栏里的 **ChatGPT** 标签页显示你在那里打开的对话。点击 **添加到输入框**，这段对话会追加到当前会话草稿的末尾。它从不替你发送：文字停在草稿里，由你决定。

这里的“ChatGPT”只说明对话来自哪里。项目名仍是 Add to Claude，这个插件与 macOS 菜单栏应用共用编译器、页面观察器和交接格式。

### 它做什么

- **ChatGPT 窗口。** 独立窗口显示 chatgpt.com，使用窗口自己的持久会话，登录一次即可。关闭只是隐藏，正在生成的回复会继续。可以置顶。
- **ChatGPT 标签页。** 在会话中打开右侧边栏的引导页（标签栏里的 **+**），选择 **ChatGPT 面板**。标签页显示窗口是否打开、对话标题、轮数和文件数，以及 **Verified** 或 **Partial** 和内容检查。
- **添加到输入框。**
  - 先处理文件（除非取消勾选 **Add 时下载文件**）：通过窗口自己的会话，把对话中的文件以安全的文件名下载到 `~/Downloads/Add to Claude/<对话标题>/`。
  - 再写入文字：每一轮按原有顺序，连同角色、原始 Markdown、引用，以及每个已保存文件的本地路径和 SHA-256，与 macOS 应用添加的文字相同。
  - 文字追加到草稿末尾，不替换你写的任何内容，也不提交。如果此时草稿正在变化或输入框正忙，什么都不写，标签页会提示。

### 要求

- **仅限 DeepSeek Harness 0.2.0-rc.2**：标签 `dsh-v0.2.0-rc.2`，提交 `639ed015397290b3745d163aafe02ffee4aa3f84`。包里声明了精确的 `0.2.0-rc.2` peer 依赖，其他版本启动时会拒绝加载，除非你为它设置豁免。插件用到的接口（`ctx.connection.fetch`、右侧边栏标签类型、会话输入动作）没有版本承诺，可能在各个 RC 之间变化。
- **Electron 43**，即 dsh-pet 插件放在 `~/.dsh/electron/Electron.app` 的那一份（由它下载一次）。本插件不下载任何东西；没有这份 Electron 时，请在 DeepSeek Harness 启动时所在的环境里设置 `DSH_CHATGPT_PANEL_ELECTRON` 指向一个 Electron 可执行文件。
- macOS。代码里有 Windows 和 Linux 的路径，但从未运行过。
- 构建需要 Node.js 24 或更高版本。

### 构建

构建命令见上文英文部分：`npm ci`，然后 `npm run build:dsh`，生成 `dist/dsh-chatgpt-panel/`；需要压缩包时再运行 `npm pack ./dist/dsh-chatgpt-panel --pack-destination dist`。

### 本地安装

- **在应用里：** 打开 **插件** 页面，选择安装，输入 `dist/dsh-chatgpt-panel` 的绝对路径（输入框接受包名、GitHub 地址或本地目录）。
- **在终端里：** 先退出 DeepSeek Harness Desktop。如果已经安装了 `dsh` 命令（菜单 **Manage dsh Command…**），运行 `dsh plugin --profile desktop add "$PWD/dist/dsh-chatgpt-panel"`。目录安装是链接：重新构建后重启 Desktop 即可生效。`dsh plugin --profile desktop remove dsh-chatgpt-panel` 可以移除。

### 使用

1. 打开一个会话，打开右侧边栏的引导页，选择 **ChatGPT 面板**。
2. 点击 **打开 ChatGPT**，在弹出的窗口里登录。登录会保留。
3. 在那个窗口里打开你要的对话，标签页会显示标题、轮数和文件。
4. 在要接收它的会话里点击 **添加到输入框**。检查草稿，然后自己发送。

### 隐私

- 只读取 ChatGPT 页面已经加载的对话。整理好的对话只保存在辅助进程的内存里，页面切换后即丢弃。
- 下载文件时，通过页面自己的会话向页面请求下载链接，会话令牌不会离开页面。
- 只有点击 Add 时，交接文字才从辅助进程交给 host，再经过已认证的 `/api` 通道只交给这个 harness 页面。标签页的状态只有标题和数量，没有正文。
- 留在磁盘上的只有：窗口的 ChatGPT 登录数据（Electron 保存在 `~/Library/Application Support/dsh-chatgpt-panel-helper/`），以及你下载的文件。
- 没有遥测，没有历史存档，也没有自己的服务器。

### 限制

- **独立窗口，而不是嵌入。** harness 自带的浏览器标签页无法保持登录：它强制使用非持久会话，不允许 preload，并拒绝下载。所以 ChatGPT 运行在 harness 旁边的独立窗口里，而不是侧边栏里。
- 这个 Electron 窗口在 Dock 中显示为单独的应用。
- 进入输入框的文字上限为 2 MiB。
- 文件路径写在 Markdown 里，与 macOS 应用一致，不会变成输入框里的 `@` 文件标签。
- ChatGPT 窗口拒绝麦克风、摄像头和通知权限。
- 目前只用合成数据检查过，尚未在运行中的 DeepSeek Harness 里验证。详见 [docs/support-matrix.md](../../docs/support-matrix.md)。

### 测试

`npm test` 包含本插件的单元测试；`npm run test:dsh-electron` 构建插件包，并用一次性配置在 Electron 中运行真实的 ChatGPT 窗口，对接内存中提供的合成 chatgpt.com 页面。找不到 Electron 时报告 NOT RUN。
