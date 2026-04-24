# LangFuse 自托管部署指南

> 本文档交付 [`plans/server-mode-tasks.md`](../plans/server-mode-tasks.md) 的 **T0.1 · 基建** 任务：用 Docker Compose 在本机起一套 self-hosted LangFuse，给后续 server-mode + lang-tracing 工作提供 trace 存储端。
>
> 配套清单：
>
> - [`deploy/langfuse/docker-compose.yml`](../../deploy/langfuse/docker-compose.yml) — 6 服务 Compose 栈（web / worker / postgres / clickhouse / redis / minio）
> - [`deploy/langfuse/.env.example`](../../deploy/langfuse/.env.example) — 环境变量模板
>
> 选型说明：LangFuse v3（当前 stable）比 v2 多 clickhouse/redis/minio 三件，是因为 trace 写入链路完全异步化 + 大事件体走对象存储。对开发 / QA 级自托管足够轻，消耗约 2 GB 内存。**不做多副本、不对公网、不接 HTTPS**——这是本地 tracing sink，不是生产服务。

## 1 · 前置

| 项 | 要求 |
|---|---|
| Docker | 24+ |
| Docker Compose | v2（`docker compose` 子命令形式，不是 v1 的 `docker-compose`） |
| 磁盘 | 初始 ~1 GB；trace 量大了 ClickHouse + MinIO 会长，做好卷备份 |
| 端口 | 本机 `127.0.0.1:3000`（Web UI） |

## 2 · 起服务

```bash
cd deploy/langfuse
cp .env.example .env
# 编辑 .env，把所有 CHANGE_ME_* 替换成强随机串
#   openssl rand -hex 32      # Linux/macOS/Git Bash
#   bun -e "console.log(crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,''))"

docker compose up -d
docker compose ps            # 看 6 个服务是否都 healthy
docker compose logs -f langfuse-web    # 第一次启动要跑 DB migration，等到 "ready on :3000"
```

**端口策略**：`docker-compose.yml` 只把 `langfuse-web` 的 3000 映射到 `127.0.0.1`，其余服务全走 Compose 内部网络。需要别的机器访问，**自己在外面加反代 + TLS + 鉴权**，不要改 Compose 暴露。

## 3 · 初始化 project

两条路，任选：

**A. 用 UI 手工建（推荐首次）**：

1. 浏览器开 <http://localhost:3000>
2. 注册第一个账号（会自动变成实例 admin）
3. 建 Organization → 建 Project（取个识别名，如 `claude-code-dev`）
4. 进 Project Settings → API Keys → Create new API keys
5. 记录两把 key：
   - `LANGFUSE_PUBLIC_KEY`：`lf-pk-...`
   - `LANGFUSE_SECRET_KEY`：`lf-sk-...`

**B. 让 Compose 启动时自动建**：

在 `deploy/langfuse/.env` 填所有 `LANGFUSE_INIT_*` 项（特别是 `LANGFUSE_INIT_PROJECT_PUBLIC_KEY` / `LANGFUSE_INIT_PROJECT_SECRET_KEY`），然后 `docker compose up -d`。适合 CI / 多人重复搭建。

## 4 · 把凭证写进仓库

仓库根目录的 `.env.local` 已经在 `.gitignore` 里。**不要**把 secret key 写进任何会被 commit 的文件。

```bash
# 在仓库根目录（不是 deploy/langfuse/）
cat >> .env.local <<EOF
LANGFUSE_PUBLIC_KEY=lf-pk-xxxxxxxxxxxxxxxx
LANGFUSE_SECRET_KEY=lf-sk-xxxxxxxxxxxxxxxx
LANGFUSE_HOST=http://localhost:3000
EOF
```

这三个变量由 T0.2（`.env.local` 约定）+ T1.3（`src/server/config.ts` env loader）+ T5.3（`langfuseTracer.ts` 构造 SDK client）消费。读取优先级：`process.env` > `.env.local` > 默认值。

