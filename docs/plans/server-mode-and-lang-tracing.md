---
name: Server Mode + LangFuse Tracing
type: design + implementation-plan
status: draft
date: 2026-04-24
scope:
  - 新 entrypoint `src/entrypoints/server.tsx` 暴露本地 HTTP + WS server
  - 沿用上游 direct-connect WS wire format（复用 `src/server/directConnectManager.ts` 协议定义）
  - 多会话单进程模型（每会话独立 QueryEngine；共享 base tool 定义 / MCP 连接池 / plugin cache，按 session 装配可见 tool pool）
  - 权限处理双模式（`interactive` / `policy`，默认 policy）
  - LangFuse 原生 SDK 埋点（LLM / tool / agent / hook / user_prompt / permission）
  - 新 build target `dist/cli-server`
out-of-scope:
  - 前端 UI（将来另起 spec）
  - 鉴权 / 多租户 RBAC（本 spec 只做 Bearer token 白名单）
  - 回滚 PR#1 的 OTel 通道（明确不做）
  - Coordinator mode / Bridge mode 的 trace（单独 spec）
related:
  - docs/plans/roadmap.md
  - docs/guides/architecture.md
  - docs/guides/disable-telemetry.md
  - memory: lang SDK 对接点与 telemetry PR 的取舍
---

# Server Mode + LangFuse Tracing

本文档合并了 brainstorming 阶段的设计决策与实施计划，是 `cli-server` entrypoint + LangFuse 埋点二开工作的**唯一权威文档**。章节结构：§1–§6 定设计契约、§7 列阶段执行序列、§8–§12 覆盖验证 / 风险 / 排除 / 必须前置解决的技术风险 / 附录。

## 1. 目标与动机

把 Claude Code 这份快照从"**终端优先的 AI Agent**"扩展成"**可被外部系统通过 API 调用的 Agent runtime**"，同时建立完整的可观测性：把所有 LLM 调用、tool 调用、agent 派生、hook 执行、用户 prompt、权限决策送到 LangFuse，以便同时监测 Claude Code 内部行为和外部接入的 LLM gateway。

**用户决策路径（2026-04-24 brainstorm 结果）**：

| 维度 | 备选 | 锁定 |
|---|---|---|
| API 化方向 | A（本地 HTTP/WS server）· B（Agent SDK 库化）· C（OpenAI 兼容层）· D（远程 agent 后端） | **A** |
| 协议形态 | A1（自定义）· A2（复用上游 direct-connect）· A3（OpenAI 兼容） | **A2** |
| 进程边界 | S1（同进程子命令）· S2（独立 entrypoint）· S3（独立包） | **S2** |
| 多会话模型 | M1（单会话）· M2（共享进程多会话）· M3（每会话独立进程） | **M2** |
| 权限模型 | P1（全透传客户端）· P2（全 server 策略）· P3（per-session 切换） | **P3，默认 policy** |
| Lang 后端 | L1（LangSmith）· L2（LangFuse）· L3（LangGraph，排除）· L4（LangChain callback）· L5（纯 OTel） | **L2** |
| 接入形态 | F2（原生 SDK + 接口抽象）· F3（统一 OTel） | **F2** |

**关键约束**：

- 保持 PR#1/#6/#7 的 no-op 状态不变（见 `docs/guides/disable-telemetry.md`）。lang 埋点走**业务层直接挂钩**，不通过 OTel 通道。此决策与 memory `lang SDK 对接点与 telemetry PR 的取舍` 一致。
- 不改 `src/main.tsx` 和 `src/entrypoints/cli.tsx`。新功能走独立 entrypoint，和现有 CLI/REPL 装配路径完全解耦。
- 前端是独立部件，本文档只约定两端对接的 wire format。

