---
name: Server Mode + LangFuse Tracing · Task Breakdown
type: task-breakdown
status: draft
date: 2026-04-24
parent: server-mode-and-lang-tracing.md
---

# Server Mode + LangFuse · 任务拆分

> 本文档把 [`server-mode-and-lang-tracing.md`](./server-mode-and-lang-tracing.md) 的 5 阶段实施计划拆成可单独 commit / review 的**细任务**。每条给出 **scope · usecase · 验证 · 依赖**，供 `roadmap.md` 工作台勾选追踪。
>
> 规模档位：**XS**（<1h）· **S**（半天）· **M**（1–2 天）· **L**（3–5 天）· **SPIKE**（探索，不产代码）
>
> **勾选规则**：任务完成 = 代码改完 + 验证跑通。PR 可以合多个任务，但 `roadmap.md` 的勾选必须等**所有绑定任务都验证过**再打 `[x]`。

---

## Phase 0 — 基础设施 / LangFuse 部署（外部准备）

> 这阶段不改代码，只确保"阶段 5 有一个 LangFuse 能往里写"。在自托管 LangFuse 下跑通是本方案的前提。

### T0.1 · 部署 self-hosted LangFuse 实例 (M) — ✅ 文档已交付

- **Scope**：用 Docker Compose 起一套 self-hosted LangFuse v3（web / worker / postgres / clickhouse / redis / minio 6 服务）；暴露 `127.0.0.1:3000` Web UI；创建 project 并取得 `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`
- **Usecase**：所有带 LangFuse 的任务（T2.0 SPIKE / T5.3 / T5-Smoke / TE.5）都要求 LangFuse 可达；没有实例等于没有后端
- **验证**：`curl http://localhost:3000/api/public/health` 返 200；用 [`guides/langfuse-setup.md` §5](../guides/langfuse-setup.md) 的 Bun 脚本发一条 trace，Web UI `Traces` 面板看得到
- **依赖**：无（独立基建，越早越好）
- **交付物**：
  - [`deploy/langfuse/docker-compose.yml`](../../deploy/langfuse/docker-compose.yml) + [`deploy/langfuse/.env.example`](../../deploy/langfuse/.env.example) + [`deploy/langfuse/.gitignore`](../../deploy/langfuse/.gitignore)
  - [`docs/guides/langfuse-setup.md`](../guides/langfuse-setup.md)（前置 · 起服务 · 初始化 project · 凭证落盘 · 冒烟 · 排错 · 轮换备份 · 下一步，8 节）
- **剩余动作**：开发者本机执行 `cd deploy/langfuse && cp .env.example .env && <填随机值> && docker compose up -d` 即完成真实部署

### T0.2 · LangFuse 接入变量写入本地 `.env.local` + secrets 管理约定 (XS) — ✅ 完成

