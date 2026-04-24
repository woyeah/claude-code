# 用 CLIProxyAPI 把本地 build 接到 GPT-5.4 / 其他 OpenAI 模型

本仓库构建出来的 `./dist/cli.exe` 默认走 Anthropic 官方 API。要改成走自家的 **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** 代理（典型用途：用 GPT-5.4 / Gemini 2.5 / Claude Max 订阅账号），**完全不需要改代码**——源码原生读了 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` 和一组 model 别名 env。

## CLIProxyAPI 是什么

一个反向代理，**同时暴露 OpenAI-compat、Anthropic-compat、Gemini-compat 三种 API 形态**。后端可以是：
- OpenAI 真账号（GPT-5.x）
- Gemini CLI / Antigravity（免费 Gemini 2.5 Pro）
- Claude Code OAuth（把 Claude Max 订阅变成 API 用）
- ChatGPT Codex（订阅账号）

对 Claude Code 来说，我们走它的 **Anthropic-compat 端点**——SDK 调用形状不变，路由由代理决定。

## 环境变量（唯一需要做的事）

```bash
# 代理地址：别带 /v1 结尾，Anthropic SDK 自己会加路径
export ANTHROPIC_BASE_URL=http://192.168.50.135:8317

# Bearer token（cliproxy 自己做鉴权，token 随便起）
export ANTHROPIC_AUTH_TOKEN=sk-cliproxy

# Model 别名：把 Claude 模型名映射成代理后端实际的 model id
# Claude Code 启动时用 --model opus / sonnet / haiku，或内部根据任务自动选
# 这里的映射让三个档位都指向 gpt-5.4
export ANTHROPIC_DEFAULT_OPUS_MODEL=gpt-5.4
export ANTHROPIC_DEFAULT_SONNET_MODEL=gpt-5.4
export ANTHROPIC_DEFAULT_HAIKU_MODEL=gpt-5.4

# 可选：一次性强制所有调用用同一个 model（会覆盖上面三个别名）
# export ANTHROPIC_MODEL=gpt-5.4
```

## 跑起来

```bash
./dist/cli.exe --version                                # 应该还是 0.1.0 (Claude Code)
./dist/cli.exe -p "hello" --output-format text          # 非交互冒烟
./dist/cli.exe                                           # 进交互 REPL
```

`ANTHROPIC_BASE_URL` 一旦设置，源码里这几处都会走代理：
- `src/services/api/client.ts:302` — 主 Anthropic SDK client 构造
- `src/main.tsx:1323` — OAuth config 被 env 覆盖
- `src/utils/apiPreconnect.ts:60` — preconnect 池走代理
- `src/upstreamproxy/upstreamproxy.ts:120` — CCR 容器场景的上游透传

`ANTHROPIC_AUTH_TOKEN` 被当 `Authorization: Bearer <token>` 发出（`src/services/api/client.ts:322-326`）。

## 和 OpenAI SDK 端点共享

同一个 cliproxy 实例，别的工具（比如走 OpenAI SDK 的应用）可以同时用它的 OpenAI-compat 端点：

```bash
# newfeather 之类的 OpenAI SDK 客户端
export OPENAI_BASE_URL=http://192.168.50.135:8317/v1
export OPENAI_API_KEY=sk-cliproxy
```

两边共享一个代理、共享一套后端账号 / 配额，但 URL 路径不同：
- Anthropic-compat（Claude Code 用）：`http://192.168.50.135:8317`（根路径，SDK 自己加 `/v1/messages`）
- OpenAI-compat（其他 SDK 用）：`http://192.168.50.135:8317/v1`

## 排错

| 症状 | 原因 | 修法 |
|---|---|---|
| `401 Unauthorized` | token 没发出去 | 确认 `ANTHROPIC_AUTH_TOKEN` 而不是 `ANTHROPIC_API_KEY`（后者走 `x-api-key` header，cliproxy 通常要 Bearer） |
| `404 Not Found` on `/v1/v1/messages` | URL 写成了 `.../v1` | `ANTHROPIC_BASE_URL` 只到端口，不带 `/v1` |
| 响应里 model 是 `claude-*` 而不是 `gpt-*` | cliproxy 透传了原始 model 名、没触发别名 | 在 cliproxy 侧 config 里配 model routing，或设 `ANTHROPIC_MODEL=gpt-5.4` 强覆盖 |
| 延迟异常 / 超时 | cliproxy → 上游的那一段问题 | 看 cliproxy 自己的日志，Claude Code 这边已经成功发出 |
| Tool use 返回格式错乱 | 后端模型的 tool-calling 能力差异 | GPT-5.x 应能 hold 住；老 GPT 可能需要 cliproxy 里开 tool-call normalization |

## 注意点

- **Prompt caching**（Anthropic 特性）在 OpenAI 后端上可能无效——cliproxy 会吃掉 `cache_control` 字段，或透传但被忽略。成本估算会偏高
- **Extended thinking / reasoning blocks** 在 OpenAI 后端需要后端模型支持（GPT-5 系列 reasoning 模式可对得上；普通 chat completion 对不上）
- **Vision / image blocks** 通常能透传，但图片编码方式可能不同
- **`USER_TYPE='external'`** 在本地 build 里是硬定的，Anthropic staging / internal features 全 DCE，代理做不做都一样

## 相关文档

- [`deployment.md`](./deployment.md) — 怎么 build 出 `./dist/cli.exe`
- [CLIProxyAPI 官方文档](https://help.router-for.me/)
- [CLIProxyAPI GitHub](https://github.com/router-for-me/CLIProxyAPI)
