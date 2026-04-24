# docs/INDEX.md

这是本仓库 `docs/` 目录的索引。**新建 / 搬移文档前先在这里确认归属目录**，写完后回来更新索引条目。

## 目录规则

| 目录 | 放什么 |
|---|---|
| `docs/guides/` | 架构参考 · 操作指南 · stub / 构建说明 · 工具与流程拆解（读后能干活的内容） |
| `docs/plans/` | Roadmap · 设计文档 · 二次开发计划 · 里程碑（"要往哪里走"的内容） |

根目录只留 4 个文件：`README.md`（泄露 backstory）· `CLAUDE.md`（本仓库 agent 规则 / 目录指针）· `AGENTS.md`（跳板）· 本 `docs/INDEX.md`。新内容一律放 `docs/` 子目录下，**不再往根目录堆 md**。

## guides（操作 & 参考）

- [`guides/deployment.md`](guides/deployment.md) — Bun `--compile` 本地构建：一行命令、`scripts/build.ts` 逐行解释、stub 策略（8 个 file: 包）、feature flag 开关、排错速查表
- [`guides/using-cliproxy.md`](guides/using-cliproxy.md) — 用 CLIProxyAPI 代理把本地 build 接到 GPT-5.x / Gemini / Claude Max 订阅；env 设置、排错、Anthropic 特性差异清单
- [`guides/architecture.md`](guides/architecture.md) — 运行时全景图：启动装配 → REPL → QueryEngine → tools / agents / tasks；含 C4 层次图与"按问题定位代码"索引
- [`guides/agent-subsystem.md`](guides/agent-subsystem.md) — `AgentDefinition` / `AgentTool` / `runAgent` / `Task` 四件套怎么组合
- [`guides/agent-flow-examples.md`](guides/agent-flow-examples.md) — 用具体例子讲"用户输入 → 意图识别 → 主 agent → 子 agent / tools"的流动
- [`guides/intent-recognition.md`](guides/intent-recognition.md) — Claude Code 的意图识别**不是单独模块**而是分层路由，这份讲每一层在哪
- [`guides/system-prompt-structure.md`](guides/system-prompt-structure.md) — 主 system prompt 的模块化组装：`constants/prompts.ts` 分段 + `utils/systemPrompt.ts::buildEffectiveSystemPrompt` 合并
- [`guides/disable-telemetry.md`](guides/disable-telemetry.md) — 禁用遥测的 patch 总览：PR #1 / #6 / #7 各自封哪些通道，哪些因 DCE / 特殊条件不用改

## plans（要做的事）

- [`plans/roadmap.md`](plans/roadmap.md) — 在本快照上的二次开发计划：`[~]` PR #1 禁用 telemetry 事件 · `[ ]` 接自家 lang 系统 OTel · 文档跟进；**开新分支前必看**

## 约定

- 文件名：小写 + 连字符（`agent-subsystem.md`，不是 `AGENT_SUBSYSTEM.md`）
- 文档内部交叉引用用相对路径（`./agent-subsystem.md` 或 `../plans/roadmap.md`）
- 文档内容为中文；代码标识符保持英文原样
- 更新一份文档后，若新增 / 改标题 / 改文件名，**必须回来改这份 INDEX**
