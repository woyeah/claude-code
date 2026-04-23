# Roadmap

> 本仓库是 Claude Code CLI 的源码快照，非可构建项目（见 `README.md`）。此 Roadmap 记录在此快照之上的二次开发计划。

## Status legend

- `[ ]` 待办
- `[~]` 进行中
- `[x]` 已完成
- `[-]` 搁置 / 取消

---

## In-flight

- `[~]` **PR #1 · disable telemetry event emission**
  - 分支：`pr/disable-telemetry`
  - 范围：`services/analytics/config.ts`、`services/analytics/index.ts`、`utils/telemetry/events.ts`、`utils/telemetry/instrumentation.ts`
  - 状态：OPEN / mergeable，等待合并
  - Follow-up：待合并后观察 REPL 冒烟，确认无异常日志

---

## Planned

### 观测 / Tracing

- `[ ]` **接入自有 lang 系列系统的 OTel 通道**
  - 目标：把 LLM 调用、tool 调用、hook 执行、user prompt 的 trace 接到自家 lang 系统（LangSmith / LangFuse / LangGraph OTel exporter 等）
  - 前置依赖：PR #1 已合并（OTel 出口当前为 no-op）
  - 实施路径（走 OTel bridge，首选）：
    1. 回滚 `utils/telemetry/events.ts` 的 `logOTelEvent` / `redactIfDisabled` 为原实现
    2. 回滚 `utils/telemetry/instrumentation.ts:421-423` 的早退，恢复 `initializeTelemetry()` 主体
    3. 保留 `services/analytics/config.ts` / `services/analytics/index.ts` 的 no-op（Anthropic 1P 分析不启用）
    4. 设置 `CLAUDE_CODE_ENABLE_TELEMETRY=1` + `OTEL_EXPORTER_OTLP_ENDPOINT=<lang 系统的 OTLP 接收端>`
    5. 若 lang 系统需要自定义 resource attributes / auth header，在 `utils/telemetry/instrumentation.ts` 的 `getOtlpReaders()` 附近挂载
  - 验证点：`api_request` / `tool_decision` / `tool_result` / `hook_execution_*` / `user_prompt` 五类 event 能在 lang 系统面板里看到
  - 备选路径（lang SDK 不走 OTel 时）：不回滚 PR #1，改为在 `services/api/logging.ts`、`services/tools/toolExecution.ts`、`utils/hooks.ts`、`utils/processUserInput/processSlashCommand.tsx`、`utils/processUserInput/processTextPrompt.ts` 的原埋点位置直接调用 lang SDK callbacks

### 文档 / 贡献者体验

- `[ ]` 根据 PR #2（已合并）添加的 `CLAUDE.md`，同步补一份 `AGENTS.md` 实体内容（当前只是 `See CLAUDE.md` 的跳板）

### 可能的后续（未决）

- `[ ]` GrowthBook 通路（`services/analytics/growthbook.js` + 各处 `checkGate_CACHED_OR_BLOCKING` / `getFeatureValue_CACHED_MAY_BE_STALE`）是否需要也一并禁用或接管——取决于是否在意它的网络请求
- `[ ]` 清理 PR #1 合并后的 dead code（`initializeTelemetry` 的 unreachable 主体、`attachAnalyticsSink` 的半空实现、`eventQueue` 死状态）

---

## Done

- `[x]` **PR #2 · docs: add CLAUDE.md** — 2026-04-23 merged