## 2. 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│  新 entrypoint: src/entrypoints/server.tsx                       │
│  新 build target: dist/cli-server.exe                            │
│                                                                   │
│  ┌─────────────────┐   HTTP(POST messages)  ┌─────────────────┐ │
│  │ Clients         │ ─────────────────────▶ │ HTTP Handler    │ │
│  │ - CC CLI        │                        │ (Bun.serve)     │ │
│  │   (direct-conn) │ ◀──── WS(SDKMessage) ─ │                 │ │
│  │ - 前端（未定）   │                        │ WS Handler      │ │
│  │ - CI/脚本       │ ◀──── WS(control_req)─ │                 │ │
│  └─────────────────┘                        └────────┬────────┘ │
│                                                      │          │
│                                          ┌───────────▼────────┐ │
│                                          │ SessionRegistry    │ │
│                                          │ Map<sid,Session>   │ │
│                                          └───────────┬────────┘ │
│                                                      │          │
│                         ┌────────────────────────────▼────────┐ │
│                         │ Session (per-client)                │ │
│                         │  - QueryEngine (独立 messages/state)│ │
│                         │  - PermissionHandler (interactive/  │ │
│                         │                       policy)       │ │
│                         │  - LangTracer handles (session +    │ │
│                         │    active span stack)               │ │
│                         └────────────────────────────┬────────┘ │
│                                                      │          │
│      共享资源（进程单例）：                          │          │
│      - Tool registry (getAllBaseTools)               │          │
│      - MCP client pool（含引用计数，见 §11.4）       │          │
│      - Plugin registry                               │          │
│      - Agent definitions                             │          │
│      - LangTracer (LangfuseTracer 实例)──────────────┘          │
└──────────────────────────────────────────────────────────────────┘
```

## 3. 新增 / 改动文件清单

| 路径 | 改动 | 作用 |
|---|---|---|
| `src/entrypoints/server.tsx` | 新增 | server 进程 composition root |
| `src/server/httpServer.ts` | 新增 | `Bun.serve` HTTP + WS，路由到 session |
| `src/server/sessionRegistry.ts` | 新增 | 多会话 map + 生命周期管理 |
| `src/server/serverSession.ts` | 新增 | 单 session 包装（QueryEngine + 权限 + tracer） |
| `src/server/directConnectProtocol.ts` | 新增 | 镜像 `src/server/directConnectManager.ts` 的 wire format（server 视角） |
| `src/server/controlBridge.ts` | 新增 | 把 `canUseTool` 调用翻译成 `control_request` / `control_response`；镜像 `src/cli/structuredIO.ts` |
| `src/server/permissionHandler.ts` | 新增 | P3：interactive / policy 分派 |
| `src/server/permissionPolicy.ts` | 新增 | policy 模式的纯函数规则引擎（复用 `utils/permissions/permissions.ts` 解析） |
| `src/server/sharedAssembly.ts` | 新增 | 进程启动时一次性装配 base tool 定义 / MCP 连接池 / plugin cache；每个 session 按 permission / MCP 状态重新 assemble 可见 tool pool |
| `src/services/lang/tracer.ts` | 新增 | `LangTracer` 接口 + `NoopTracer` 空实现 |
| `src/services/lang/langfuseTracer.ts` | 新增 | 默认 LangFuse 实现 |
| `src/services/lang/getLangTracer.ts` | 新增 | 单例工厂，按 env 选择实现 |
| `src/services/lang/redactor.ts` | 新增 | tracer 专用 redactor，**不经过** `utils/telemetry/events.ts::redactIfDisabled`（后者被 PR#1 改成恒返 `<REDACTED>`，见 §11.2） |
| `src/services/api/logging.ts` | 改 | 插入 `tracer.startGeneration/endGeneration`（LLM 出入参） |
| `src/services/tools/toolExecution.ts` | 改 | 插入 `tracer.startSpan(kind:'tool')` |
| `src/utils/hooks.ts` | 改 | 插入 `tracer.startSpan(kind:'hook')` |
| `src/utils/processUserInput/processSlashCommand.tsx` | 改 | 插入 `tracer.startSpan(kind:'user_prompt', subtype:'slash')` |
| `src/utils/processUserInput/processTextPrompt.ts` | 改 | 插入 `tracer.startSpan(kind:'user_prompt', subtype:'text')` |
| `src/tools/AgentTool/runAgent.ts` | 改 | 为 subagent 新开一个 `agent` span 作为子树根 |
| `src/QueryEngine.ts` | 改 | 每轮 turn 起止加 `query_turn` span；把 tracer 传到 `ToolUseContext`；把 lazy require 的 `components/MessageSelector` 在 server build 下换 pure-logic 版（见 §6.3） |
| `src/bootstrap/state.ts` | 改 | 模块级 `getSessionId()` / `setSessionId()` 等全局 singleton 改走 `AsyncLocalStorage<SessionContext>`（见 §11.1） |
| `src/Tool.ts` | 改 | `ToolUseContext` 里加 `tracer: LangTracer` 字段 |
| `scripts/build.ts` | 改 | 新增 `server` target，DCE 掉 Ink / vim / voice / buddy |
| `package.json` | 改 | 新 script：`build:server`, `build:all` |
| `stubs/ant-packages/**` | 不动 | — |

## 4. Session 生命周期 + wire format

### 4.1 创建

**客户端 → server**：

```http
POST /v1/sessions
Authorization: Bearer <token>
Content-Type: application/json

{
  "cwd": "/path/to/workspace",
  "permissionHandling": "policy",
  "permissionMode": "default",
  "allowedTools": ["Read","Grep","Bash"],
  "deniedTools": [],
  "model": "claude-opus-4-7",
  "agentType": "general-purpose",
  "metadata": { "userId": "...", "tags": ["ci","nightly"] }
}
```

**server → 客户端**：

```json
{ "sessionId": "<uuid>", "wsUrl": "ws://host/v1/sessions/<sid>/stream" }
```

server 端副作用：
1. 构造 `permissionContext`（含 `permissionHandling`、allow/deny list、permissionMode）
2. 实例化 `QueryEngine`（不 submit）
3. `LangTracer.startSession(sessionId, metadata)` 创建 trace root，挂在 session 对象上
4. 在 `SessionRegistry` 登记

### 4.2 发消息

**direct-connect 客户端 → server（主路径）**：同一条 WS 连接双向传输，客户端按 NDJSON 写入 `StdinMessage`。这必须匹配 `DirectConnectSessionManager.sendMessage()`，它不会调用 HTTP message endpoint。

```json
{"type":"user","message":{"role":"user","content":"..."},"parent_tool_use_id":null,"session_id":""}
```

server 端：
1. 在 trace root 下开 `user_prompt` span
2. 调 `QueryEngine.submitMessage(...)`
3. 消息流异步经同一条 WS 推回

**可选 REST adapter（非 direct-connect 客户端）**：可以额外提供 `POST /v1/sessions/<sid>/messages`，但它只是把 HTTP body 转成同一个 session inbound queue；不得作为 direct-connect 兼容性的依据。

### 4.3 消息流（server → 客户端，WS）

逐条 `SDKMessage` JSON 序列化，按行分隔：

```
← {"type":"assistant","message":{...}}
← {"type":"assistant","message":{"content":[{"type":"tool_use",...}]}}
← {"type":"user","message":{"content":[{"type":"tool_result",...}]}}
← {"type":"result","subtype":"success","usage":{...}}
```

### 4.4 Control channel（P3 双模）

**interactive 模式**：

```
← {"type":"control_request","request_id":"<rid>","request":{"type":"can_use_tool",...}}
→ {"type":"control_response","response":{"subtype":"success","request_id":"<rid>","response":{"behavior":"allow",...}}}
```

**policy 模式**：server 侧 `PermissionHandler` 同步决策，不发 `control_request`。lang trace 记录 `permission` event（记 allow/deny + 依据规则）。

**控制流 + 消息流单 writer 串行化**：同一 WS 连接上两类帧共用一条出站队列，顺序严格按业务发生顺序。入站同样只从 WS parser 进入 session inbound queue，避免 HTTP 与 WS 两条路径竞态。参考 `src/cli/structuredIO.ts:161` 的 "single writer" 注释。

### 4.5 会话终止

- `DELETE /v1/sessions/<sid>` 主动关
- 客户端 WS 断连 + grace period（默认 60s，可配）后自动关
- `QueryEngine` 自然 result 不关闭 session，支持连续多轮

关闭副作用：
1. `QueryEngine` 清理（文件缓存、子 agent task）
2. `tracer.endSession(handle, { totalUsage, totalTokens, turnCount })`，flush trace
3. 从 `SessionRegistry` 移除

### 4.5.1 WS 断连期间的 control_request（interactive 模式）

interactive 模式下 WS 断连后、grace period 未过期前若触发权限请求：

- server 把 `control_request` 放入 session 内的 pending 队列（上限 16 条，超限直接 deny）
- 等待 WS 重连；重连后按顺序补发 pending 请求
- 若 grace period 先到，pending 队列内所有请求一次性判 deny，附 reason `"ws_disconnect_timeout"`，并在 lang trace 里记 `permission` event

policy 模式不受此影响（不发 control_request）。

### 4.6 协议对齐表（对上游 `directConnectManager.ts`）

| 上游 client 期望 | server 端提供 | 权威文件 |
|---|---|---|
| WS 接收按行分隔的 `StdoutMessage` | server WS 按 `SDKMessage` JSON + 换行分行发送 | `src/server/directConnectManager.ts` 的 message handler |
| WS 发送 `user` / `control_response` / `interrupt` | server WS parser 接收并路由到 session inbound queue | `src/server/directConnectManager.ts::sendMessage()` / `respondToPermissionRequest()` / `sendInterrupt()` |
| `control_request` / `control_response` 双向 | interactive 模式下 server 通过 WS 发 request、从 WS 接 response | `src/cli/structuredIO.ts`（client 侧反向实现模板，server controlBridge 镜像它写；特别注意第 161 行 "single writer" 注释 + 第 362-405 行 duplicate response 处理） |
| REST `POST /messages` / `/control/response` | 可选外部 API adapter，不是 direct-connect 兼容路径 | 若实现，必须转入同一个 inbound queue，不能绕过 WS 协议状态机 |
| `Authorization: Bearer <token>` header | server 解析，核对 env 配置的 token 白名单 | — |

## 5. Lang 埋点

### 5.1 `LangTracer` 接口

```ts
// src/services/lang/tracer.ts
export interface LangTracer {
  startSession(sessionId: string, meta?: SessionMeta): SessionHandle
  endSession(handle: SessionHandle, summary?: SessionSummary): Promise<void>

  startGeneration(parent: SpanHandle, input: GenerationInput): GenerationHandle
  endGeneration(h: GenerationHandle, output: GenerationOutput): void

  startSpan(parent: SpanHandle, spec: SpanSpec): SpanHandle
  endSpan(h: SpanHandle, outcome: SpanOutcome): void

  event(parent: SpanHandle, spec: EventSpec): void

  flush(): Promise<void>
}

export type SpanKind =
  | 'tool' | 'agent' | 'hook' | 'permission'
  | 'user_prompt' | 'query_turn' | 'system'
```

`SessionHandle` / `SpanHandle` / `GenerationHandle` 为 opaque 类型，内部包装 LangFuse SDK 的 `trace` / `span` / `generation` 对象。

### 5.2 埋点位置

| # | 文件 | 当前状态 | 挂什么 | Parent |
|---|---|---|---|---|
| 1 | `src/services/api/logging.ts` | PR#1 no-op | `generation`（model / messages in / usage / cost / out） | 当前活跃 span |
| 2 | `src/services/tools/toolExecution.ts` | PR#1 no-op | `span(kind:'tool', name)` + in/out | 当前 query_turn |
| 3 | `src/utils/hooks.ts` | PR#1 no-op | `span(kind:'hook', name)` | 触发 hook 的 tool span |
| 4 | `src/utils/processUserInput/processTextPrompt.ts` | PR#1 no-op | `span(kind:'user_prompt', subtype:'text')` | session root |
| 5 | `src/utils/processUserInput/processSlashCommand.tsx` | PR#1 no-op | `span(kind:'user_prompt', subtype:'slash', command)` | session root |
| 6 | `src/tools/AgentTool/runAgent.ts` | 新增 | `span(kind:'agent', agentType, isolation)` 作为 subagent trace root | 父 query_turn |
| 7 | `src/server/permissionHandler.ts` | 新增 | `event(kind:'permission', tool, decision, mode, rule)` | 触发 permission 的 tool span |
| 8 | `src/QueryEngine.ts` | 新增 | `span(kind:'query_turn', turn_index)` | session root 或父 agent span |

### 5.3 典型 Trace 树

```
session:<sid>                                     [LangFuse Trace root]
├── span user_prompt (text) "fix the auth bug"
│   └── span query_turn #1
│       ├── generation LLM call (model, in, out=tool_use[Grep])
│       ├── span tool Grep
│       ├── generation LLM call (out=tool_use[Read])
│       ├── span tool Read
│       ├── generation LLM call (out=tool_use[Edit])
│       ├── span tool Edit
│       │   └── event hook PostToolUse:Edit (prettier format)
│       ├── generation LLM call (out=tool_use[Bash])
│       ├── span tool Bash "npm test"
│       └── generation LLM call (final assistant message)
└── (session 结束) summary: totalTokens, totalCost, turnCount
```

subagent：

```
query_turn #N
├── span tool AgentTool (agentType=explore)
│   └── span agent explore
│       ├── span query_turn #1 (subagent)
│       │   ├── generation ...
│       │   └── span tool Grep
│       └── span query_turn #2
│           └── generation (final subagent message)
```

### 5.4 "CC + 外部 LLM" 一棵树

- CC 内的 LLM 调用埋点在 `services/api/logging.ts`。若 `ANTHROPIC_BASE_URL` 指向外部 gateway（LiteLLM / CLIProxyAPI / 自建），此处埋点已覆盖 model name / messages / tokens。
- 如 gateway 自己也使用 LangFuse / OTel，`LangfuseTracer.startGeneration()` 把当前 generation 的 trace context 注入标准 `traceparent` header；自家 gateway 可额外接受 `langfuse-trace-id` / `langfuse-parent-id` 兼容别名，但 canonical header 是 `traceparent`。这只做 header propagation，不恢复 OTel exporter。
- SDK header 注入的具体位置优先封装单例 `tracedAnthropicClient`（若有）或在 `services/api/client.ts` 工厂注入 `defaultHeaders` / `fetch` 包装；失败 fallback 到 `fetch` 层 monkey-patch。

### 5.5 失败 / 边界

| 场景 | 行为 |
|---|---|
| LangFuse 不可达 | SDK 自带 queue + 重试；超上限丢弃并 `console.warn`，不阻塞 session |
| `LANGFUSE_PUBLIC_KEY` 未配置 | `getLangTracer()` 返回 `NoopTracer`，server 照跑 |
| 进程退出 | 在 `SIGINT` / `SIGTERM` / server graceful shutdown 路径里 `await tracer.flush()`；`process.on('exit')` 只允许同步兜底日志，不能依赖异步 flush |
| 超大 prompt / tool output | 按 `LANG_TRACER_MAX_FIELD_BYTES`（默认 64KB）截断，保留前后 N 字节 + `[...<truncated>]`；完整版写临时文件，LangFuse metadata 里存路径 |
| 敏感字段 redaction | `LangfuseTracer` 接收可选 `redactor: (field, value) => string \| undefined`；默认不做，由部署方决定 |

### 5.6 配置（env 驱动）

```
LANG_TRACER_BACKEND=langfuse          # langfuse | noop
LANGFUSE_PUBLIC_KEY=pk-...
LANGFUSE_SECRET_KEY=sk-...
LANGFUSE_BASE_URL=https://langfuse.your-company.com
LANG_TRACER_SAMPLE_RATE=1.0
LANG_TRACER_MAX_FIELD_BYTES=65536
LANG_TRACER_REDACT_PATTERNS=          # 可选，正则列表（以分号 ; 分隔）
```

## 6. Build 与部署

### 6.1 `scripts/build.ts` 改动

```ts
const TARGETS = {
  cli:    { entry: 'src/entrypoints/cli.tsx',    outfile: 'dist/cli',        features: [] },
  server: { entry: 'src/entrypoints/server.tsx', outfile: 'dist/cli-server', features: ['SERVER_BUILD'] },
}
```

**关键：`SERVER_BUILD` 必须走 Bun 的 `--feature=SERVER_BUILD` 机制而不是 `--define`**。原因：feature flag 通过 Bun 的 `bun:bundle` 常量折叠，埋点处的 `if (feature('SERVER_BUILD'))` 会被编译期 DCE；`--define` 只做字符串替换，遇到 `if (process.env.SERVER_BUILD)` 这类判断折叠不彻底。详见 [`../guides/deployment.md`](../guides/deployment.md) 的 feature flag 章节。

Server build 的 tree-shaking 策略：
- server.tsx 不 import `src/components/**` / `src/screens/**` / `src/ink/**` / `src/vim/**` / `src/voice/**` / `src/buddy/**`
- `EXTERNALS` 不追加已安装 UI runtime（`ink` / `@inkjs/ui` / React 渲染层等）；这些包若被 require，`bun --compile` 产物会运行期找不到或把问题隐藏
- **但 tree-shaking 有两个已知漏点**（见 §6.3），需要单独处理

### 6.2 `package.json` scripts

```json
{
  "build":           "bun run scripts/build.ts cli",
  "build:server":    "bun run scripts/build.ts server",
  "build:all":       "bun run scripts/build.ts cli && bun run scripts/build.ts server",
  "build:nocompile": "bun run scripts/build.ts cli --no-compile",
  "build:dev":       "bun run scripts/build.ts cli --dev"
}
```

### 6.3 已知 tree-shaking 漏点（必须处理）

**漏点 A**：`src/QueryEngine.ts` 对 `src/components/MessageSelector.tsx` 有 lazy `require()` 调用（query 时过滤消息用）。Bundler 对动态 require 处理不稳定，server build 大概率会**把整条 React 链拖进来**。

应对：
- 抽出 pure-logic 版本 `src/utils/messageSelection.ts`（不依赖 React）
- `QueryEngine` 在 `feature('SERVER_BUILD')` 分支下直接 import pure-logic 版
- React 版继续给 CLI build 用

**漏点 B**：`src/tools/**` 里部分 tool 的 `renderResult` / `renderToolUseMessage` 返回 React element，直接 `import 'ink'`。这些 import 是 tool 模块顶层 side-effect，不走 feature gate 就会被 bundle 进 server build。

应对：
- 把受影响 tool 拆成 `<ToolName>.logic.ts` + `<ToolName>.ui.tsx` 两文件（已有 `tools/*/PromptRenderer.tsx` 模式可参）
- server build 下 tool 只加载 `.logic.ts`，`renderResult` 返回 `{ type: 'text', text: ... }` POJO
- 实施阶段先用 `bun build --analyze dist/cli-server.js` 扫出全部受影响文件

**漏点 C 兜底**（如果 A/B 处理不彻底）：使用 server-only shim 模块或 compile-time alias，把 UI-only import 显式改到空实现；**不要**靠 `--external ink` 兜底。`external` 只能用于确定不会在运行期 require 的包。

### 6.4 预期产物

- `dist/cli.exe` ~130MB（现状不变）
- `dist/cli-server.exe` ~80MB（估值，砍掉 Ink / React 渲染后；若走 shim 兜底则 ~85MB）

## 7. 实施阶段

5 个阶段，每阶段独立冒烟验证。本项目无 test/lint（见 `CLAUDE.md`），所有验证通过人工跑二进制观察行为。

### 7.1 阶段 1 — 双入口脚手架与 build target 分叉（S）

**目标**：产出空壳 `dist/cli-server.exe`，能 `--version` 自证，terminal CLI 产物不受影响。

**触达文件**：
- 新增 `src/entrypoints/server.tsx` — fast-path 处理 `--version` / `--help`，然后 `await import('../server/serverMain.js')` 调用 `serverMain()`
- 新增 `src/server/serverMain.ts` — 占位 `console.log('cli-server booting')`
- 新增 `src/server/config.ts` — 从 env/CLI 读取 `CC_SERVER_PORT`、`CC_SERVER_HOST`、`CC_SERVER_AUTH_TOKENS`、`CC_SERVER_SESSION_GRACE_MS`、`CC_SERVER_MCP_IDLE_MS`、`CC_SERVER_DEFAULT_CWD`、`LANGFUSE_*`
- 改动 `scripts/build.ts` — 参数化 entrypoint / outfile；新增 `bun run build:server` 脚本；`features` 机制按 §6.1
- 改动 `package.json` — 增加 `build:server` / `build:server:nocompile`
- 改动 `docs/guides/deployment.md` — 新增"两个 build target"章节

**关键实现点**：
1. server build 不把 Ink/React-DOM 渲染层相关包加入 EXTERNALS；若 `bun build --analyze` 仍显示 UI 依赖，先修 import/gating/shim，而不是 external 掩盖
2. `server.tsx` 绝对不 `import('../main.tsx')`，彻底切开两个 compose root
3. `CLAUDE_CODE_BUILD_TARGET` 运行时可读（供 tracer metadata 使用，见 §11.3）；`SERVER_BUILD` feature flag 用于编译期 DCE

**验证**：`bun run build:server && ./dist/cli-server.exe --version` 出版本；`./dist/cli.exe --version` 仍正常；两个产物同时存在。

**依赖**：无。

---

### 7.2 阶段 2 — HTTP/WS wire format server 端，单会话可跑通（L）

**目标**：server 能创建单会话、跑通 WS 双向 `user` / `control_request` / `control_response` + 消息流，client 能用已有 `DirectConnectSessionManager` 连上去。

**前置 spike**：在本阶段开头先跑 LangFuse JS SDK 在 Bun runtime 下的最小可用性冒烟（新建 trace + 立刻 flush）。不行就降级为直调 LangFuse REST API。这个 spike 的目的是**提前**确认阶段 5 不会翻车。

**触达文件**：
- 新增 `src/server/httpServer.ts` — `Bun.serve`；路由：`POST /v1/sessions`、`WS /v1/sessions/:sid/stream`、`DELETE /v1/sessions/:sid`、`GET /healthz`；REST `POST /messages` / `/control/response` 只作为非 direct-connect adapter（可延后）
- 新增 `src/server/serverSession.ts` — 单会话容器：持有 `QueryEngine` + `AbortController` + WS 客户端集合；外暴 `submitPrompt()` / `interrupt()` / `dispatchControlResponse()` / `handleInboundControlResponse()` / `handleInboundUserMessage()`
- 新增 `src/server/controlBridge.ts` — 把 server-side `canUseTool` 调用翻译成 `control_request` 写 WS，等待 WS 入站 `control_response`；镜像 `src/cli/structuredIO.ts` 的反向逻辑
- 新增 `src/server/directConnectProtocol.ts` — 导出要 drop 的 `keep_alive` / `streamlined_*` 类型、要转发的 SDKMessage 类型，严格对齐 `directConnectManager.ts:102-110`
- 改动 `src/server/serverMain.ts` — 启动 `httpServer.listen()`；SIGINT / SIGTERM 优雅关闭

**关键实现点**：
1. wire 完全复用 direct-connect 格式：WS 双向 NDJSON；server 出站一条一个 `StdoutMessage`，client 入站一条一个 `StdinMessage`；`control_request.request_id` UUID v4，`control_response` 严格 echo
2. `POST /v1/sessions` 响应 `{ sessionId, wsUrl }`；DirectConnect 客户端后续只用 `wsUrl` 发消息 / 权限响应
3. 控制流和消息流在 WS 出站队列**单 writer 串行化**（§4.4）
4. WS 客户端掉线 → session 转 `detached` 保留 grace period（§4.5.1）

**验证**：起 server → 用 `./dist/cli.exe open cc://localhost:8080/<sid>` 连上去 → 让它读 README.md → 权限弹窗 → allow → 终端收到文件内容。