## 5 · 冒烟验证

`.env.local` 已填好后，用 LangFuse JS SDK 发一条 trace 确认端到端通：

```bash
# 在仓库根
bun add -d langfuse
bun -e '
import { Langfuse } from "langfuse";
const lf = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_HOST,
});
const t = lf.trace({ name: "smoke-test" });
t.span({ name: "hello" }).end();
await lf.flushAsync();
console.log("flushed, see", process.env.LANGFUSE_HOST + "/traces");
'
```

打开 <http://localhost:3000> → Project → Traces，看到 `smoke-test` 即通。**这步是 T2.0 SPIKE 的前半段**——SPIKE 还要确认在 `bun --compile` 产物里也能跑（那部分走 T2.0 任务不是本文）。

## 6 · 常见排错

| 现象 | 原因 | 处置 |
|---|---|---|
| `docker compose up` 后 `langfuse-web` CrashLoopBackoff | DB migration 还没跑完；或 `ENCRYPTION_KEY` 不是恰好 64 hex | `docker compose logs langfuse-web` 看报错；key 长度不对就重生成再 `docker compose down -v && up -d`（**会清数据**） |
| Web UI 登录报 "CSRF" / "invalid session" | `NEXTAUTH_URL` 与浏览器访问地址不一致 | 改 `.env` 的 `NEXTAUTH_URL` 到浏览器实际 URL，`docker compose up -d` 重启 |
| Trace send 成功但 UI 看不到 | ClickHouse 异步入库延迟；或 worker 没启动 | `docker compose ps` 确认 `langfuse-worker` healthy；等 10s；还不行看 `docker compose logs langfuse-worker` |
| MinIO 报 `credentials do not match` | `.env` 里 `MINIO_ROOT_PASSWORD` 改过但 MinIO 卷留着旧密码 | `docker compose down -v` 清卷重来（**会清 blob 数据**） |
| 想升级 LangFuse | 升 major 版本前看 [langfuse changelog](https://github.com/langfuse/langfuse/releases)；补丁版 `docker compose pull && up -d` 即可；**每次升级前 `docker compose exec postgres pg_dump ...` 备份** | — |
| 想完全重来 | `docker compose down -v` 会清所有 volume（postgres + clickhouse + minio）；`docker compose down` 不加 `-v` 只停容器 | — |

## 7 · 凭证轮换 & 备份

- **Public key 泄露**：敏感度低（只能写 trace），在 UI 里 rotate 即可
- **Secret key 泄露**：进 Project Settings 立刻 revoke + 新建一对；把 `.env.local` 里的也换掉；已入库的 trace 不受影响
- **数据备份**：trace 核心数据在 ClickHouse，业务元数据在 Postgres；最小备份：
  ```bash
  docker compose exec -T postgres pg_dump -U postgres postgres | gzip > langfuse-pg-$(date +%F).sql.gz
  docker compose exec -T clickhouse clickhouse-client --password "$CLICKHOUSE_PASSWORD" --query "BACKUP DATABASE default TO Disk('backups','ch-$(date +%F).zip')"
  ```
- **关键 secret**（`SALT` / `ENCRYPTION_KEY` / `NEXTAUTH_SECRET`）：**首部署定下就不要改**，改了历史 API key 全部失效、encrypted 列全部无法解密。另存一份到密码管理器

## 8 · 下一步

LangFuse 起来 + `.env.local` 写好后：

- **T0.2**（secrets 约定）— 本文档第 4 节已经覆盖；只需在 `docs/guides/deployment.md` 加一行指回来即可（实施时再做）
- **T2.0 SPIKE**（LangFuse SDK 在 Bun runtime 冒烟）— 在本节第 5 步基础上再跑一次 `bun build --compile` + 执行产物验证
- **T5.3**（`langfuseTracer.ts` 实现）— 会 import `langfuse` SDK，基于本文档第 4 节写的 env 变量构造 client
