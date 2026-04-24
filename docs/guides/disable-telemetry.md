# 禁用遥测：patch 总览

本仓库目标是让这份快照 build 出的 `./dist/cli.exe` **默认静默** —— 不往任何遥测 / 分析 / 指纹端点发请求，不依赖用户设 env。该目标通过若干 PR 分阶段达成，本文把"问题 → 解决 PR → 当前状态"汇总成一张表。

**当前状态**：3 个 PR 已 merge，PR #7 进行中。

## 一图汇总（按端点）

| # | 外发端点 | 类型 | 解决 PR | 实现方式 |
|---|---|---|---|---|
| 1 | `api.anthropic.com/api/event_logging/batch` | 1P 事件批上报 | **#1** | `isAnalyticsDisabled()` 硬编码 `true` → `is1PEventLoggingEnabled` 级联 false |
| 2 | `api.anthropic.com/api/claude_code/metrics` | BigQuery 指标 exporter | **#1** | `initializeTelemetry()` 早 return，exporter 从未装配 |
| 3 | `api.anthropic.com/api/claude_code/organizations/metrics_enabled` | metrics opt-out 查询 | **#1**（间接） | 唯一 caller 是 bigqueryExporter，间接封 |
| 4 | `http-intake.logs.us5.datadoghq.com/api/v2/logs` | Datadog 日志 | **#1** | `initializeDatadog` 顶 `isAnalyticsDisabled` 阻断 |
| 5 | OpenTelemetry OTLP exporters（events / metrics / traces） | 3P OTel 外发 | **#1** | `isTelemetryEnabled()` 硬编码 `false` + `initializeTelemetry()` 早 return |
| 6 | `api.anthropic.com/` (GrowthBook 客户端) | 特性标志拉取 + 6h/20m 轮询 | **#6** | `initializeGrowthBook()` 早 return `null`；`setupPeriodicGrowthBookRefresh()` 早 return |
| 7 | `registry.npmjs.org` (npm view) | 自动更新 — npm 版本轮询 | **#6** | `getLatestVersion()` 早 return `null` |
| 8 | `storage.googleapis.com/claude-code-dist-…/claude-code-releases` | 自动更新 — GCS 版本桶 | **#6** | `getLatestVersionFromGcs()` 早 return `null` |
| 9 | `errorLogSink.logError(...)` (Sentry-like) | 错误上报 | **#6** | `logError` 只保留 in-memory log，不再写 sink |
| 10 | `api.anthropic.com/api/web/domain_info` | WebFetch 域名预检 | **#6** | preflight if 块整段移除 |
| 11 | `x-anthropic-billing-header: cc_version.<fingerprint>; cc_entrypoint=…` | 客户端归因 header / 指纹 | **#6** | `getAttributionHeader()` 返回 `''`（空字符串被调用点 `.filter(Boolean)` / 三元 null 吞掉） |
| 12 | `api.anthropic.com/api/claude_cli_feedback` | `/bug` · `/feedback` 上传 transcript | **#6** | `submitFeedback()` 早 return `{ success: false }` |
| 13 | `api.anthropic.com/api/claude_code_shared_session_transcripts` | transcript 分享 | **#6** | `submitTranscriptShare()` 早 return `{ success: false }` |
| 14 | `getOrCreateUserID` 随机 32-byte hex 落盘 | 持久化设备标识 | **#6** | 返回常量 `'local'`，不写盘 |
| 15 | `api.anthropic.com/mcp-registry/v0/servers?...` | 官方 MCP 注册表启动预取 | **#7** | `prefetchOfficialMcpUrls()` 早 return |
| 16 | `downloads.claude.ai/claude-code-releases/plugins/claude-plugins-official` | 官方插件 marketplace 启动自动安装 | **#7** | `checkAndInstallOfficialMarketplace()` 早 return skip |

## 按 PR 分组

### PR #1 — [`disable telemetry event emission`](https://github.com/woyeah/c-agent/pull/1)

封掉"分析 sink + OpenTelemetry 管道"的核心二元组。

- `src/services/analytics/config.ts` — `isAnalyticsDisabled()` / `isFeedbackSurveyDisabled()` 硬编码 `true`
- `src/services/analytics/index.ts` — `attachAnalyticsSink` / `logEvent` / `logEventAsync` 全 stub
- `src/utils/telemetry/events.ts` — `logOTelEvent` no-op；`redactIfDisabled` 永远返回 `<REDACTED>`
- `src/utils/telemetry/instrumentation.ts` — `isTelemetryEnabled()` 返 `false`；`initializeTelemetry()` 早 return

**间接封住的端点**：#1～#5（Datadog / 1P event logging / bigquery 指标 / metricsOptOut / OTel exporters 全链）

### PR #6 — [`hardcode-off 8 outbound telemetry / data channels`](https://github.com/woyeah/c-agent/pull/6)

