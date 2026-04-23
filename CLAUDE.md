# CLAUDE.md — Claude Code 源码快照（本地可构建）

## 工作规则

- **CLAUDE.md 是目录不是百科**：须保持在 **100 行以内**；详细内容放 `docs/` 下独立文件，这里只留指针链接
- **新建 / 搬移文档前先读 [`docs/INDEX.md`](./docs/INDEX.md)**：确认归属目录（架构参考 / 操作指南 → `docs/guides/`；roadmap / 设计文档 → `docs/plans/`）；新增文档后**回来更新索引**
- **先读 [`docs/guides/deployment.md`](./docs/guides/deployment.md) 再动构建**（`scripts/build.ts`、`package.json`、`stubs/`、`tsconfig.json`、`bunfig.toml`）；**先读 [`docs/plans/roadmap.md`](./docs/plans/roadmap.md) 再开新分支**（避免撞线上进行中的二次开发）
- **非 trivial 改动先列 ≤5 条计划，等用户确认再动手**
- **源码编辑后须 `bun run build` 验证 bundle 过**；没跑就在回复里明说"未本地构建"，**严禁写 "passes tests" / "builds cleanly"**（本仓库无测试 / 格式化 / lint）
- `src/` 下不要 `ls -R` / `rg --files` 整树——`src/main.tsx` 单文件 ~785KB，用 `Grep` + glob / type / path 缩范围
- 中文文档 UTF-8 无 BOM；代码 ESM import 带 `.js` 后缀、2 空格缩进

## 项目概述

Claude Code CLI（Anthropic 官方 AI 编码 CLI）的**泄露源码 + 本地构建脚手架**。源码来自 2026-03-31 的 npm sourcemap 泄露（见 `README.md` 背景与彩蛋盘点）。我们在快照上加了 `package.json` / `tsconfig.json` / `scripts/build.ts` / `stubs/ant-packages/`，用 Bun 原生 `--compile` 产出单文件可执行。外部 build `USER_TYPE='external'`，所有 Anthropic 内部代码路径 DCE。

## Build / Run

```bash
bun install                                       # 装依赖（含 8 个 file: stub 包 + sharp/turndown 真包）
bun run build                                     # → ./dist/cli.exe (Windows) / ./dist/cli (*nix), ~130 MB
./dist/cli.exe --version                          # 0.1.0 (Claude Code)
./dist/cli.exe -p "hi" --output-format text       # 非交互，需 ANTHROPIC_API_KEY 或先 `claude login`
bun run build:nocompile                           # 只出 bundle 不 --compile，便于 debug
bun run build:dev                                 # dev 版本号带时间戳
```

- `scripts/build.ts` 里 `ENABLED_FEATURES = []` 默认全关；要开 `BUDDY` / `KAIROS` / `COORDINATOR_MODE` 等就加到数组里重 build
- `stubs/ant-packages/` = 8 个 stub（3 个 `@ant/*` 真 404 + 5 个 `*-napi` Anthropic 占位空壳）；真包用法见 [`docs/guides/deployment.md § stub 策略`](./docs/guides/deployment.md)
- `scripts/build.ts` 里 `EXTERNALS` 只放**不会被 require 的**（DCE 掉的 provider SDK、OTLP exporter 等）；真装过的包放 external 会在运行期找不到模块

## 技术栈

Bun ≥ 1.3（bundle + runtime + `--compile`）· TypeScript/TSX · React 19 + Ink（终端 UI）· `@anthropic-ai/sdk` · MCP（`@modelcontextprotocol/sdk`）· GrowthBook（运行时 feature gate）· OpenTelemetry（默认禁用，见 roadmap）

## 导航

- **[`docs/INDEX.md`](./docs/INDEX.md)** — 所有 `docs/` 文件的目录索引，新建文档先看
- **[`docs/guides/deployment.md`](./docs/guides/deployment.md)** — 构建所需一切：命令、stub、feature flag、排错
- **[`docs/guides/architecture.md`](./docs/guides/architecture.md)** — 运行时全景（C4 层 + "按问题定位代码"）
- **[`docs/plans/roadmap.md`](./docs/plans/roadmap.md)** — 二次开发计划；开新分支前必看
- **`README.md`** — 泄露 backstory + 十几个彩蛋系统导读（BUDDY / KAIROS / ULTRAPLAN / Dream / Undercover / Coordinator / Penguin Mode / 40+ 工具注册表 / beta 头列表）
- **`AGENTS.md`** — 跳板指回本文件

## 源码拓扑

所有源码在 `src/` 下。**真入口是 `src/entrypoints/cli.tsx`**（末尾自调 `void main()`），不是 `src/main.tsx`——后者只 `export main()` 没人调，`bun src/main.tsx` 会静默退 0。