**依赖**：阶段 1。

---

### 7.3 阶段 3 — 多会话 + 权限双模式（M2 + P3）（L）

**目标**：`Map<sid, serverSession>` 运转；per-session `permissionHandling: 'interactive' | 'policy'`。

**触达文件**：
- 新增 `src/server/sessionRegistry.ts` — `Map<sid, ServerSession>` + LRU idle timeout；共享装配在 `sharedAssembly` 初始化后注入每个 session
- 新增 `src/server/sharedAssembly.ts` — 启动时一次性装配 base tool 定义 / MCP 连接池 / plugin cache / agent definitions；所有 session 读取只读基础 snapshot，再按 session permission / MCP 状态调用 `assembleToolPool()`
- 新增 `src/server/permissionPolicy.ts` — 纯函数规则引擎：`(toolName, input, sessionContext) => PermissionResult`；规则来源：`POST /v1/sessions` body 的 `allowedTools` / `deniedTools` / `permissionMode` + server-wide default
- 新增 `src/server/permissionHandler.ts` — 根据 session 的 `permissionHandling` 分派到 interactive（走 controlBridge）或 policy（同步决策）；统一 `CanUseToolFn` 接口
- 改动 `src/server/serverSession.ts` — 构造 QueryEngine 时注入 `permissionHandler` 作为 `canUseTool`