- **Scope**：把 `LANGFUSE_*` 放到 `.env.local`（已 gitignore）；在 `docs/guides/langfuse-setup.md` 写明"不要 commit 凭证"；`scripts/build.ts` / server 读取顺序 env > .env.local > 默认值
- **Usecase**：本地开发默认就能连上自托管 LangFuse；不污染 git
- **验证**：`.env.local` 被 `.gitignore` 匹配；`bun -e 'console.log(process.env.LANGFUSE_PUBLIC_KEY)'` 在项目根下可读
- **依赖**：T0.1
- **交付物**：[`docs/guides/deployment.md`](../guides/deployment.md#本地凭证约定) 新增 "本地凭证约定" 一节，回链 [`langfuse-setup.md §4`](../guides/langfuse-setup.md#4--把凭证写进仓库)。`.env.local` 的 `process.env` > `.env.local` > 默认值 读取顺序是**约定**，loader 实现由 T1.3 落地
- **剩余动作**：无

---

## Phase 1 — 双入口脚手架（S 合计）

### T1.1 · 新增 `src/entrypoints/server.tsx` fast-path 入口  (XS)

- **Scope**：新文件；处理 `--version` / `--help` 短路后 `await import('../server/serverMain.js')` 调用 `serverMain()`
- **Usecase**：让 `./dist/cli-server.exe --version` 能脱离 `main.tsx` 的装配链直接返回版本号，证明两个 entrypoint 完全切开
- **验证**：临时用 `bun run src/entrypoints/server.tsx --version` 跑通打印 `0.1.0 (Claude Code)`（不依赖 `scripts/build.ts`，避开循环依赖）；build 层的 e2e 验证在 T1.4 完成后一并跑一次
- **依赖**：无

### T1.2 · 新增 `src/server/serverMain.ts` 占位 (XS)

- **Scope**：`export async function serverMain(): Promise<void>`，体内先 `console.log('cli-server booting')`
- **Usecase**：给 T1.1 提供入口函数，阶段 2 再填 HTTP 逻辑
- **验证**：临时用 `bun run src/entrypoints/server.tsx` 跑起来能看到 `cli-server booting` 输出
- **依赖**：无（可与 T1.1 并行写）

### T1.3 · 新增 `src/server/config.ts` env loader (S)

- **Scope**：读 `CC_SERVER_PORT` / `CC_SERVER_HOST` / `CC_SERVER_AUTH_TOKENS` / `CC_SERVER_SESSION_GRACE_MS` / `CC_SERVER_MCP_IDLE_MS` / `CC_SERVER_DEFAULT_CWD` / `LANGFUSE_*`；导出 `ServerConfig` 对象 + `loadConfig()` 工厂
- **Usecase**：后续阶段所有配置都过这一个入口，阶段 2 的 `Bun.serve` 直接消费
- **验证**：写 unit-level 冒烟：`CC_SERVER_PORT=9090 bun -e "const c = await import('./src/server/config'); console.log(c.loadConfig())"` 打印正确端口
- **依赖**：无（纯配置模块，独立）

### T1.4 · 参数化 `scripts/build.ts` 的 TARGETS map (S)

- **Scope**：加 `const TARGETS = { cli: {...}, server: {...} }`；server target 带 `features: ['SERVER_BUILD']`；CLI 调用改成 `bun run scripts/build.ts <target>`。不要把已安装 UI runtime（如 `ink` / `@inkjs/ui`）加入 `EXTERNALS`
- **Usecase**：单一 build script 两个产物，未来加 target 一行配置搞定
- **验证**：`bun run scripts/build.ts cli && ./dist/cli.exe --version` 正常；`bun run scripts/build.ts server && ./dist/cli-server.exe --version` 正常；两个产物同时存在
- **依赖**：T1.1, T1.2

### T1.5 · `package.json` 加 `build:server` / `build:all` (XS)

- **Scope**：加 `build:server` / `build:server:nocompile` / `build:all`
- **Usecase**：`bun run build:all` 一次出两个产物，供 CI / 本地统一命令
- **验证**：`bun run build:all` 产出 `dist/cli.exe` + `dist/cli-server.exe`
- **依赖**：T1.4

### T1.6 · 更新 `docs/guides/deployment.md` 的"两个 build target"章节 (XS)

- **Scope**：新增 §（保持 deployment.md 的目录 + 一句话 hook 风格）
- **Usecase**：贡献者 `bun run build:server` 前先看文档，避免误会"server 是 CLI 的 flag"
- **验证**：`Read deployment.md` 后能一行解释两个 target 的区别
- **依赖**：T1.5

---

## Phase 2 — HTTP/WS 单会话可跑通（L 合计）

### T2.0 · SPIKE：LangFuse JS SDK 在 Bun runtime 下的最小可用性 (SPIKE · S)

- **Scope**：`bun add langfuse` + 写最小脚本 `spike/langfuse-bun.ts`：创建 trace → 立刻 `flush()` → LangFuse UI 看得到
- **Usecase**：**提前**证伪阶段 5 能不能用原生 SDK；不行就降级到直调 LangFuse REST API
- **验证**：LangFuse 面板看得到 trace；把 `spike/` 目录清掉，结论写进 `server-mode-and-lang-tracing.md` §11 或 §12.6 备注
- **依赖**：T0.1（需要有 LangFuse 实例可写入）
- **输出**：`spike_report.md`（一句结论 + 3 行支撑）；不进 dist

### T2.1 · 新增 `src/server/directConnectProtocol.ts` wire 类型 (S)

- **Scope**：把 `src/server/directConnectManager.ts` 里 client 侧期望的出站 `StdoutMessage` / 入站 `StdinMessage` / `control_request` / `control_response` 类型**镜像**过来；drop 掉 server 不需要转发的 `keep_alive` / `streamlined_*`
- **Usecase**：server 写出和读入的帧类型与现有 `DirectConnectSessionManager` 100% 对齐，避免自造 wire
- **验证**：在 `httpServer.ts` 里 import + TypeScript 编译通过；序列化一条 `SDKMessage` 能被 `directConnectManager.ts` 反序列化，序列化一条 `user` / `control_response` 能被 server WS parser 路由（跑阶段 2 e2e 冒烟时一并验证）
- **依赖**：无（纯类型定义）

### T2.2 · 新增 `src/server/httpServer.ts` Bun.serve + 路由 (M)

- **Scope**：`Bun.serve({ port, fetch, websocket })`；必需路由 `POST /v1/sessions` / `WS /v1/sessions/:sid/stream` / `DELETE /v1/sessions/:sid` / `GET /healthz`；`POST /v1/sessions/:sid/messages` / `POST /v1/sessions/:sid/control/response` 只是非 direct-connect REST adapter，可延后
- **Usecase**：HTTP 负责 session 管理，WS 负责 direct-connect 双向消息；路由层是 session 的 demux
- **验证**：`curl -X POST localhost:8080/v1/sessions -d '{...}'` 收到 `{sessionId, wsUrl}`；`curl localhost:8080/healthz` → 200；WS 连接后能发送一条 `user` NDJSON 并收到响应
- **依赖**：T2.1

### T2.3 · 新增 `src/server/serverSession.ts` 单会话容器 (M)

- **Scope**：类 `ServerSession`：持有 `QueryEngine` + `AbortController` + WS 客户端 Set + pending control_request Map + **WS 出站单 writer 队列**（T2.7 的不变式从诞生起就立）；外暴 `submitPrompt()` / `handleInboundUserMessage()` / `handleInboundControlResponse()` / `interrupt()` / `attachWebSocket()` / `detachWebSocket()` / `enqueueOutbound()`；可选 REST adapter 调同一组 inbound API
- **Usecase**：把"一次会话"的所有状态聚到一个类里，阶段 3 的 SessionRegistry 批量管理；队列从第一天就存在，避免 T2.4 先写 `ws.send()` 再返工
- **验证**：脚本冒烟观察真实行为：`const s = new ServerSession(cfg); s.onOutbound(m => console.log(m.type)); await s.submitPrompt("hi")` 至少打印一条 `assistant` 或 `result` 事件；`s.interrupt()` 后无挂起
- **依赖**：T2.1

### T2.4 · 新增 `src/server/controlBridge.ts` 双向 control 翻译 (M)

- **Scope**：把 server 侧 `canUseTool` 调用翻译成 `control_request` 走 **T2.3 的出站队列**（严禁直接 `ws.send`）；WS 入站 `control_response` 收到后解析 → 解 Promise。可选 REST `/control/response` 只能转入同一 inbound API。**严格镜像** `src/cli/structuredIO.ts:161`（single writer）和 `:362-405`（duplicate response 处理）
- **Usecase**：interactive 模式的权限弹窗；阶段 3 的 permissionHandler 会 call 这里
- **验证**：client 连 server，server 触发一次权限请求，client 按协议返回 response，server 收到后 tool 继续；同一 `request_id` 重复 response 被丢弃（grep `:362-405` 逻辑）
- **依赖**：T2.3, T2.7（队列不变式先立）

### T2.5 · `serverMain.ts` 装配 `httpServer` + SIGINT/SIGTERM 优雅关闭 (S)

- **Scope**：`httpServer.listen()`；注册共用 graceful shutdown handler 处理 `SIGINT` / `SIGTERM`：`await httpServer.stop(); await tracer.flush(); process.exit(0)`。不要依赖 `process.on('exit')` 做 async flush。**session 级清理（`sessionRegistry.closeAll()`）留给 T3.1 扩展同一 handler**——阶段 2 无 registry
- **Usecase**：Ctrl-C 能干净退出，已跑的 trace 也 flush 完
- **验证**：`./dist/cli-server.exe` 启动 → Ctrl-C → 无 hang，exit code 0
- **依赖**：T2.2

### T2.6 · Bearer token 鉴权中间件 (S)

- **Scope**：在 `httpServer.ts` 的 fetch handler 首段检查 `Authorization: Bearer <token>`；token 在 `CC_SERVER_AUTH_TOKENS`（逗号分隔）白名单里才放行；env 未配置则不鉴权（本地开发）
- **Usecase**：最小鉴权门槛；RBAC 留给后续 spec（§10 明确排除）
- **验证**：`CC_SERVER_AUTH_TOKENS=abc` 启动 → `curl -H "Authorization: Bearer wrong" ... /v1/sessions` 返 401；`Bearer abc` 返 200
- **依赖**：T2.2

### T2.7 · WS 出站单 writer 串行化 / 不变式验收 (S)

- **Scope**：把 T2.3 里预留的 `outboundQueue` 落实为"独立 writer loop `while (queue.length) ws.send(queue.shift())`"；审 `httpServer.ts` / `controlBridge.ts` / `serverSession.ts` 确保**没有任何 `ws.send` 绕过队列**；写一段 grep 级静态检查脚本防止回归
- **Usecase**：client 端按行解析 NDJSON，两个 writer 会交叉字节流破坏协议；本任务锁定不变式
- **验证**：压测脚本短时间内触发 10 条 assistant + 2 条 control_request 同时入队，client 端解析无错位；`grep -rn "ws.send" src/server/` 除 writer loop 本身之外无其他结果
- **依赖**：T2.3

### T2.8 · WS 断连期 pending + grace period + 超时 deny (M)

- **Scope**：WS 断开 → session 转 `detached`，`control_request` 进 pending 队列（上限 16，超限 deny）；重连 → 按序补发；grace period（默认 60s）过期 → pending 全部 deny + lang event
- **Usecase**：interactive 模式客户端偶尔掉线不应该整 session 挂掉；grace 到期避免永远挂
- **验证**：起 interactive session → 刻意断 WS → 让 server 端触发权限请求 → pending 队列 size=1 → 重连后 client 收到该 request；另一个场景：断连 60s 后再连，tool 报 `ws_disconnect_timeout`
- **依赖**：T2.4, T2.7

---

## Phase 3 — 多会话 + 权限双模式（L 合计）

### T3.0 · **BLOCKER**：`bootstrap/state.ts` AsyncLocalStorage 改造 (L) [§11.1]

- **Scope**：`grep -rn "from.*bootstrap/state" src/` 先扫 blast radius；把模块级可变单例（`sessionId` / `promptId` / `persistenceDisabled` / 其他）包进 `AsyncLocalStorage<SessionContext>`；所有 getter 改读 ALS context；找不到 context fallback 到模块级默认值（兼容 CLI build）
- **Usecase**：M2 多 session 共享进程的**硬前提**；不改就会有多 session 串扰
- **验证**：`cli.exe` 跑原 REPL 行为不变（回归测试）；server 两个 session 并发 submitMessage，各自的 `getSessionId()` 返回自己的 sid；transcript / logEvent 归属正确
- **依赖**：无（阶段 3 最先做）
- **注意**：如 blast radius 远超预估，升级到 XL 并拆子任务；不能推迟到阶段 3 之后

### T3.2 · 新增 `src/server/sharedAssembly.ts` (M)

> 编号保留为 T3.2（向后兼容），但**实现顺序在 T3.1 之前**——sessionRegistry 依赖本任务产物。

- **Scope**：`bootSharedAssembly(cfg): Promise<SharedAssembly>` 启动时一次性装配 base tool definitions（`getAllBaseTools()` 的不可变源）、MCP 连接池、plugin cache / registry、agent definitions；`Object.freeze` 后注入每个 session。**最终可见 tool pool 仍由每个 session 按 `permissionContext` + session MCP tools 调 `assembleToolPool()` 生成**
- **Usecase**：避免重复初始化重资源，同时保留 cwd / permission / MCP / plugin 差异导致的 per-session tool filtering
- **验证**：启动 server 后 `sharedAssembly` 单例不变；两个 session 使用不同 `deniedTools` 时可见 tool 列表不同；base tool definition registry 可共享引用
- **依赖**：T3.0

### T3.1 · 新增 `src/server/sessionRegistry.ts` (M)

- **Scope**：`Map<sid, ServerSession>` + LRU idle timeout + `closeAll()` + `create()` / `get()` / `close()` API；**扩展 T2.5 的 SIGINT handler 串入 `closeAll()`**
- **Usecase**：阶段 2 只有单 session，这里把多 session 管起来；同时把 session 级清理接入进程退出链路
- **验证**：脚本并发创建 3 个 session，依次 close，map size 回零；idle timeout 触发的 session 被正确清理；SIGINT 时所有 session 被 close 后再 exit
- **依赖**：T2.3, T3.0, T3.2（需要 sharedAssembly 注入新 session）

### T3.3 · 新增 `src/server/permissionPolicy.ts` 规则引擎 (M)

- **Scope**：纯函数 `(toolName, input, sessionContext) => PermissionResult`；规则来源：session 创建时传的 `allowedTools` / `deniedTools` / `permissionMode`；支持 glob（`Bash(npm test*)`）复用 `utils/permissions/permissions.ts` 的解析函数
- **Usecase**：policy 模式的核心；CI/脚本场景不需要人工审批
- **验证**：unit 冒烟：`policy.check('Bash', 'npm test', ctx)` allow；`policy.check('Bash', 'rm -rf /', ctx)` deny（规则 `Bash(rm *)` 在 deniedTools）
- **依赖**：无（纯函数，独立）

### T3.4 · 新增 `src/server/permissionHandler.ts` 分派器 (S)

- **Scope**：`createPermissionHandler(session): CanUseToolFn`；按 session 的 `permissionHandling` 调 `controlBridge`（interactive）或 `permissionPolicy`（policy）；interactive 60s 超时 deny
- **Usecase**：P3 per-session 切换的核心；统一接口让 QueryEngine 不感知模式
- **验证**：interactive session 调一次 tool → 触发 controlBridge；policy session 调同一 tool → 直接 policy 决策无 control_request
- **依赖**：T2.4, T3.3

### T3.5 · `serverSession.ts` 注入 permissionHandler 到 QueryEngine (S)

- **Scope**：`new QueryEngine({ canUseTool: permissionHandler, ...shared })`
- **Usecase**：把 T3.4 接进 query loop；T2.3 的 serverSession 先用简单 allow-all，本步替换成真实 handler
- **验证**：阶段 3 e2e 场景（见下方 §E2E T3-Smoke）
- **依赖**：T3.4

### T3.6 · MCP 池引用计数 OR MVP fallback (M · L) [§11.4]

- **决策点**：实施开始前先 `grep` 现有 `src/services/mcp/*` 的 client 池是否支持多消费者语义
- **路径 A（引用计数，首选）**：session 创建 `refcount++`；关闭 `refcount--`；`refcount==0` 进 idle，`CC_SERVER_MCP_IDLE_MS` 后 kill 子进程
- **路径 B（MVP fallback）**：进程启动期按 env 一次性装配 MCP，不支持 per-session MCP 差异；实施时在 spec §11.4 回填"MVP 限制"标记
- **Usecase**：防止"一个 session 结束 kill 掉子进程，别的 session 还在用它" bug
- **验证（A）**：两个 session 同时用同一 MCP server；一个关，另一个继续工作；idle 时长过去，子进程被回收
- **验证（B）**：单 session 正常工作，多 session 测试跳过并文档标注限制
- **依赖**：T3.2（MCP 池实体在 sharedAssembly 里）

### E2E · T3-Smoke 两 session 并发 + 权限 (S)

- **Usecase**：阶段 3 的综合验证
- **步骤**：启两个 client；一个 `permissionHandling=policy` 跑 `bash echo hi` 直过；另一个 interactive 跑同命令弹权限 → allow；同时运行期间 `dist/cli-server.exe` 内存 / CPU 不泄漏；断言两 session 的 `mutableMessages` / `readFileState` / `totalUsage` 完全独立（注入 log 打印 session id + state hash）
- **依赖**：T3.5, T3.6

---

## Phase 4 — DCE 收紧（M 合计）

### T4.1 · 新增 `src/utils/buildTarget.ts` 导出 `IS_SERVER_BUILD` (XS)

- **Scope**：`export const IS_SERVER_BUILD = feature('SERVER_BUILD')`；编译期折叠
- **Usecase**：全 codebase 共用一处真值来源，不让 `feature('SERVER_BUILD')` 散落各处
- **验证**：server build 的 bundle 里 `IS_SERVER_BUILD` 折叠为 `true`；CLI build 折叠为 `false`（`bun build --analyze` 或肉眼 grep bundle）
- **依赖**：T1.4

### T4.2 · Ink 依赖审计（`bun build --analyze`） (S)

- **Scope**：`bun run scripts/build.ts server --no-compile --analyze > analyze.txt`；grep `ink`, `ink-*`, `@inkjs/ui`, `src/components`, `src/screens`, `src/ink`；列出所有牵连文件到 `docs/plans/server-build-leaks.md`（临时文档，合并后删）
- **Usecase**：T4.3 / T4.4 的输入清单；不瞎猜
- **验证**：清单至少包含已知的 `MessageSelector.tsx` 和几个 tool 的 renderResult
- **依赖**：T4.1

### T4.3 · 漏点 A：抽 `src/utils/messageSelection.ts` pure-logic (M)

- **Scope**：把 `MessageSelector.tsx` 里的过滤逻辑抽出为纯函数；`QueryEngine.ts` 在 `IS_SERVER_BUILD` 分支下直接 import pure-logic 版；React 版继续给 CLI build 用
- **Usecase**：消除 QueryEngine 对 Ink/React 的 lazy require 牵连
- **验证**：server bundle `--analyze` 无 `MessageSelector.tsx` / `ink`；CLI REPL 的 `/select-messages` 功能不回归
- **依赖**：T4.2

### T4.4 · 漏点 B：tool 拆 `.logic.ts` + `.ui.tsx` (M · L)

- **Scope**：T4.2 清单里的 tool 逐一拆分（参考已有 `tools/*/PromptRenderer.tsx` 模式）；server build 下 tool 只加载 `.logic.ts`，`renderResult` 返回 `{ type: 'text', text: ... }` POJO
- **Usecase**：消除 tool 模块顶层的 `from 'ink'` side-effect
- **验证**：server bundle 无 Ink；CLI 下 tool UI 渲染不变（跑一遍 REPL 内 Read/Grep/Edit 各一次）
- **依赖**：T4.2
- **注意**：工作量取决于 T4.2 清单长度；长则拆子任务

### T4.5 · `scripts/build.ts` server external guardrail (XS)

- **Scope**：确认 server target **不**把已安装 UI runtime（`ink`, `ink-*`, `@inkjs/ui`, React 渲染层等）加入 `EXTERNALS`；必要时在 build script 加注释 / 静态断言。T4.3/T4.4 若漏 import，必须用 gating / pure-logic split / server-only shim 修掉
- **Usecase**：避免 `bun --compile` 编译通过但运行期 `Cannot find module 'ink'`
- **验证**：`scripts/build.ts` 里没有 `ink` / `@inkjs/ui` external；server bundle analyze 无 UI runtime import；若使用 shim，运行一次 Read tool 不触发真实 Ink require
- **依赖**：T4.1

### T4.6 · Plugin Ink shim fallback（**条件触发**）(S)

- **触发条件**：T4.2 扫描报告里发现至少一个 plugin 自带 `import 'ink'` / Ink 组件；否则本任务跳过并在 `roadmap.md` 打 `[-]`（搁置）
- **Scope**：server build 下 plugin loader 注入 Ink shim（空 `render()` / 空 `Box` 等）
- **Usecase**：第三方 plugin 自己 `import 'ink'` 也不炸
- **验证**：已知带 Ink 的 plugin 在 server 下 load 不报错，但 UI 部分 no-op
- **依赖**：T4.2（判条件）, T4.5

### E2E · T4-Smoke bundle 体积 + 启动 (XS)

- **Usecase**：Phase 4 成果量化
- **步骤**：`ls -la dist/cli-server.exe` 体积 ≤ 85MB（目标 80，shim 兜底时 85）；`./dist/cli-server.exe` 启动跑 Read tool 一次，stdout 无任何 Ink escape 序列
- **依赖**：T4.3, T4.4, T4.5

---

## Phase 5 — LangFuse 埋点（L 合计）

### T5.1 · 新增 `src/services/lang/tracer.ts` 接口 (S)

- **Scope**：导出 `LangTracer` / `SpanKind` / `SessionHandle` / `SpanHandle` / `GenerationHandle` / `SessionMeta` / `SessionSummary` / `SpanSpec` / `SpanOutcome` / `EventSpec`；严格按 spec §5.1
- **Usecase**：所有埋点代码只知道接口，不绑 LangFuse；将来换后端只改 `getLangTracer`
- **验证**：TypeScript 编译通过；后续 T5.2 / T5.3 都能 `implements LangTracer`
- **依赖**：无

### T5.2 · 新增 `src/services/lang/noopTracer.ts` (XS)

- **Scope**：所有方法空实现；`getLangTracer()` 默认返回 `NoopTracer`
- **Usecase**：没配 LangFuse key 时服务正常跑
- **验证**：不设任何 LANGFUSE env → CLI / server 都能跑通一次 submitMessage；无 log 噪音
- **依赖**：T5.1

### T5.3 · 新增 `src/services/lang/langfuseTracer.ts` (L)

- **Scope**：LangFuse SDK 懒加载（无 key 时 skip import）；`startSession` 创 trace、`startSpan` 创 span、`startGeneration` 创 generation；map `SpanKind` 到 LangFuse 的概念；`flush()` 调 SDK flush
- **Usecase**：Phase 5 的主要产出
- **验证**：配好 env → 跑一次 submitMessage → LangFuse UI 出现完整 trace 树（session → user_prompt → query_turn → generation）
- **依赖**：T5.1, T0.1（LangFuse 实例可达）, T2.0（SPIKE 结论）

### T5.4 · 新增 `src/services/lang/redactor.ts` 独立脱敏 (S) [§11.2]

- **Scope**：独立 redact 函数；**不 import 任何 `utils/telemetry/*`**；支持 `LANG_TRACER_REDACT_PATTERNS` 的正则列表
- **Usecase**：避开 PR#1 把 `redactIfDisabled` 改成恒返 `<REDACTED>` 的陷阱
- **验证**：`grep "redactIfDisabled" src/services/lang/` 无结果；LangFuse UI 里肉眼确认 trace 内容非 `<REDACTED>`
- **依赖**：T5.1

### T5.5 · 新增 `src/services/lang/context.ts` ALS 贯穿 submitMessage (M)

- **Scope**：`AsyncLocalStorage<TraceContext>`；`runInTrace(ctx, fn)` 包住整个 `submitMessage`；`getCurrentTrace()` 给埋点点读当前 span 栈
- **Usecase**：埋点代码不用把 tracer / parentSpan 到处传，靠 ALS 隐式注入
- **验证**：在 LLM 埋点处 `getCurrentTrace()` 能拿到外层 `query_turn` span；并发两个 session 互不串
- **依赖**：T5.1, T3.0（同类 ALS 改造，务必复用或对齐模式）

### T5.6 · 新增 `src/services/lang/propagation.ts` trace header (S)

- **Scope**：序列化 / 反序列化 W3C `traceparent` header（32 hex trace id + 16 hex span id）；可选解析 / 镜像 `langfuse-trace-id` / `langfuse-parent-id` 作为自家 gateway 兼容别名
- **Usecase**：外部系统（gateway / 前端）传 trace context 来，server 延续同一棵 trace；不启用 OTel exporter
- **验证**：WS connect headers 或可选 REST adapter 带 `traceparent` → server 创建的 root span parent_id 正确；server 返回 / 推送 trace id 供前端展示链接
- **依赖**：T5.1

### T5.7 · 埋点 `services/api/logging.ts`（LLM generation）(M)

- **Scope**：LLM 请求起止插 `startGeneration(input)` / `endGeneration(output)`；带 model / messages / usage / cost；**所有 prompt / response 字段过 `redactor.ts`（T5.4），不走 `redactIfDisabled`**
- **Usecase**：最核心埋点，全 trace 的 tokens/cost 数据都出自这里
- **验证**：LangFuse UI 的 generation 有完整 model / input tokens / output tokens / cost / messages；messages 字段内容非 `<REDACTED>`
- **依赖**：T5.3, T5.4, T5.5

### T5.8 · 埋点 `services/tools/toolExecution.ts`（tool span）(S)

- **Scope**：tool 执行起止插 `startSpan({kind:'tool', name:toolName})`；in/out 带 input + output summary；**input/output 过 T5.4 redactor**
- **Usecase**：trace 里看到 "调了哪些 tool、每个多久、输入输出"
- **验证**：一次 Read → LangFuse 里 query_turn 下挂 `tool Read` span，time / in / out 齐；in/out 非 `<REDACTED>`
- **依赖**：T5.3, T5.4, T5.5

### T5.9 · 埋点 `utils/hooks.ts`（hook span）(S)

- **Scope**：hook 执行起止插 `startSpan({kind:'hook', name})`；parent 是触发 hook 的 tool span
- **Usecase**：看到 PostToolUse / PreToolUse 钩子执行
- **验证**：配一个 PostToolUse:Edit hook → 编辑后 LangFuse 里对应 tool Edit span 下挂 `hook PostToolUse` span
- **依赖**：T5.3, T5.5

### T5.10 · 埋点 `processUserInput/*`（user_prompt span）(S)

- **Scope**：`processTextPrompt.ts` 插 `startSpan({kind:'user_prompt', subtype:'text'})`；`processSlashCommand.tsx` 插 `subtype:'slash', command`；**prompt 文本过 T5.4 redactor**
- **Usecase**：trace root 第一层看到用户具体说的/敲的命令
- **验证**：敲 `/clear` → LangFuse 里 session 下挂 `user_prompt slash /clear` span；文本非 `<REDACTED>`
- **依赖**：T5.3, T5.4, T5.5

### T5.11 · 埋点 `tools/AgentTool/runAgent.ts`（agent 子树根）(M)

- **Scope**：subagent 启动插 `startSpan({kind:'agent', agentType, isolation})`；subagent 全过程 ALS context 延续这个 span 做 parent；**prompt / 返回消息过 T5.4 redactor**
- **Usecase**：subagent 的嵌套 query_turn / tool 都归到它自己的 agent span 下，不污染主 trace 线性结构
- **验证**：主 agent 触发 Task/AgentTool → LangFuse 里看到 agent 子树（带独立 query_turn 链）；subagent prompt 内容非 `<REDACTED>`
- **依赖**：T5.3, T5.4, T5.5, T3.0

### T5.12 · 埋点 `QueryEngine.ts`（query_turn span）(S)

- **Scope**：每轮 turn 起止插 `startSpan({kind:'query_turn', turn_index})`；`ToolUseContext` 里加 `tracer: LangTracer` 字段
- **Usecase**：trace 中层结构；每轮 generation + tools 都挂在一个 turn 下
- **验证**：多轮对话 → LangFuse 里每轮独立 query_turn span
- **依赖**：T5.3, T5.5

### T5.13 · 埋点 `server/permissionHandler.ts`（permission event）(S)

- **Scope**：每次权限决策调 `tracer.event({kind:'permission', tool, decision, mode, rule})`；interactive 额外记审批时长
- **Usecase**：trace 里看到"哪次 tool 被拒、依据哪条规则"
- **验证**：policy deny 场景 → LangFuse 里对应 tool span 同级有 permission event，带规则文本
- **依赖**：T5.3, T3.4

### T5.14 · LLM 出站 header 注入（`services/api/client.ts`）(M)

- **Scope**：**用 T5.6 `propagation.ts` 的序列化函数**在 Anthropic SDK client 工厂或 fetch wrapper 注入 `traceparent`；每轮 generation 前用 ALS context 的当前 span 覆盖；可额外镜像 `langfuse-trace-id` / `langfuse-parent-id` 给自家 gateway；fallback 到 fetch monkey-patch
- **Usecase**：外部 gateway（LiteLLM / CLIProxyAPI / 自建）若也接 LangFuse / OTel，两棵 trace 自动合并
- **验证**：`ANTHROPIC_BASE_URL` 指向一个记录 header 的 mock gateway → gateway log 看到 `traceparent` 且 trace id 与 CC generation 的 trace_id 一致
- **依赖**：T5.3, T5.5

### T5.15 · Tracer metadata 不走 `getAttributionHeader` (XS) [§11.3]

- **Scope**：`LangfuseTracer.startSession()` 的 metadata 直接读 `package.json::version` + `process.env.CLAUDE_CODE_BUILD_TARGET`；不 import `constants/system`
- **Usecase**：避开 PR#6 把 `getAttributionHeader` 改成 `''` 的陷阱
- **验证**：LangFuse trace root metadata 里 `cc_version`, `build_target` 字段有值
- **依赖**：T5.3

### E2E · T5-Smoke LangFuse 全链路 (S)

- **Usecase**：Phase 5 综合验证，对标 spec §5.3 的典型 trace 树
- **步骤**：server 配 LangFuse → client 连上 → "列出 README.md" → LangFuse UI 出现：`session` > `user_prompt(text)` > `query_turn` > `generation` + `tool LS` + `tool Read`；subagent 场景验证 agent 子树；gateway propagation 场景验证 trace id 串一棵树
- **依赖**：T5.3, T5.7–T5.14

---

## 跨阶段 · 端到端验证清单

对应 spec §8，所有阶段合并后跑一遍。

| ID | 场景 | 前置任务 |
|---|---|---|
| TE.0 | T3.0 改造后 CLI REPL 冒烟（回归防线） | T3.0 |
| TE.1 | 并发 3 session，trace 不串 | T3.0, T3.1, T5.5 |
| TE.2 | interactive → deny 路径 | T3.4, T2.4, T5.13 |
| TE.3 | policy 直接决策 | T3.3, T3.4, T5.13 |
| TE.4 | WS 断连 + pending + grace timeout | T2.8 |
| TE.5 | CC + gateway 一棵树（`traceparent`） | T5.14, T5.6 |
| TE.6 | LangFuse 宕机降级 | T5.2, T5.3 |
| TE.7 | 进程 SIGINT/SIGTERM 最后 flush 成功 | T2.5, T5.3 |

**TE.0 详细**：T3.0（`bootstrap/state.ts` ALS 改造）合并后立刻跑 `bun run build && ./dist/cli.exe` 启 REPL，至少：`/help` 显示命令、读一个文件、运行一次 Bash tool、查一次 Agent subagent、Ctrl-C 干净退出。观察 transcript / session id 行为与改造前一致。**越早验证越好，不要等到 Phase 5 结束才跑**。

每条跑通在 `roadmap.md` 对应位置打勾。

---

## 任务依赖图（简）

```
T0.1 (基建) ──▶ T0.2 ──▶ T2.0 SPIKE ──▶ T5.3

T1.1, T1.2, T1.3 (三条独立) ──▶ T1.4 ──▶ T1.5 ──▶ T1.6

T2.1 (独立) ──▶ T2.2 ──▶ T2.3 ──▶ T2.7 ──▶ T2.4 ──▶ T2.8
                         └────▶ T2.5 (SIGINT/SIGTERM 基础版)
                         └────▶ T2.6 (auth)

T3.0 BLOCKER ──▶ TE.0 (CLI 回归，越早越好)
            ──▶ T3.2 (sharedAssembly，先于 T3.1)
                   └──▶ T3.1 (sessionRegistry，扩展 SIGINT handler)
                         └──▶ T3.5 ──▶ T3-Smoke
            ──▶ T3.6 (并行，依赖 T3.2)
T3.3 (独立) ──▶ T3.4 ──▶ T3.5

T4.1 ──▶ T4.2 ──▶ T4.3, T4.4 (并行)
             └──▶ T4.6 (条件触发)
T4.1 ──▶ T4.5
T4.3 + T4.4 + T4.5 ──▶ T4-Smoke

T5.1 ──▶ T5.2, T5.3, T5.4, T5.6 (并行)
T5.3 + T3.0 ──▶ T5.5
T5.3 + T5.4 + T5.5 ──▶ T5.7, T5.8, T5.10, T5.11
T5.3 + T5.5 ──▶ T5.9, T5.12
T5.3 + T3.4 ──▶ T5.13
T5.3 + T5.5 + T5.6 ──▶ T5.14
T5.3 ──▶ T5.15
全部 T5.x ──▶ T5-Smoke

E2E (TE.0…7) 按表中"前置任务"列决定可跑时机
```

- **前置阻塞项（Day 1 就开工）**：T0.1（LangFuse 部署）· T2.0（SPIKE）· T3.0（ALS 改造）
- **TE.0 CLI 回归**必须紧跟 T3.0 完成后立即跑，不能等到最后
- Phase 3 内部顺序变化：**T3.2 先于 T3.1**（sharedAssembly 是 sessionRegistry 的物料前置）
- T3.3 / T2.1 / T1.3 / T5.3(+T5.4+T5.6) 可并行推进，不再串在主路径上

---

## 回填约定

- 任务完成后，**此处不必勾选**（此文档是静态分解）；去 `roadmap.md` 勾对应条目
- 实施中若发现新任务（例如 T4.2 扫出来超长清单），回本文档**加 T4.4.1 / T4.4.2 等子任务**，同步加到 `roadmap.md`
- 任务规模偏离预估档位超 2 倍（比如 M 做成 L），在任务条目末尾加 `(实际: L)`，供后续工时估算反馈