审计发现 #1 之后仍有 8 条通道在默认 env 下外发。全部 hardcode 关掉。

- `src/services/analytics/growthbook.ts` — `initializeGrowthBook` / `setupPeriodicGrowthBookRefresh` 早 return
- `src/utils/autoUpdater.ts` — `getLatestVersion` / `getLatestVersionFromGcs` 早 return `null`
- `src/utils/log.ts` — `logError` 只保留 in-memory log
- `src/tools/WebFetchTool/utils.ts` — preflight if 块移除
- `src/constants/system.ts` — `getAttributionHeader` 返回 `''`
- `src/components/Feedback.tsx` — `submitFeedback` 早 return
- `src/components/FeedbackSurvey/submitTranscriptShare.ts` — `submitTranscriptShare` 早 return
- `src/utils/config.ts` — `getOrCreateUserID` 返回常量，不落盘

**对应端点**：#6～#14

### PR #7 — [`hardcode-off startup MCP registry + official marketplace auto-install`](https://github.com/woyeah/c-agent/pull/7)

补审计发现的 2 条启动期 fire-and-forget 通道。

- `src/services/mcp/officialRegistry.ts` — `prefetchOfficialMcpUrls` 早 return
- `src/utils/plugins/officialMarketplaceStartupCheck.ts` — `checkAndInstallOfficialMarketplace` 早 return skip

**对应端点**：#15～#16

## 已确认"走不到"的代码路径（不需要改）

这些因为 build-time DCE 或需要特殊运行条件，在我们这份 build 下不会触发：

| 路径 | 为何走不到 |
|---|---|
| `src/services/api/claude.ts:301` `anti_distillation: ['fake_tools']` 注入 | 首项条件 `feature('ANTI_DISTILLATION_CC')` 在 `ENABLED_FEATURES=[]` 下编译期折成 false → 整段 DCE |
| `CONNECTOR_TEXT` 服务端摘要签名（beta header + content block 类型） | `feature('CONNECTOR_TEXT')` 为 false + 分支要求 `USER_TYPE==='ant'`（我们 `--define` 成 `external`） |
| `NATIVE_CLIENT_ATTESTATION` 的 Zig 哈希注入（`cch=` 字段） | 需要 Anthropic 魔改过的 Bun 提供 Zig attestation hook，社区 Bun 没这段 native 代码；且 flag 也是关的 |
| `api-staging.anthropic.com` 全系 | 需要 `USER_TYPE==='ant'`，外部 build DCE |
| `src/utils/nativeInstaller/**` 所有 GCS / Artifactory 端点 | 我们用 `bun --compile`，npm 安装 / 原生 installer 整条路径不执行 |
| `api.anthropic.com/api/oauth/claude_cli/*` · `platform.claude.com/oauth/*` | 仅 OAuth 登录流程；我们用 `ANTHROPIC_AUTH_TOKEN` Bearer 直连，不走 OAuth |
| `mcp-proxy.anthropic.com` | 仅 remote MCP 场景 |
| `claude.ai/api/desktop/*` | 仅 desktop handoff 命令 |

## 不算外发的字符串

`src/` 下还有大量 `code.claude.com/docs/*` / `anthropic.com/legal/*` / `claude.ai/settings/*` / `support.*` / `platform.claude.com/docs/*` 等 URL —— 全是写给用户看的文档链接或错误消息中的链接，不是自动 HTTP 请求。

## 核心 LLM API（必走，但可重定向）

`api.anthropic.com` 主 `/v1/messages` 端点 —— 走 `ANTHROPIC_BASE_URL` 可重定向到 CLIProxyAPI，详见 [`./using-cliproxy.md`](./using-cliproxy.md)。

## 不 fork 的替代方案（env-only）

如果你想零代码改动达到类似静默效果（但不如 hardcode 硬）：

```bash
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1     # 伞：GrowthBook / MCP registry / metricsOptOut / referral / grove / 等
export CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1          # 反馈调查弹窗
export CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1  # 启动时自动装 plugins marketplace
export DISABLE_TELEMETRY=1                             # 冗余（#1 已 hardcode）
export DISABLE_ERROR_REPORTING=1                       # 冗余（#6 已 hardcode）
export DISABLE_AUTOUPDATER=1                           # 冗余（#6 已 hardcode）
```

加 `settings.json`：

```json
{ "skipWebFetchPreflight": true, "autoUpdates": false }
```

`skipWebFetchPreflight` 只能走 settings.json，官方 env 伞不覆盖。

## 外部参考

- [Claude Code Data usage](https://code.claude.com/docs/en/data-usage)
- [Claude Code Settings reference](https://code.claude.com/docs/en/settings)
- [Claude Code OpenTelemetry monitoring](https://code.claude.com/docs/en/monitoring-usage)