**关键实现点**：
1. policy 规则支持 glob（如 `Bash(npm test*)`）和 tool schema path match，复用 `utils/permissions/permissions.ts` 的解析函数
2. interactive 模式 `control_request` 60s 超时自动 deny
3. `POST /v1/sessions` body 支持 `policyFile: "<path>"`，server 端加载 + hash 校验
4. 可见 tool pool 必须 per-session assemble；不得把 `getTools(permissionContext)` / `assembleToolPool(permissionContext, mcpTools)` 的最终结果作为进程级共享对象
5. 本阶段同时处理 §11.1（bootstrap/state.ts 的 AsyncLocalStorage 改造）——这是 M2 的**硬前提**，不能推迟
6. 本阶段同时处理 §11.4（MCP 池引用计数），或落 MVP fallback（启动期装配，不支持 per-session MCP 差异）

**验证**：两个客户端同时连 server 开两个 session，一个 policy 跑 `bash echo hi` 直过、另一个 interactive 弹权限；观察两 session 的 `mutableMessages` / `readFileState` 完全独立；interactive 超时路径至少跑一次。

**依赖**：阶段 2。

---

### 7.4 阶段 4 — Ink / vim / voice / buddy DCE 收紧（M）

**目标**：`bun run build:server` 产物不含 Ink reconciler / vim / voice / buddy；bundle 体积降到 ~80MB。

