> Archived 2026-10-16: superseded by [design/icons/README.md](../../design/icons/README.md) (input to WO-02, delivered in 0.6.0).

# gpt-handoff · Design Reference Registry

**登记日期：** 2026-10-16  
**用途：** macOS status-item / menu-item symbol 与独立 app icon 的研究输入；同时服务后续 Agent 设计工单。  
**状态：** 外部来源初步核查完成；尚未下载、复制或取得第三方设计原稿；不将参考图直接当作授权素材。  
**适用产品：** gpt-handoff：将 ChatGPT 会话内容与附件纳入用户选定的本地 Agent composer；工具不替用户发送。

## 0. 设计判断与使用规则

- **两类 icon 分别设计、分别验收。** Status item / menu item 使用尽量原生的单色符号，不靠渐变或微小细节；app icon 可以使用冷色调、渐变、体积感与材质。二者只需概念亲缘，不要求轮廓完全一致。
- **首先表达 composer 与纳入。** 不以 Sparkle、闪电、魔法棒或纸张代表 AI；也不以发送按钮宣称发送行为。
- **既有否决记录是输入而非候选。** 两条朝上的射线与胶囊在小尺寸容易读成提手、天线、手提包、收音机；梯形上下融合容易读成烧瓶或打印机输纸器。不得仅细修这些被否决的几何。
- **新观察：** 倾斜划过的单一轨迹/弧线，在接近 composer 时收束或消失，可能比两条独立射线更有“纳入”的动作感。避免任何四角 Sparkle 轮廓。
- 下列资料按 **规范 (N)、观察样本 (C)、可供编辑的图形 grammar (L)、Agent Skill (S)、制作工具 (T)** 分类。参考需登记 `URL / 观察点 / 可迁移规则 / 不迁移内容 / 使用许可 / 最后核查日期`。

## 1. 优先参考登记

