# DEPLOYMENT

从泄露的 Claude Code sourcemap 快照到可运行单文件可执行程序的构建记录。

## 前置

- Bun ≥ 1.3.x
- 磁盘空间 ~1 GB（node_modules ~600 MB + dist ~150 MB）

## 一行构建

```bash
bun install
bun run build        # 产出 ./dist/cli.exe（Windows）或 ./dist/cli（*nix），~130 MB
./dist/cli.exe --version
./dist/cli.exe --help
```

交互模式：
```bash
./dist/cli.exe       # 需要 ANTHROPIC_API_KEY 环境变量，或先 claude login 过 OAuth
```

非交互：
```bash
./dist/cli.exe -p "你好" --output-format text
```

## 构建脚本说明

`scripts/build.ts` 调用：

```
bun build ./src/entrypoints/cli.tsx \
  --target bun --format esm --conditions bun \
  --packages bundle \
  --compile --outfile ./dist/cli \
  --external <...> \
  --define process.env.USER_TYPE='"external"' \
  --define MACRO.VERSION='"..."' ...
```

- **`--packages bundle`**：Bun 原生处理 `bun:bundle` 伪模块，不需要 polyfill。
- **`--feature=X`**：让源码里的 `feature('X')` 编译期变 `true`，其他全部变 `false` 并 DCE（默认 `ENABLED_FEATURES = []` 即全关）。
- **`--define process.env.USER_TYPE='"external"'`**：把所有 `USER_TYPE === 'ant'` 的分支常量折叠成 false，消除 Anthropic 内部代码路径。
- **`--define MACRO.X='"..."'`**：把源码里裸访问的 `MACRO.VERSION` 之类在编译期替换为字面量，不需要运行时注入 `globalThis.MACRO`。
- **`--external`**：只用于真不存在或确定被 DCE 不会 require 的包（@ant/* 动态 import 分支、OTLP exporter、云厂商 SDK）。**真正装过的 npm 包不能 external**，否则 `--compile` 产出的单文件运行时找不到。

## 目录结构

```
./
├── package.json                # deps + 本地 stub 包用 file: 引
├── tsconfig.json               # paths: "src/*": ["./src/*"]
├── bunfig.toml
├── scripts/build.ts            # 构建入口
├── stubs/ant-packages/         # 8 个 stub 包（file:引入）
│   ├── @ant/claude-for-chrome-mcp/
│   ├── @ant/computer-use-mcp/
│   ├── @ant/computer-use-swift/
│   ├── color-diff-napi/
│   ├── audio-capture-napi/
│   ├── modifiers-napi/
│   ├── image-processor-napi/
│   └── url-handler-napi/
│   # sharp 和 turndown 已换回真包，见 package.json
├── src/                        # 所有源码（泄露的 ~1900 个文件都在这儿）
│   ├── entrypoints/cli.tsx     # 真入口，末尾自带 void main()
│   ├── main.tsx                # CLI 命令注册 + action handler
│   └── [……其余省略]
└── dist/
    ├── cli.js                  # ~19 MB ESM bundle
    └── cli.exe                 # ~130 MB 单文件可执行
```

## 关键认知（不理解就会走弯路）

### 1. 真入口是 `src/entrypoints/cli.tsx`，不是 `main.tsx`

泄露的 `main.tsx` 只 `export async function main()`，**顶层没人调用它**。直接 `bun src/main.tsx` 会静默退出 0。

真正的自调用入口是 `src/entrypoints/cli.tsx`，末尾有 `void main()`，内部做 fast-path 分派后 `await import('../main.js')` 再 `await cliMain()`。

### 2. Anthropic 收购了 Bun，所以 `bun:bundle` 是 Bun 一等公民

`feature()` / `--packages bundle` / `--compile` / `--feature=` 这些都是 Bun 原生支持的，不是什么要手写的 polyfill。

其他 fork（T-Lab-CUHKSZ、claude-code-deepseek）绕了一大圈手写 polyfill + 86 个 stub 文件 + 包装器脚本，**完全没必要**。

### 3. 外部化 (`--external`) 是双刃剑

- **已装的真包不能 external**：会编译通过但运行时报 `Cannot find module`
- **真缺的 stub 包 / 仅在某 feature 下 dynamic import 的包可以 external**：对应的 require 路径被 DCE 掉就没事

当前这些被 external：OTLP exporters、`@aws-sdk/client-bedrock`、`@azure/identity`、Bedrock/Foundry/Vertex SDK —— 都是只在对应 provider 启用时才 dynamic import 的。

## stub 策略

两类 stub：

**A. stub npm 包**（`stubs/ant-packages/*`，共 8 个）

- **3 个 `@ant/*`**（`claude-for-chrome-mcp`、`computer-use-mcp`、`computer-use-swift`）——npm registry 上 **404 不存在**，Anthropic 私有 scope
- **5 个 `*-napi`**（`audio-capture`、`color-diff`、`image-processor`、`modifiers`、`url-handler`）——npm 上存在，但都是 Anthropic 团队抢注的 228-byte 占位包（描述 `"This package name has been reserved"`，UNLICENSED），装了等于没装。`image-processor-napi` 的创建日期正好是 2026-03-31 sourcemap 泄露当天，像是事件后快速占坑
- 用 ES module 语法显式 `export const Name = stub`，因为 Bun 编译期做静态 named-export 校验，Proxy 不行

> 注：`sharp` 和 `turndown` 原来也在 stub 列表里（我们当时为了 bundle 体积 stub 掉），但它们是真公网包，现在已经换回真实现（`package.json` 里 `"sharp": "^0.34.5"` / `"turndown": "^7.2.4"`），FileRead 读图和 WebFetch HTML→Markdown 的功能随之恢复。

Stub 模板：
```javascript
// stubs/ant-packages/xxx/index.mjs
const stub = () => undefined
export const SOME_NAME = []
export const someFunc = stub
export default stub
```

**B. stub 源文件**（`src/.../stub.ts`）

泄露里缺的 feature-gated 模块（`TungstenTool`、`WorkflowTool/constants`、`components/agents/SnapshotUpdateDialog`、`cachedMicrocompact` 等）。
大部分就是：
```typescript
// Stub: feature-gated
const stub: any = new Proxy({}, { get: () => () => undefined })
export default stub
export {}
```

有具名导出的按需填：
```typescript
// src/types/connectorText.ts
export interface ConnectorTextBlock { type: 'connector_text'; text: string }
export function isConnectorTextBlock(block: any): block is ConnectorTextBlock {
  return block?.type === 'connector_text'
}
```

## 已打过的源码补丁

1. **`src/main.tsx:976`** —— Commander.js 不接受 `-d2e` 当短 flag（短 flag 必须单字符），改：`'-d2e, --debug-to-stderr'` → `'--debug-to-stderr'`。

## 打开 feature flag

改 `scripts/build.ts` 里的 `ENABLED_FEATURES` 数组：

```typescript
const ENABLED_FEATURES = [
  'BUDDY',           // Tamagotchi 宠物
  'COORDINATOR_MODE', // 多 agent 协调
  'KAIROS',          // 常驻助理
  'ULTRAPLAN',       // 30 分钟远程规划
  // ...
]
```

然后 `bun run build`。注意：打开的 feature 可能引入新的缺失模块（那部分是 DCE 掉的 stub），需要继续补 stub。

## 重复构建

代码改动后：
```bash
bun run build               # --compile 单文件
bun run build:nocompile     # 出 bundle 不编译，便于 debug
bun run build:dev           # dev 模式，版本号带时间戳
```

`bun run typecheck` 可以只做类型检查（大概率会有一堆错误，因为 stub 不完整，但不影响构建）。

## 排错速查

| 症状 | 原因 | 修法 |
|---|---|---|
| `bun src/main.tsx` 无输出退 0 | 没人调 `main()` | 改用 `src/entrypoints/cli.tsx`，或写个 wrapper 显式调 |
| `Cannot find module '@xxx/yyy'` 编译期 | 包没在 deps 里 | `bun add @xxx/yyy` 或加进 stubs |
| `Cannot find module '@xxx/yyy'` 运行期（编译过了） | 在 --external 列表但确实需要 | 从 --external 移除，让它被打进 bundle |
| `No matching export in "xxx" for import "Y"` | ESM 静态检查，Proxy stub 不够 | 在 stub 里加 `export const Y = stub` |
| `option creation failed due to '-XYZ'` | Commander 短 flag 非法 | 改 flag 定义为长 flag |
| `Could not resolve: "./foo.js"` 相对路径 | 源文件被 DCE 从泄露里剔掉了 | 在 `src/` 对应路径建 stub |

## 认证

用 `ANTHROPIC_API_KEY` 环境变量，或先跑一次 `claude login`（官方 CLI）走 OAuth 把 token 存到 `~/.claude/.credentials.json`，本地构建版会复用。

WSL 和 Windows 的 `~/` 不同，OAuth 凭据跨不过去，要么在同一 shell 里 login 过，要么用 API key。

## 免责

- 源码来自 2026-03-31 泄露的 npm sourcemap。仅研究用途。
- 我们 stub 掉了 telemetry、Anthropic 内部 SDK、native addon —— 跑起来的版本行为上**不等同**官方发布的 Claude Code。
- 所有 `USER_TYPE === 'ant'` 代码路径（Undercover mode、ConfigTool、TungstenTool、staging API 等）都被 DCE，无法启用。