**触达文件**：
- 改动 `scripts/build.ts` — 增加 server target，但保持 EXTERNALS 只含确定不会运行期 require 的包；必要时加 server-only alias/shim，不加 `ink` external
- 新增 `src/utils/buildTarget.ts` — 导出 `IS_SERVER_BUILD`，编译期折叠
- 改动 `src/QueryEngine.ts` — 处理漏点 A（抽出 `src/utils/messageSelection.ts` pure-logic 版）
- 改动受漏点 B 影响的 tools — 拆 `.logic.ts` + `.ui.tsx`，具体文件由 `bun build --analyze` 扫出
- 可能改动 `src/commands.ts` / `src/tools.ts` — 发现 UI 依赖（Ink `render()` 调用）包进 `!IS_SERVER_BUILD`
- 可能改动 `src/voice/` / `src/vim/` / `src/buddy/` 的入口 barrel — 顶层 side-effect 按 `IS_SERVER_BUILD` gating

**关键实现点**：
1. server build 下 `Tool.prompt` / `Tool.description` 不依赖 Ink；`renderResult` / `renderToolUseMessage` 走 plain-text 分支
2. 有 React 元素作为返回值占位时 server 下 stub 成 `{ type: 'text', text: ... }` POJO
3. **plugin 里是否有 Ink 组件**——实施阶段先 `grep -r "from.'ink'" plugins/ ~/.claude/plugins/`（用户机器数据仅供参考），在 server build 下给 plugin 加载流程加 Ink shim fallback