```
cli.tsx → main.tsx::main()
  → getCommands(cwd)                    (src/commands.ts)
  → getTools(ctx)                       (src/tools.ts)
  → createStore(getDefaultAppState())   (src/state/AppStateStore.ts)
  → launchRepl(...)                     (src/replLauncher.tsx)
    → QueryEngine.submitMessage()       (src/QueryEngine.ts)
      → tool loop / AgentTool / MCP / Task 系统
```

**两个独立平面**（易混）：
- **Command plane**（`src/commands.ts` + `src/commands/`）—— 用户触发的 `/slash` 命令，**控制面**
- **Tool plane**（`src/tools.ts` + `src/tools/` + `src/Tool.ts`）—— 模型在 query 过程中调用的能力，**执行面**

两者都**不是静态表**，运行时按 cwd / permission / feature flag / plugin / skill / MCP 状态装配。"为什么模型能/不能调 X" 几乎永远是 `src/tools.ts` 的装配过滤器问题，不是 tool 本体代码问题。详见 [`docs/guides/architecture.md`](./docs/guides/architecture.md)。

## 关键入口文件

- `src/main.tsx` (~785KB) — composition root；分派运行模式（REPL / headless SDK / assistant / remote / direct-connect）
- `src/commands.ts` — 合并内置命令 + 捆绑 skill + `src/skills/` + workflow + plugin 命令 + 动态 skill
- `src/tools.ts` — `getAllBaseTools()` 是 built-in tool 真源；`getTools()` / `assembleToolPool()` 过滤与合并
- `src/QueryEngine.ts` — 会话引擎（session-level 状态：`mutableMessages`、`readFileState`、`permissionDenials`、`totalUsage`、`discoveredSkillNames`）
- `src/state/AppStateStore.ts` — 全局运行时状态（tasks / permissions / MCP / plugins / agent / bridge / remote 都在这，不是单纯 UI store）
- `src/remote/RemoteSessionManager.ts` — 远程模式协议客户端（WS 订阅 + HTTP POST + `control_request`/`control_response`）

## Feature 门控（动代码前必看）

- `feature("FLAG")` 来自 Bun 的 `bun:bundle`，**编译期常量折叠 + DCE**。已知 flag：`PROACTIVE`/`KAIROS`、`BRIDGE_MODE`、`DAEMON`、`VOICE_MODE`、`WORKFLOW_SCRIPTS`、`COORDINATOR_MODE`、`TRANSCRIPT_CLASSIFIER`、`BUDDY`、`HISTORY_SNIP`、`EXPERIMENTAL_SKILL_SEARCH`、`NATIVE_CLIENT_ATTESTATION`、`CHICAGO_MCP`
- `USER_TYPE === 'ant'` 门控 Anthropic 内部（staging API、Undercover、`/security-review`、`ConfigTool`、`TungstenTool`、prompt dump）；外部 build 全 DCE
- 运行时用 **GrowthBook**，大量调用点是 `getFeatureValue_CACHED_MAY_BE_STALE()` 非阻塞——**stale 是设计上允许的**，不要"改成阻塞"
- `tengu_*` 是项目内部代号，大多数 flag / analytics 事件的前缀

## 按问题定位代码

| 问题 | 从哪找 |
|---|---|
| 某 command 显示/消失 | `src/commands.ts` → `src/commands/<name>/` → `src/skills/` / `src/plugins/` |
| 模型能/不能调某 tool | `src/tools.ts`（装配过滤器） → `src/Tool.ts` → `src/tools/<ToolName>/` |
| 某一轮对话走向 | `src/QueryEngine.ts` → `src/query.ts` → `src/utils/processUserInput/` |
| 系统 prompt 内容 | `src/constants/prompts.ts` + `src/utils/systemPrompt.ts::buildEffectiveSystemPrompt`（详见 [`docs/guides/system-prompt-structure.md`](./docs/guides/system-prompt-structure.md)） |
| 子 agent 前后台/恢复 | `src/tools/AgentTool/` → `src/tasks/LocalAgentTask/` → `src/tasks/RemoteAgentTask/`（详见 [`docs/guides/agent-subsystem.md`](./docs/guides/agent-subsystem.md)） |
| Remote / bridge / viewer | `src/remote/RemoteSessionManager.ts` → `src/remote/SessionsWebSocket.ts` → `src/main.tsx` remote 分支 |
| Telemetry / OTel | `src/services/analytics/` + `src/utils/telemetry/`（当前 no-op，见 [`docs/plans/roadmap.md`](./docs/plans/roadmap.md)） |

## 编辑约定

- **不要重命名顶层模块**——`src/main.tsx` / `src/commands.ts` / `src/tools.ts` 有装配级 import，可能无声炸
- 小而集中的 patch 优先；大重构先更新 [`docs/plans/roadmap.md`](./docs/plans/roadmap.md)
- Windows + Bash（Unix 语法，正斜杠、`/dev/null` 不是 `NUL`）；PowerShell 7 在 cmdlet 更简单时用；优先 Grep / Glob / Read 而非 shell-out
