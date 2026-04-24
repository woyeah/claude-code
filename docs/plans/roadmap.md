# Roadmap

> 本仓库是 Claude Code CLI 的源码快照，非可构建项目（见 `README.md`）。此 Roadmap 是**工作台**——所有在此快照上的二次开发任务都登记在这里，按"进行中 / 待办 / 已完成"三档追踪。

## Status legend

- `[ ]` 待办
- `[~]` 进行中
- `[x]` 已完成
- `[-]` 搁置 / 取消

---

## In-flight

（暂无）

---

## Planned

### 观测 / Tracing · Server Mode（A2+S2+M2+P3+L2+F2）

设计 = [`plans/server-mode-and-lang-tracing.md`](./server-mode-and-lang-tracing.md) · 任务拆分 = [`plans/server-mode-tasks.md`](./server-mode-tasks.md)（每条任务含 usecase + 验证方法）

**前置阻塞**（Day 1 就开工）：

- `[x]` T0.1 · **基建** 部署 self-hosted LangFuse 实例 + `docs/guides/langfuse-setup.md`（Docker Compose 栈交付，见 [`../guides/langfuse-setup.md`](../guides/langfuse-setup.md)；实际 `docker compose up` 由开发者本机执行）
- `[x]` T0.2 · LangFuse 凭证写入 `.env.local` + secrets 约定（已在 [`docs/guides/deployment.md`](../guides/deployment.md#本地凭证约定) 加一节指回 [`langfuse-setup.md §4`](../guides/langfuse-setup.md#4--把凭证写进仓库)）
- `[ ]` T2.0 · **SPIKE** LangFuse JS SDK 在 Bun runtime 冒烟
- `[ ]` T3.0 · **BLOCKER** `bootstrap/state.ts` AsyncLocalStorage 改造
- `[ ]` TE.0 · T3.0 改造后立即跑 CLI REPL 回归冒烟

**Phase 1 · 双入口脚手架**（S 合计）

- `[ ]` T1.1 · 新增 `src/entrypoints/server.tsx` fast-path 入口
- `[ ]` T1.2 · 新增 `src/server/serverMain.ts` 占位
- `[ ]` T1.3 · 新增 `src/server/config.ts` env loader
- `[ ]` T1.4 · 参数化 `scripts/build.ts` TARGETS map
- `[ ]` T1.5 · `package.json` 加 `build:server` / `build:all`
- `[ ]` T1.6 · 更新 `deployment.md` 两个 build target 章节

**Phase 2 · HTTP/WS 单会话**（L 合计）

- `[ ]` T2.1 · `src/server/directConnectProtocol.ts` wire 类型镜像
- `[ ]` T2.2 · `src/server/httpServer.ts` Bun.serve + 路由
- `[ ]` T2.3 · `src/server/serverSession.ts` 单会话容器
- `[ ]` T2.4 · `src/server/controlBridge.ts` 双向 control 翻译
- `[ ]` T2.5 · `serverMain.ts` 装配 + SIGINT/SIGTERM 优雅关闭
- `[ ]` T2.6 · Bearer token 鉴权中间件
- `[ ]` T2.7 · WS 出站单 writer 串行化
- `[ ]` T2.8 · WS 断连期 pending + grace period

**Phase 3 · 多会话 + 权限双模式**（L 合计）

- `[ ]` T3.2 · `sharedAssembly.ts` 共享装配（**实现先于 T3.1**）
- `[ ]` T3.1 · `sessionRegistry.ts` 多 session 管理（扩展 T2.5 SIGINT handler）
- `[ ]` T3.3 · `permissionPolicy.ts` 规则引擎
- `[ ]` T3.4 · `permissionHandler.ts` interactive/policy 分派
- `[ ]` T3.5 · `serverSession` 注入 permissionHandler
- `[ ]` T3.6 · MCP 池引用计数 or MVP fallback（§11.4）
- `[ ]` T3-Smoke · 两 session 并发 + 权限 e2e

**Phase 4 · DCE 收紧**（M 合计）

- `[ ]` T4.1 · `src/utils/buildTarget.ts::IS_SERVER_BUILD`
- `[ ]` T4.2 · `bun build --analyze` 依赖审计
- `[ ]` T4.3 · 漏点 A · `messageSelection.ts` pure-logic
- `[ ]` T4.4 · 漏点 B · tool `.logic.ts` + `.ui.tsx` 拆分
- `[ ]` T4.5 · `scripts/build.ts` server external guardrail（禁止 Ink external 兜底）
- `[ ]` T4.6 · Plugin Ink shim fallback（条件触发，T4.2 扫到 plugin Ink 才做）
- `[ ]` T4-Smoke · bundle 体积 ≤85MB + 启动无 Ink escape

**Phase 5 · LangFuse 埋点**（L 合计）

- `[ ]` T5.1 · `services/lang/tracer.ts` 接口
- `[ ]` T5.2 · `noopTracer.ts`
- `[ ]` T5.3 · `langfuseTracer.ts` LangFuse SDK 实现
- `[ ]` T5.4 · `redactor.ts` 独立脱敏（§11.2）
- `[ ]` T5.5 · `context.ts` ALS 贯穿 submitMessage
- `[ ]` T5.6 · `propagation.ts` trace header 序列化
- `[ ]` T5.7 · 埋点 `services/api/logging.ts`（LLM generation）
- `[ ]` T5.8 · 埋点 `services/tools/toolExecution.ts`（tool span）
- `[ ]` T5.9 · 埋点 `utils/hooks.ts`（hook span）
- `[ ]` T5.10 · 埋点 `processUserInput/*`（user_prompt span）
- `[ ]` T5.11 · 埋点 `tools/AgentTool/runAgent.ts`（agent 子树根）
- `[ ]` T5.12 · 埋点 `QueryEngine.ts`（query_turn span）
- `[ ]` T5.13 · 埋点 `server/permissionHandler.ts`（permission event）
- `[ ]` T5.14 · LLM 出站 header 注入（gateway 同 trace）
- `[ ]` T5.15 · Tracer metadata 避开 `getAttributionHeader`（§11.3）
- `[ ]` T5-Smoke · LangFuse 面板全链路 trace 树

**跨阶段 · 端到端验证**

- `[ ]` TE.0 · T3.0 改造后 CLI REPL 回归冒烟（尽早，不能拖到最后）
- `[ ]` TE.1 · 并发 3 session 不串
- `[ ]` TE.2 · interactive → deny
- `[ ]` TE.3 · policy 直接决策
- `[ ]` TE.4 · WS 断连 + pending + grace timeout
- `[ ]` TE.5 · CC + gateway 一棵 trace 树（`traceparent`）
- `[ ]` TE.6 · LangFuse 宕机降级
- `[ ]` TE.7 · SIGINT/SIGTERM 最后 flush

前置：PR #1 / #6 / #7 已合并（当前状态）。**开实施分支前先过 [`plans/server-mode-and-lang-tracing.md`](./server-mode-and-lang-tracing.md) §11 的 4 条技术风险**。

### 观测 / Tracing · 备选路径

- `[ ]` **接入自有 lang 系列系统的 OTel 通道**（备选，若 LangFuse 原生 SDK 方案受阻时回退）
  - 目标：把 LLM 调用、tool 调用、hook 执行、user prompt 的 trace 接到自家 lang 系统（LangSmith / LangFuse / LangGraph OTel exporter 等）
  - 前置依赖：server-mode 方案被否决 or LangFuse SDK 在 Bun `--compile` 下不可用
  - 实施路径（走 OTel bridge）：
    1. 回滚 `utils/telemetry/events.ts` 的 `logOTelEvent` / `redactIfDisabled` 为原实现
    2. 回滚 `utils/telemetry/instrumentation.ts:421-423` 的早退，恢复 `initializeTelemetry()` 主体
    3. 保留 `services/analytics/config.ts` / `services/analytics/index.ts` 的 no-op（Anthropic 1P 分析不启用）
    4. 设置 `CLAUDE_CODE_ENABLE_TELEMETRY=1` + `OTEL_EXPORTER_OTLP_ENDPOINT=<lang 系统的 OTLP 接收端>`
    5. 若 lang 系统需要自定义 resource attributes / auth header，在 `utils/telemetry/instrumentation.ts` 的 `getOtlpReaders()` 附近挂载
  - 验证点：`api_request` / `tool_decision` / `tool_result` / `hook_execution_*` / `user_prompt` 五类 event 能在 lang 系统面板里看到

### 文档 / 贡献者体验

- `[ ]` 根据 PR #2（已合并）添加的 `CLAUDE.md`，同步补一份 `AGENTS.md` 实体内容（当前只是 `See CLAUDE.md` 的跳板）

### 可能的后续（未决）

- `[ ]` GrowthBook 通路（`services/analytics/growthbook.js` + 各处 `checkGate_CACHED_OR_BLOCKING` / `getFeatureValue_CACHED_MAY_BE_STALE`）是否需要也一并禁用或接管——取决于是否在意它的网络请求
- `[ ]` 清理 PR #1 合并后的 dead code（`initializeTelemetry` 的 unreachable 主体、`attachAnalyticsSink` 的半空实现、`eventQueue` 死状态）

---

## Done

- `[x]` **PR #2 · docs: add CLAUDE.md** — 2026-04-23 merged（`ff8c2b8`）
- `[x]` **PR #3 · docs: add ROADMAP.md + CLAUDE.md 链接** — merged（`e2834b7`）
- `[x]` **PR #4 · build: Bun-native 本地构建脚手架** — merged（`b3f1c9c`）
- `[x]` **PR #1 · disable telemetry event emission** — merged（`cfa09bc`），neutered `logOTelEvent` / `redactIfDisabled` / `initializeTelemetry`
- `[x]` **PR #5 · docs: docs/ hierarchy + INDEX.md + CLAUDE.md rewrite + CLIProxyAPI guide** — merged（`1d71c9f`）
- `[x]` **PR #6 · hardcode-off 8 outbound telemetry / data channels** — merged（`62f7a1a`）
- `[x]` **PR #7 · hardcode-off startup MCP registry + official marketplace auto-install** — merged（`82953ae`）
- `[x]` **docs: server-mode + LangFuse tracing 设计 + 5 阶段实施计划** — committed（`05107d3` → `f3768f8` → `3f17199`）；含 Plan agent 独立计划交叉评审后的合并版
- `[x]` **feat: docs-audit skill** — committed（`7dc578f`），项目级 skill，commit 前自检 CLAUDE.md / INDEX.md 渐进式披露一致性
- `[x]` **docs(CLAUDE.md): add server-mode spec to navigation** — committed（`3147f5c`）
