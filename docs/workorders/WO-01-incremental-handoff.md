# Work Order 01 — Incremental Handoff / 自动增量与消息选择

**目标产品：** gpt-handoff（macOS menu-bar/top-bar 工具）  
**优先级：** P0 · 功能工单，独立于 Icon Design 工单  
**发给：** Claude Desktop / Claude Code 本地 Agent  
**起点：** 2026-10-16；请先检查实际 repo、既有 docs/ADR 与运行状态，不假定本文中的路径或 API 已存在。

## 使命与产品边界

工具将 ChatGPT 的来源会话（多轮 user/assistant messages，可关联附件）**填入**本地 Claude / Codex / 其他 Agent 的 composer。填入是最终确认的成功边界；**绝不自动点击 Send / Return，也不宣称模型已经读取**。只填入，不发送；外部附件下载到本地也不等于目标 Agent 已读取。

将已有“Add to Claude”扩展为智能全量/增量输入：用户多数时候只需点击一个主操作，但可以在一个轻量菜单里覆盖范围。默认自动、异常保守、手动不添负担。不要变成日志管理软件。

## 核心使用规则（默认行为）

- 新目标 conversation（或目标身份无法可靠确认）：默认 **全部**；不允许凭 app/进程 ID、窗口句柄、窗口标题、最近粘贴历史推断是同一目标会话。
- 同一 source conversation → **已验证为同一** target conversation，且存在成功填入记录：默认 **新增 N 条**。
- 范围菜单仅露出 **新增 / 全部 / 选择消息…**（可按实际内容动态隐藏不适用项）；用户随时覆盖，不把覆盖永久保存成神秘偏好。
- 多个 source conversation 被选中时：每个 source × target 的日志独立记录；按用户选择的对话与消息顺序组合，不默认跨来源去重。
- 目标 conversation ID 不可可靠读取时，应诚实降级到全量；若提供「手动认领这仍是旧目标会话」，必须是一次明确、可见的用户确认且有可取消的对应关系。无法持续侦测切换时不宣称自动增量可靠。
- 重复点击同一次 handoff：已写入且内容未变时，避免无提示再插入；允许明确 **重填上一批**。

## 重要问题：`新增` 不等于 `未读`

事件日志应至少表达 `prepared` → `insertion_attempted` → `composer_inserted` 或 `failed/unknown`。如果没有可靠的「目标 composer 已经有完整待填文本」证据，不应将 attempt 记录为 inserted。不将 `composer_inserted` 推断为已 Send；更不推断模型记住该内容。

**推荐内部结构（可依据代码调整）：**

```json
{
  "handoff_id": "example-003",
  "source": {"provider": "chatgpt", "conversation_id": "S1"},
  "target": {"provider": "claude", "conversation_id": "T1", "identity_confidence": "verified"},
  "mode": "delta",
  "messages": [
    {"id": "m15", "content_sha256": "<calculated-hash>", "position": 15},
    {"id": "m16", "content_sha256": "<calculated-hash>", "position": 16}
  ],
  "attachments": [],
  "result": "composer_inserted",
  "inserted_at": "<local-iso8601>"
}
```

实际输出不可使用示例 hash 充真；版本变化用 content hash 检出，日志最少包含目标、实际已填入 message set、状态与时间。不要只写 `last_turn_index`，因为“选择消息…”可能跳过历史消息。优先不把原文长期复制进 log，必要缓存须隔离、有删除策略与用户可控保留期限。

**待 Agent 明确裁决并测试的语义：** 手动选择跳过第 5、7 条后，下一次自动新增是“上次成功动作之后的新消息”，还是“所有尚未填入的消息”？建议默认文案严格采用前一种“上次填入后新增”，并在范围详情中提示“此前有 X 条未曾填入”；如选择后一种，名称必须改为“未填入”，不得用“新增”误导。将裁决及测试固化在代码和 docs。

## 最小交互（尽量不增加每次点击成本）

```text
ChatGPT · 当前会话                        42 条
目标  Claude Desktop · 当前会话              ▾
范围  新增 6 条 [自动]                       ▾

                  [ Add to Claude ]
```