| ID  | 类型/优先级      | 原始来源                                                                                                                                                                            | 应消费什么                                                                               | 禁止或边界                                                                                        |
| --- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| N01 | 规范 / P0        | [Apple HIG — SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols)                                                                                  | 光学尺寸、线重、重心、不同 weight、与系统文本共处的方式                                  | Apple 明确禁止将 SF Symbols 或易混淆相似图形用于 app icon、logo、商标用途；不要直接挪用到品牌图标 |
| N02 | 规范 / P0        | [Apple HIG — App Icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)                                                                                    | app icon 在各尺寸及不同外观下的识别、简洁、中心安全区、系统遮罩                          | 不能把菜单栏 template symbol 原样贴到有底板的 app icon 上就算完成                                 |
| N03 | 工具与规范 / P0  | [Apple Icon Composer](https://developer.apple.com/icon-composer/) · [Xcode 工作流](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer)      | 分层路径、系统材质、refraction/highlight、Icon Composer 资产制作与预览                   | 是否采用取决于目标 macOS 与工具链；不要先做不可编辑的位图再试图倒推路径                           |
| N04 | 实现 / P0        | [Apple NSStatusItem](https://developer.apple.com/documentation/appkit/nsstatusitem) · [NSImage.isTemplate](https://developer.apple.com/documentation/appkit/nsimage/istemplate)     | 菜单栏按钮、template image 黑色+透明 alpha、系统着色                                     | 与 app icon 的多色光影生产线完全独立；具体渲染由目标 macOS 版本实测                               |
| C01 | 样本 / P0        | [Mac Menubar Apps](https://macmenubar.app/)                                                                                                                                         | 菜单栏真实截屏中，图标与系统符号的视觉密度、尺寸、留白、可辨识性                         | 站内内容是样本，非可自由复用的图标库                                                              |
| C02 | 样本 / P0        | [CleanShot X 菜单栏示例](https://macmenubar.app/app/cleanshot-x) · [CleanShot 官方站](https://cleanshot.com/)                                                                       | menu bar glyph 与 popover 结构；把“小而美的工具”和复杂的功能命令区分开                   | CleanShot 图标、品牌图形不供复制；参考轻量感与状态位                                              |
| C03 | 样本 / P0        | [Raycast Press & Media Kit](https://www.raycast.com/press) · [Raycast 图标系统回顾](https://www.raycast.com/blog/a-fresh-look-and-feel)                                             | 品牌 app icon 和独立 outline UI icon 的区分；系统内图标一致的圆角、描边、视觉重量        | Raycast 自己的品牌图形不是开放 logo 模板；官方明确不建议修改其图标颜色                            |
| C04 | 样本 / P1        | [PopClip 官方站](https://www.popclip.app/) · [Mac Menubar Apps — PopClip](https://macmenubar.app/app/popclip)                                                                       | 工具动作一触即达、符号在工具栏与菜单栏中的简练程度；克制的操作反馈                       | PopClip 核心是选中文本弹出工具，不是把其交互模式复制进本项目                                      |
| C05 | 样本 / P1        | [Bartender 官方站](https://www.macbartender.com/)                                                                                                                                   | 多图标拥挤的系统菜单栏内，图形存在感与间距；菜单栏可见性                                 | Bartender 产品自身不构成可复用 logo 资产                                                          |
| C06 | 图库 / P0        | [macOSicons Gallery](https://macosicons.com/)                                                                                                                                       | 简单轮廓加有质感底板的真实大样本；观察高光、层次与材质，不必复古拟物                     | 社区作品许可逐件核实；除非有明确许可，只做视觉参考                                                |
| L01 | SVG 库 / P1      | [Lucide](https://lucide.dev/) · [ISC License](https://lucide.dev/license)                                                                                                           | 一致线重、拐角和开放轮廓，适合界面图标语法对照                                           | 库授权不意味着适合直接拿某个通用符号当自有品牌 logo；保留许可声明                                 |
| L02 | SVG 库 / P1      | [Iconoir](https://iconoir.com/)                                                                                                                                                     | 轻量几何、细线与负形；MIT 授权                                                           | 仅取图形语言参考；原稿须按 MIT 许可处理                                                           |
| L03 | SVG 库 / P1      | [Phosphor](https://phosphoricons.com/) · [raw SVG / MIT](https://github.com/phosphor-icons/core)                                                                                    | 同一语义不同字重（thin/light/regular/bold）的对照，评估微型渲染损失                      | 不直接将通用 glyph 当完整品牌主图                                                                 |
| T01 | 工具 / P1        | [macOSicons Editor](https://macosicons.com/editor)                                                                                                                                  | 可编辑路径、玻璃/黏土/浮雕效果及 icns/appiconset 输出，供实验                            | 属第三方工具；查核导出文件和具体服务条款后再纳入生产                                              |
| S01 | Agent Skill / P1 | [Anthropic frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)                                                                         | 针对具体产品建立鲜明审美方向、避免模板化设计、设计自查                                   | 主要面向前端，不是 macOS icon 专用 skill；只消费决策和批判方法                                    |
| S02 | Agent Skill / P1 | [Anthropic canvas-design](https://github.com/anthropics/skills/blob/main/skills/canvas-design/SKILL.md)                                                                             | 以形式、空间、光感等视觉思想推导方案，适合制作视觉评审板                                 | 主要面向 PNG/PDF 静态画面；最终必须输出可编辑矢量，不以图像生成替代路径                           |
| S03 | Agent 生态 / P2  | [Agent Skills Specification](https://agentskills.io/specification) · [Anthropic Skills Marketplace](https://github.com/anthropics/skills/blob/main/.claude-plugin/marketplace.json) | `SKILL.md`、`references/`、`assets/` 的可复用结构；若工作流稳定再蒸馏为本地 design skill | 不为这次 icon 一次性任务无谓安装大量 skill                                                        |

**来源核查说明：** 上述 URL 为公开页面/仓库入口，本次核查日期 2026-10-16。外部页面和图库可能更新；制作前再次打开具体内容并在本地注明访问日期、截图来源、使用范围。当前未核实任何社区 icon 的单件商业授权，也未承诺第三方 Skill 能在当前 Claude Desktop 环境直接安装。

## 2. 研究顺序与消费工件

### A. Native Symbol grammar（优先）

1. 从 Apple N01/N04 建立一组同等外框的 SF Symbols **风格参照**（不要拿它们做品牌）；抓取其字重、负形比例、顶底留白和 16–20pt 的实际观感。
2. 从 C01/C02/C04/C05 各选 2–3 个真实菜单栏状态截图，记录：旁边有什么系统图标、是否拥挤、黑/白两种菜单栏背景、首次观看时读成什么。
3. 把 gpt-handoff 的候选符号放入同一个菜单栏模拟环境，并与系统符号混排。仅在真实尺寸下判断，不以放大 SVG 的漂亮程度裁决。

### B. App Icon grammar（其次）

1. 从 C03/C06 选 6–10 件可说明“一个主要符号 + 一块有质感的底板”的实例，每件记录：光感来源、材质、轮廓层级、负形、32px 识别情况。
2. C03 是“同一品牌/产品的不同 icon 层级”的观察案例，非拷贝其符号。C06 是样式抽样，需标注每个案例的作者/页面。
3. 对 N02/N03 进行实现验证：在 macOS Dock 32/64/128px、设置页面、Finder 等场景预览；效果优先于特定技术名词。

### C. Agent Skill / library 的使用边界

- `frontend-design` 只让 Agent 在开画前作出具体设计主张并自查，不让它自由扩张成整套 UI 重设计。
- `canvas-design` 可以用于设计理念和 reference board，不取代原生可编辑 SVG/path。
- Lucide、Iconoir、Phosphor 用来做**视觉密度与字重对照**，避免直接从素材库拿成品当品牌。
- 后续若积累多轮可复用的 icon QA，再按 Agent Skills 格式归档本项目的 skill；本次先完成 output 和实尺寸验收。

## 3. 本项目的三条独立方向（探索假设，非裁决）

| 概念                              | 菜单栏（单色/原生）                                               | App icon（独立设计）                                         | 主要风险                                         |
| --------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| D1 · **Arc Insert**（优先）       | 极简 composer + 一笔斜向划入的弧线；只在交汇处保留动作指向        | 明亮但克制的滑行轨迹，从冷色空间进入输入区域，可用材质与深度 | 弧线太长会被读成刷新、回旋；落点不明确就只像擦过 |
| D2 · **Cursor Arrival**           | 简化 composer，文本线或光标成为终点；上方仅保留极短、单一进入线索 | 光标/文字出现的瞬间做成明确焦点，光学深度在板内展开          | 容易变普通聊天/输入图标；内部文字线太多会模糊    |
| D3 · **Negative-space Insertion** | 用输入区上沿的“开口”或负形表达内容穿入，不必画两条对称光束        | 将开口转化为材质分层和方向性反射，图形与菜单栏版概念相通     | 如果演化成打印机、输纸器或烧瓶，直接拒绝         |

允许设计师基于参考提出另一种更强的方向，但必须解释为何在 16pt 比现有 C 提案更容易辨识。D1 不是强制赢家。

## 4. 排除标准 / 光学验收

- **一眼误读：** 手提包、收音机、天线、提手、打印机、烧瓶、下载箭头、发送按钮、AI sparkle。若高频出现，直接否决；不靠说明文字挽救。
- **菜单栏：** 原生尺寸 16/18/20pt，@1x/@2x、light/dark、低对比度壁纸下混排检查；统一单色 template 路径；笔画不因缩小粘连；视觉重量不压过同排系统图标。
- **App icon：** 32/64/128/256px 和 Dock 实景；独立原创的品牌图形；支持 editable source，冷色系可用但不为渐变而渐变；不挪用 SF Symbols 或竞品商标。
- **产品边界：** 读成“纳入 composer”，而不是“发送/生成/处理完毕”。
- **交付门槛：** 三组 paired concepts，每组分别展示菜单栏和 app icon，但**不要求共用同一 SVG**；附 reference board、矢量源文件、原生尺寸 preview、作者自己的误读复盘与推荐方案。

## 5. 版本管理建议

参考登记存为项目 `docs/design/references/gpt-handoff-icon-registry.md`（以实际目录结构为准），每条参考标注 `consumed/considered/rejected`，保留本次否决原因与以后复查日期。设计稿独立分支；不在本轮无审阅合入 main。