**验证**：`bun run build:server:nocompile` 后，`bun build --analyze` 报告里**无** `ink` / `@inkjs/ui` / `src/components/**`；`./dist/cli-server.exe` 启动 server，跑一次 Read tool call，stdout 无 Ink escape 序列。bundle 体积和目标对齐（~80MB）。

**依赖**：阶段 2。可与阶段 3 并行。

---

### 7.5 阶段 5 — LangFuse `LangTracer` 抽象 + 埋点 + trace 传播（L）

**目标**：LangFuse 面板看到 §5.3 描绘的 trace 树；HTTP header 传入 server 后，CC 内 LLM 调用和用户 gateway 的 span 归一棵 trace 树。

**前置**：阶段 2 开头的 LangFuse Bun 兼容性 spike 已通过。

**触达文件**：
- 新增 `src/services/lang/tracer.ts` — 抽象接口（见 §5.1）
- 新增 `src/services/lang/langfuseTracer.ts` — LangFuse 实现；懒加载 client，无 key 时不激活
- 新增 `src/services/lang/noopTracer.ts` — 默认 fallback
- 新增 `src/services/lang/getLangTracer.ts` — 按 env 返实例
- 新增 `src/services/lang/redactor.ts` — 独立 redactor（必须绕开 §11.2 陷阱）
- 新增 `src/services/lang/context.ts` — `AsyncLocalStorage<TraceContext>` 贯穿一次 `submitMessage`；暴露 `getCurrentTrace()`
- 新增 `src/services/lang/propagation.ts` — 序列化 / 反序列化 W3C `traceparent`；可选解析 / 镜像 `langfuse-trace-id`、`langfuse-parent-id` 作为自家 gateway 兼容别名
- 改动 §5.2 表里列出的 8 个埋点文件
- 改动 `src/services/api/client.ts`（或等价位置）— LLM 出站请求 header 注入 `traceparent`（可额外镜像 LangFuse 兼容别名）
- 改动 `src/server/httpServer.ts` — WS connect headers（以及可选 REST adapter headers）解析 trace context → `propagation.ts` → 绑 AsyncLocalStorage

**关键实现点**：
1. 抽象接口绑死 LangFuse 概念（trace/span/generation）但实现可换；**不**走 OTel SDK，避免被 PR#1 的 OTel no-op 拦（§11.2）
2. LLM span 用 LangFuse 的 `generation` 类型，挂 `model` / `input_tokens` / `output_tokens` / `cost`；复用 `totalUsage` 聚合
3. `permission` event：interactive 模式记审批时长，policy 模式几乎 0ms
4. trace context 从 WS connect headers 或可选 REST adapter header 提取；没有就自建。server 返回 / 推送 trace URL 或 trace id，便于客户端 UI 展示 trace 链接
5. SDK header 注入：优先 `services/api/client.ts` 工厂注入 `defaultHeaders` 或 fetch wrapper，用当前 generation 的 span context 每轮覆盖；fallback 到 fetch monkey-patch
6. `tracer.metadata` 里 CC 版本读 `package.json`，不依赖 `getAttributionHeader`（§11.3）

**验证**：设好 LangFuse env → 跑场景 "列出目录" → LangFuse 面板出现 trace：`session` > `user_prompt` + `query_turn` > `generation` + `tool(LS)` > `event permission`；设 `ANTHROPIC_BASE_URL` 指向支持 `traceparent` 的 gateway，验证 CC generation 与 gateway span 同一 trace id。

**依赖**：阶段 2（header 解析）。可与阶段 3/4 并行；阶段 5 尾段（subagent 嵌套 trace）需要阶段 3 的 session 结构稳定。

## 8. 端到端验证清单

阶段性冒烟之外，集成完成后要跑通：

| 场景 | 预期 |
|---|---|
| 并发多 session，trace 不串 | 三个并发 session，LangFuse UI 里三棵独立 trace；`mutableMessages` / `readFileState` / `totalUsage` 严格独立 |
| interactive → deny | `control_request` → deny → tool 被拒 → LangFuse 里 `permission` event `decision=deny` |
| policy 直接决策 | `allowedTools=[Read]` 会话调 Bash 被拒，不发 `control_request`；LangFuse 里 event 带 policy 规则依据 |
| interactive + WS 断连 | 断连期间的 control_request 进 pending；重连补发或 grace 超时统一 deny |
| CC + gateway 一棵树 | `ANTHROPIC_BASE_URL` 指向支持 `traceparent` 的 gateway，trace 同 id 挂齐 |
| 故障降级 | LangFuse 宕机 → server 照跑 + console warn；不设 key → NoopTracer；server SIGINT → 最后 flush 成功 |

