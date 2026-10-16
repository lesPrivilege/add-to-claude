<h1 align="center">ChatGPT panel</h1>

<p align="center"><b>Talk it through in ChatGPT. Finish it in DeepSeek Harness.</b><br>
Pull your ChatGPT conversation into DeepSeek Harness.</p>

<p align="center"><a href="#english">English</a> · <a href="#中文">中文</a></p>

---

## English

ChatGPT panel (`dsh-chatgpt-panel`) is the DeepSeek Harness form of [Add to Claude](../../README.md). It opens ChatGPT in its own small window. An **Add from ChatGPT** button beside the composer, a **ChatGPT** tab in the right sidebar and a **ChatGPT panel** page in the left bar show the conversation you have open there. **Add to composer** puts that conversation at the end of the current session's draft. It never sends anything: the text waits in the draft until you decide.

"ChatGPT" here only says where the conversation comes from. The project is still Add to Claude, and this plugin shares its compiler, page observer and hand-off format with the macOS menu-bar app.

### What it does

- **The ChatGPT window.** A separate window shows chatgpt.com with its own login, kept in the window's own persistent session, so you sign in once. Closing it only hides it, and a reply keeps streaming. It can stay on top of other windows.
- **The Add from ChatGPT button.** In every session, the composer's tool row has a quiet text button, **Add from ChatGPT**, just left of the model selector. When the window is closed, one click opens it. Otherwise it opens a small menu: **Add to composer**, **Show ChatGPT window** and **Open ChatGPT tab**. A green dot after its label means a conversation is ready; hovering shows which one.
- **The ChatGPT tab.** The button's menu opens it, or pick **ChatGPT panel** in the right sidebar's guide (the **+** in its tab strip). It shows a status chip (Closed, Waiting, Ready, Unreadable), the conversation's title, turns and files, **Verified** or **Partial** with any content checks, **Add to composer**, **Show ChatGPT window**, and the switches **Keep window on top** and **Download files on Add**. After Add it says what happened, for example "Added · 12 turns · 2 files linked · not sent".
- **The ChatGPT panel page.** A **ChatGPT panel** row in the left bar, under Plugins and Tasks, opens the plugin's own page: the window's status, open or show it, the two switches, the files folder, how to add a conversation, and the privacy summary. It has no Add, because Add needs a session's composer.
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

1. Open a session. Click **Add from ChatGPT** beside the model selector in the composer (or **Open ChatGPT** on the **ChatGPT panel** page in the left bar). Sign in in the window that appears. The sign-in stays.
2. Open the conversation you want in that window. The button gets a green dot; its menu and the tab show the title, turns and files.
3. In the session that should get it, click **Add from ChatGPT** and choose **Add to composer**, or click **Add to composer** in the ChatGPT tab. Review the draft and send it yourself.

### How it fits together

```
DeepSeek Harness page (client half)          Host (Cordis plugin)              Electron helper
ChatGPT tab ── fetch api/chatgpt-panel.* ──▶ Connection /api fence ──▶ routes ── Node IPC (fd 3) ──▶ ChatGPT window
            ◀── state, hand-off text ─────                                     ◀── state, text ─── observer → bridge → compiler
inputActions.insertText (append, never submit)
```

- **Client half** (`client/panel.js`, built to `client/client.js`): three surfaces over one shared state source.
  - The composer's **Add from ChatGPT** text button, a `conversation.input.right` list entry (compact controls before the model selector).
  - A right-sidebar tab type registered with `ctx.sidebarRightTabs`, its body in the `sidebar.right.pane.tab` slot; the button opens it with `ctx.sidebarRight.openTab`.
  - A left-bar row in `sidebar.panellist` and its page in the root `main` slot.
  - Both session surfaces receive the session's `inputActions` and `useInput` as standard props and append with `captureInsertion` and `insertText` at the end of the draft; `setDraft` only for an empty draft. `submit` is never called.
  - Controls are the harness's own `@deepseek-ai/dsh-client-ui-primitives` (Button, Switch, Tag, Tooltip, Menu), taken from the shell's module table; the package pins 0.2.0-rc.2 exactly, so their interface cannot change under it. Colors and radii are `--dsw-*` tokens.
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
- It is installed in the owner's `desktop` profile (linked) and its tab renders there, but it has not yet been verified end to end. The automated checks use synthetic data only. See [docs/support-matrix.md](../../docs/support-matrix.md).

### Tests

```bash
npm test
npm run test:dsh-electron
```

`npm test` includes this plugin's unit tests: navigation policy, payload validation, file names and file lines, appending to the draft, the host routes and helper channel, the built preload, and the client bundle with its composer button, tab and page. `test:dsh-electron` builds the package and runs the real ChatGPT window in Electron against a synthetic chatgpt.com served from memory, with a throwaway profile: observer to hand-off text, file link, download and SHA-256, and navigation. It reports NOT RUN when Electron is missing.

---

## 中文