默认新会话时，范围自然变为 `全部 42 条`。选「选择消息…」后用一个轻量选择器展示 role、时间、消息摘要、多选、连续区间、排序/计数与附件归属；不能把抽取自 DOM 的单个“视觉 turn”当作稳定唯一单位。长对话可分批显示，但必须保留完整选择状态。插入前先显示目标与范围的精确摘要；无须每次打开多余确认弹窗。

反馈：明确区分 `已准备 / 正在填入 / 已填入 / 未能确认 / 失败`。失败可安全重试；若目标 composer 原有草稿，不得静默覆盖或直接发出消息。若需使用系统剪贴板，确保能恢复先前内容并正确处理多格式 Clipboard；附件采用下载 + hash + manifest + 路径可访问性验证，不能把本地路径误称为上传成功。

## 实现调查与边界条件

1. 首先查看当前 Handoff 中的 source extraction、session navigation、destination detection、composer paste、history/local persistence、attachment download。列出现有可用与不可用的会话标识，不预设 Claude Desktop 提供稳定 conversation ID。
2. 事件日志逻辑优先在独立模块实现（source messages、target identity、delivery receipts、scope selection），UI 只消费可靠计算结果。
3. 多窗口、窗口被替换、用户切换 ChatGPT 对话、Claude 同窗口切对话、返回旧对话、文本被编辑或重新生成、未发送草稿、失败后重复、批次中途失败都须有确定结果。
4. 为 `unknown` 设计可恢复的用户界面与日志状态；不要因为观察不到 UI 就报 success。
5. 注意 macOS Accessibility 权限、登录态隔离、对话原文隐私、文件下载安全；除既定产品功能外不新增云端回传。

## 验收矩阵（至少自动化可覆盖决策逻辑）

| 场景 | 预期 |
|---|---|
| 新 source → 新 target | 默认全量 |
| 同 source → 经确认的同 target | 仅上次成功填入后新增，范围可见 |
| 同 source → 新 target | 默认全量，旧 target 进度仍保留 |
| 同一窗口中目标 conversation 改变 | 不沿用旧 target 的增量记录 |
| 无稳定 target identity | 不猜测，默认全量或明确手动绑定 |
| 手动非连续选择 | 按源序插入选中消息；未选中不被偷偷算作已送达 |
| 文本修改/重新生成 | hash/版本检测，明确更新的处理策略 |
| 准备成功但粘贴失败 | 成功游标不前移，可重试 |
| 粘贴结果无法确认 | 状态 unknown，不能记作 inserted |
| 已填入后用户清空或未 Send | 可重填；不声称目标模型阅读 |
| 目标 composer 已有草稿 | 不静默覆盖、不自动发送 |
| 同一来源多目标并行 | mapping 相互独立 |
| 附件与消息关联 | manifest 可核验，并区分下载与目标可用 |
| 重复按主按钮 | 有去重或显式重填流程 |
| 超大输入 | 显示量级与分批选项，不隐式截断 |

## Output 优先的交付方式

- 交付可运行代码、必要迁移与测试；以实际项目工作流测试 GUI，并保留成功/失败样例截图。
- 一份简短 `decision log`：目标会话身份可否可靠识别，增量定义与手动选择的相互关系，异常降级策略。
- 一份用户实际操作说明：新目标、继续目标、切回目标、重填、手选、附件。
- 在独立分支完成并给出 commit SHA、文件变更、测试结果及未解决阻塞；**不主动合入 main**。分支名称以实际 repo 约定为准（候选 `feat/handoff-incremental-log`）。
- 完成 Output 后再安排 fresh reviewer 独立检查 GUI、隐私、失败恢复、工程质量；不要在开发阶段反复重写产出以迎合空泛的 design grammar。

## 跨工单接口

图标工单独立运行，仅共享产品语义与最后的 menu bar UI 位置。该工单不等待 icon 裁决即可完成逻辑与测试；icon 工单也不得擅自重构增量算法。