## 9. 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| `QueryEngine` 隐含单例状态导致多 session 串扰 | 中 | 高 | §11.1 已明确方案；阶段 3 必做，不能推迟 |
| Bun.serve WS 在 Windows 稳定性 | 低 | 中 | 出问题 fallback `uWebSockets.js` |
| LangFuse JS SDK 在 Bun runtime 兼容性 | 低 | 高 | 阶段 2 开头单独 spike；不行降级直调 LangFuse REST |
| direct-connect wire 细节少实现 | 高 | 中 | 共享上游 `directConnectManager.ts` / `remote/*` 类型定义，不自造 wire；`cli/structuredIO.ts` 直接镜像 |
| 意外触及 PR#1 no-op 的代码路径 | 低 | 中 | 新 tracer 代码与 `src/utils/telemetry/*` / `src/services/analytics/*` 完全解耦；PR 审查 grep 验证 |
| Ink 深度嵌入 tool 导致 DCE 不彻底 | 中 | 中 | 漏点 A/B 拆分；实在不行走 server-only shim 兜底（+5MB）；禁止用 `--external ink` 掩盖 |
| 前端 spec 与本文档契约不一致 | 中 | 中 | §4 wire format 是权威；前端单独 spec 必须对齐 |

## 10. 明确排除

- **前端**：独立 spec，沿用本文档 §4 wire format
- **鉴权 / 多租户**：本文档只做 Bearer token 白名单；RBAC / mTLS / JWT 留给后续
- **Trace 采样 / 长期存储**：env 采样率够用；复杂策略部署期配
- **LangFuse Score / Prompt Mgmt / Dataset 对接**：埋点用原生 SDK 所以天然能接，但属运营功能，不在本文档
- **回滚 PR#1 恢复 OTel 出口**：显式不做
- **Coordinator / Bridge mode 的 trace**：只覆盖主 agent + subagent；其他单独 spec
- **Remote agent task（`tasks/RemoteAgentTask/`）**：暂按"继承主 session tracer"处理，细节留给实施阶段
- **会话 resume（跨进程持久化 `mutableMessages`）**：不做；`detached` 保留只防重连断流，不是长期持久化
- **Policy DSL 的 `ask` 模式**：MVP 未决，默认 deny；以后再扩

## 11. 实施前必须先解决的技术风险

### 11.1 `bootstrap/state.ts` 的模块级 session singleton

`src/QueryEngine.ts` 顶部直接 `import { getSessionId, isSessionPersistenceDisabled } from 'src/bootstrap/state.js'`。`getSessionId()` / `setSessionId()` 当前是**模块级单例**——terminal 场景下天然只有一个 session 所以无所谓，但 M2 下谁后 `setSessionId` 谁就覆盖前者，日志 / transcript / tracer 归属全部错位。

**必须做**：

1. 实施第一步先通盘扫 `src/bootstrap/state.ts` 里所有模块级可变状态（不只 sessionId，还有 `promptId` / `persistenceDisabled` 等）
2. 改造为 `AsyncLocalStorage<SessionContext>`，所有 getter 改成读 context
3. 每个 session 创建时 `als.run(ctx, () => queryEngine.submitMessage(...))` 包住全链路
4. 找不到 context 时 fallback 到模块级默认值（兼容 CLI build）

**blast radius 评估**：若 `bootstrap/state.ts` 被 `logEvent` / transcript / 插件系统静态引用过多，改造面积可能超预估。**阶段 3 开头先 `grep -r "from.*bootstrap/state" src/` 过一遍评估**。

### 11.2 PR#1 留下的 `redactIfDisabled` 陷阱

`src/utils/telemetry/events.ts::redactIfDisabled` 被 PR#1 改成**恒返回 `<REDACTED>`**（见 `docs/guides/disable-telemetry.md` 端点 #5）。若 LangFuse 埋点代码不小心把 prompt/tool input/output 路由过这个函数，**LangFuse UI 里所有 trace 字段都会是 `<REDACTED>`**——trace 结构正确但内容全打码，调试价值归零。

**必须做**：

1. 新增 `src/services/lang/redactor.ts`，定义独立的 redact 函数，**不 import 任何 `utils/telemetry/*` 模块**
2. `LangfuseTracer` 所有入参走 `redactor.ts` 的函数
3. 代码审查阶段 `grep -n "redactIfDisabled" src/services/lang/` 确认零结果
4. 验证阶段在 LangFuse UI 里肉眼确认 trace 内容非 `<REDACTED>`

### 11.3 LangFuse trace metadata 里的 CC 版本/entrypoint

`src/constants/system.ts::getAttributionHeader` 已被 PR#6 改成 `''`（见 `docs/guides/disable-telemetry.md` 端点 #11）。想在 LangFuse trace 根节点的 metadata 里带 CC 版本号、build target、是否 server build 等信息时，**不能再用这个 header**。

**必须做**：

1. `LangfuseTracer.startSession()` 的 metadata 里直接读 `package.json` 的 `version` + `process.env.CLAUDE_CODE_BUILD_TARGET`（server build 时为 `'server'`）
2. 不经过 `getAttributionHeader`

### 11.4 MCP 池跨 session 生命周期

多 session 共享 MCP client 池时，一个 session 结束**不能**直接 kill 子进程（别的 session 还在用）。

**必须做**：

1. MCP client 池维护**引用计数**：每个 session 创建时对用到的 MCP server `refcount++`，session 关闭时 `refcount--`
2. 某 MCP server `refcount == 0` 后进入 idle，超过 `CC_SERVER_MCP_IDLE_MS`（默认 5min）再 kill 子进程
3. 实施阶段评估：现有 `src/services/mcp/*` 的 client 池是否已经有多消费者语义；若上游 MCP client 假设独占，需要包一层 proxy