ChatGPT 面板（`dsh-chatgpt-panel`）是 [Add to Claude](../../README.md#中文) 的 DeepSeek Harness 形态。它在独立的小窗口里打开 ChatGPT。输入框旁的 **从 ChatGPT 添加** 按钮、右侧边栏的 **ChatGPT** 标签页和左侧栏的 **ChatGPT 面板** 页面都会显示你在那里打开的对话。点击 **添加到输入框**，这段对话会追加到当前会话草稿的末尾。它从不替你发送：文字停在草稿里，由你决定。

这里的“ChatGPT”只说明对话来自哪里。项目名仍是 Add to Claude，这个插件与 macOS 菜单栏应用共用编译器、页面观察器和交接格式。

### 它做什么

- **ChatGPT 窗口。** 独立窗口显示 chatgpt.com，使用窗口自己的持久会话，登录一次即可。关闭只是隐藏，正在生成的回复会继续。可以置顶。
- **“从 ChatGPT 添加”按钮。** 每个会话的输入框工具栏里，模型选择器左边有一个低调的文字按钮 **从 ChatGPT 添加**。窗口关闭时，点一下就会打开窗口；否则弹出一个小菜单：**添加到输入框**、**显示 ChatGPT 窗口**、**打开 ChatGPT 标签页**。文字后的绿色小圆点表示有对话已就绪，悬停可以看到是哪一段。
- **ChatGPT 标签页。** 从按钮菜单打开，或在右侧边栏的引导页（标签栏里的 **+**）选择 **ChatGPT 面板**。它显示状态标签（已关闭、等待中、就绪、无法读取）、对话标题、轮数和文件数、**Verified** 或 **Partial** 和内容检查，以及 **添加到输入框**、**显示 ChatGPT 窗口** 和两个开关 **窗口置顶**、**添加时下载文件**。添加之后会说明结果，例如“已添加 · 12 轮 · 已关联 2 个文件 · 未发送”。
- **ChatGPT 面板页面。** 左侧栏“插件”“任务”下方的 **ChatGPT 面板** 一行打开插件自己的页面：窗口状态、打开或显示窗口、两个开关、文件夹位置、添加对话的步骤和隐私说明。这里没有“添加”，因为添加需要会话的输入框。
- **添加到输入框。**
  - 先处理文件（除非关闭 **添加时下载文件**）：通过窗口自己的会话，把对话中的文件以安全的文件名下载到 `~/Downloads/Add to Claude/<对话标题>/`。
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

1. 打开一个会话，点击输入框里模型选择器旁的 **从 ChatGPT 添加**（或左侧栏 **ChatGPT 面板** 页面上的 **打开 ChatGPT**），在弹出的窗口里登录。登录会保留。
2. 在那个窗口里打开你要的对话。按钮上出现绿色小圆点，菜单和标签页会显示标题、轮数和文件。
3. 在要接收它的会话里点击 **从 ChatGPT 添加** 并选择 **添加到输入框**，或在 ChatGPT 标签页里点击 **添加到输入框**。检查草稿，然后自己发送。

### 如何协同工作

结构图见上文英文部分。

- **客户端**（`client/panel.js`，构建为 `client/client.js`）：三个界面共用一个状态源。
  - 输入框的 **从 ChatGPT 添加** 文字按钮：`conversation.input.right` 列表项（模型选择器之前的紧凑控件）。
  - 右侧边栏标签页类型：通过 `ctx.sidebarRightTabs` 注册，内容放在 `sidebar.right.pane.tab` 插槽；按钮用 `ctx.sidebarRight.openTab` 打开它。
  - 左侧栏：`sidebar.panellist` 中的一行，页面放在根作用域的 `main` 插槽。
  - 两个会话界面以标准属性拿到会话的 `inputActions` 和 `useInput`，用 `captureInsertion` 和 `insertText` 追加到草稿末尾；只有空草稿才用 `setDraft`。从不调用 `submit`。
  - 控件使用 harness 自己的 `@deepseek-ai/dsh-client-ui-primitives`（Button、Switch、Tag、Tooltip、Menu），来自外壳的模块表；包精确锁定 0.2.0-rc.2，接口不会在它之下变化。颜色和圆角使用 `--dsw-*` 变量。
- **Host 端**（`host/index.js`）：通过 `ctx.connection.fetch.register` 注册四个精确路由（`/api/chatgpt-panel.state|open|pin|add`）。它们走 harness 共用的 `/api` 通道，所以 Connection 的 Host/Origin 检查和浏览器会话 cookie 在任何处理函数之前生效；Desktop 带着这个 cookie 把应用窗口的请求转发给 host。
- **辅助进程**（`helper/`）：host 启动的 Electron 主进程，唯一的通道是 IPC 管道（没有端口或 socket）。ChatGPT 窗口使用分区 `persist:add-to-claude`、启用上下文隔离的沙盒 preload；仓库自己的 `src/page-observer.js` 运行在页面主世界，打包的编译器和 `src/bridge.js` 运行在隔离世界。顶层页面只停留在 ChatGPT 及其登录站点；其他网页链接在默认浏览器中打开；其他协议直接丢弃。

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
- 已安装在所有者的 `desktop` 配置中（链接方式），标签页能在那里显示，但尚未完成端到端验证。自动化检查只使用合成数据。详见 [docs/support-matrix.md](../../docs/support-matrix.md)。

### 测试

`npm test` 包含本插件的单元测试；`npm run test:dsh-electron` 构建插件包，并用一次性配置在 Electron 中运行真实的 ChatGPT 窗口，对接内存中提供的合成 chatgpt.com 页面。找不到 Electron 时报告 NOT RUN。
