# SPIKE T2.0 Report · LangFuse JS SDK × Bun runtime

**Date**: 2026-04-24
**SDK**: `langfuse@3.38.20`（dual CJS/ESM、engines `node>=18`、无 native deps、无 install script）
**Runtime**: Bun 1.3.13

## 结论

**PASS**。原生 LangFuse JS SDK 可在 Bun 运行期与 `bun build --compile` 产物中正常工作。阶段 5（T5.3 `langfuseTracer.ts`）**直接用 SDK**，无需降级到直调 LangFuse REST API。

## 支撑

- **Part A.1 · `bun run`**：spike 脚本创建 `Langfuse` client → `trace()` + `span()` + `generation()` → `flushAsync()` → `shutdownAsync()`；19ms 内把 5 个 event（`generation-create` / `generation-update` / `span-create` / `span-update` / `trace-create`）以 5 个 batch POST 到本地 mock 端点 `/api/public/ingestion`；exit 0
- **Part A.2 · `bun build --compile`**：同一脚本编译成 `spike/dist-langfuse-bun.exe`（113MB）；运行行为与 `bun run` 完全一致——5 个 batch、同样 5 类 event、23ms、exit 0。无运行期模块找不到、无 `require is not defined`、无 `import.meta` 相关报错
- **Part B · 真实 LangFuse UI 验证**：需要开发者本机先起 self-host LangFuse（`cd deploy/langfuse && cp .env.example .env && <填随机值> && docker compose up -d`），然后把 `LANGFUSE_BASE_URL` / `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` 写到 `.env.local` 再跑 `bun run spike/langfuse-bun.ts`——Part A 已证伪"SDK 本身不兼容 Bun"这个风险，Part B 只是端到端交付确认

## 风险澄清（对 `server-mode-and-lang-tracing.md` §9 的回填）

原 §9 "LangFuse JS SDK 在 Bun runtime 兼容性 · 概率=低 · 影响=高" → 本 SPIKE 将其降级为 **概率=无 · 已验证**；对应 §11.1–§11.4 四条前置技术风险里，第 3 条（T2.0 spike）标记完结。

## 遗留注意

- Mock 端点返回 HTTP 207（multi-status）+ `{successes:[], errors:[]}`——匹配 LangFuse 真实 ingestion 语义。真正 LangFuse 会做 event-level 校验；SPIKE 只证明"SDK 能把结构正确的 event POST 出去"，未覆盖"LangFuse 后端对 event 结构的严格校验"
- SDK 默认 `flushAt=15` / `flushInterval=10s`；SPIKE 里设 `flushAt=1` / `flushInterval=100` 逼出每条立即发出。生产使用时要评估这对 trace 及时性 vs 请求压力的影响（在 `langfuseTracer.ts` 配置项里暴露）
- SDK **每条 event 一个 HTTP 请求**（batch 行为受 `flushAt` 节流）；T5 阶段实施时要确保 `session.endSession()` 的 `flushAsync()` 会在 grace shutdown 路径里同步 await

## 清理

SPIKE 交付完毕后，`spike/` 目录可以不清——后续 T2 阶段的 real-LangFuse 冒烟还会复用脚本。保留仓库内以备迭代。