**MVP fallback**：进程启动时按 env 配置一次性装配 MCP（不支持 per-session MCP 差异配置），生命周期跟随进程。实施时若选 fallback 要在本文档明确回填"MVP 限制"标记。

## 12. 附录

### 12.1 HTTP 端点表

| Method | Path | 作用 |
|---|---|---|
| `POST` | `/v1/sessions` | 创建 session |
| `DELETE` | `/v1/sessions/<sid>` | 关闭 session |
| `POST` | `/v1/sessions/<sid>/messages` | 可选 REST adapter：发用户消息（direct-connect 不用此路径） |
| `POST` | `/v1/sessions/<sid>/control/response` | 可选 REST adapter：interactive 权限应答（direct-connect 走 WS `control_response`） |
| `GET` | `/v1/sessions/<sid>` | 查询 session 状态（可选，便于前端） |
| `GET` | `/healthz` | 健康检查 |

### 12.2 WS 端点表

| Path | 方向 | 内容 |
|---|---|---|
| `/v1/sessions/<sid>/stream` | 双向 | server → client: `SDKMessage` / `control_request` NDJSON；client → server: `user` / `control_response` / `interrupt` NDJSON |

### 12.3 环境变量全表

| Var | 默认 | 说明 |
|---|---|---|
| `CC_SERVER_PORT` | `8080` | server 监听端口 |
| `CC_SERVER_HOST` | `127.0.0.1` | 监听地址 |
| `CC_SERVER_AUTH_TOKENS` |（空） | 逗号分隔 Bearer token 白名单；空则不鉴权 |
| `CC_SERVER_SESSION_GRACE_MS` | `60000` | WS 断连后 session 清理宽限期 |
| `CC_SERVER_MCP_IDLE_MS` | `300000` | MCP server 无引用后的 idle 关闭阈值 |
| `CC_SERVER_DEFAULT_CWD` | 当前进程 cwd | `POST /v1/sessions` 未传 `cwd` 时的默认工作目录 |
| `CLAUDE_CODE_BUILD_TARGET` | — | 构建期注入，server build 为 `'server'`；供 tracer metadata 使用 |
| `ANTHROPIC_BASE_URL` | `api.anthropic.com` | LLM 调用端点，可指向外部 gateway |
| `ANTHROPIC_AUTH_TOKEN` | — | LLM API key |
| `LANG_TRACER_BACKEND` | `noop` | `langfuse` / `noop` |
| `LANGFUSE_PUBLIC_KEY` | — | LangFuse 凭证 |
| `LANGFUSE_SECRET_KEY` | — | LangFuse 凭证 |
| `LANGFUSE_BASE_URL` | `https://cloud.langfuse.com` | 自托管填自己的 URL |
| `LANG_TRACER_SAMPLE_RATE` | `1.0` | 采样率 |
| `LANG_TRACER_MAX_FIELD_BYTES` | `65536` | 单字段截断阈值 |
| `LANG_TRACER_REDACT_PATTERNS` |（空） | 可选正则列表，分号分隔 |

### 12.4 前端未决项

前端单独 spec 时需要决定：

- 认证方式（Bearer token / OAuth / 自家 SSO）
- 渲染技术栈（React? Vue? 其他?）
- 会话持久化（浏览器端 / 服务端）
- 多会话切换 UX
- 权限请求 UX（interactive 模式下的对话框）
- 是否也当 LangFuse 前端用（可选）

前端 spec 必须与本文档 §4 的 wire format 完全兼容。

### 12.5 与现有系统的关系图

```
现有 CLI（src/entrypoints/cli.tsx → main.tsx）
   ↓ 不改
   使用 QueryEngine / tools / commands / AppState
                                   ↑
                                   ↑ 共享（只读 snapshot + 引用计数 MCP 池）
                                   ↑
新 server（src/entrypoints/server.tsx）  ── 加 ──▶ LangfuseTracer
   ↓                                          （新增，LangFuse JS SDK）
   HTTP + WS 对外              ↑
   使用同一套 QueryEngine       └── 埋点挂在 services/api/logging.ts
                                           services/tools/toolExecution.ts
                                           utils/hooks.ts
                                           utils/processUserInput/*
                                           tools/AgentTool/runAgent.ts
                                           QueryEngine.ts
                                           server/permissionHandler.ts
```

PR#1 / #6 / #7 的 no-op 状态保持不变：lang 埋点走业务层，与 `src/utils/telemetry/*` / `src/services/analytics/*` 解耦。

### 12.6 整体工时估算

| 阶段 | 工时档位 |
|---|---|
| 1 · 双入口脚手架 | S |
| 2 · HTTP/WS server 单会话 | L（含 LangFuse-in-Bun spike） |
| 3 · 多会话 + 权限双模式 | L（含 §11.1 / §11.4 改造） |
| 4 · Ink/vim/voice/buddy DCE | M |
| 5 · LangFuse 埋点 + 传播 | L |
| **合计** | **XL**（≈ 3 个 L + 1 M + 1 S） |

阶段 3/4/5 有并行空间：一个人做 3，另一个做 4 + 5 前半段。阶段 5 后半段（subagent 嵌套 trace）需要阶段 3 的 session 结构稳定。

### 12.7 关键文件索引（实施参考）

- `src/server/directConnectManager.ts` —— client 侧 wire format 现成实现，server 端镜像它
- `src/remote/RemoteSessionManager.ts` —— 远程会话协议客户端，参考其 WS + control 链路
- `src/cli/structuredIO.ts` —— 859 行"反向实现"模板，server controlBridge 直接对照写
- `src/utils/teleport/api.ts::sendEventToRemoteSession` —— 远程模式 HTTP body schema 参考；direct-connect 兼容路径以 WS `sendMessage()` / `respondToPermissionRequest()` 为准
- `src/QueryEngine.ts` —— 会话引擎，改动最多；重点看 `mutableMessages` / `readFileState` / `totalUsage` / lazy require 的 `MessageSelector`
- `scripts/build.ts` —— build target 参数化起点
- `docs/guides/disable-telemetry.md` —— PR#1/#6/#7 的 no-op 清单，避免踩坑
