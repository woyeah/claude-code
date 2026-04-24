import { existsSync, chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const pkg = await Bun.file(new URL('../package.json', import.meta.url)).json() as {
  name: string
  version: string
}

const args = process.argv.slice(2)
const compile = args.includes('--compile') || !args.includes('--no-compile')
const dev = args.includes('--dev')

// 所有我们想启用的 compile-time feature。想关的就注释掉。
// Bun 的 `--feature=X` 直接让源码里 `feature('X')` 求值为 true，
// 不在列表里的就是 false，并被 DCE。
const ENABLED_FEATURES = [
  // 默认保守，先都关着让它先跑起来
  // 'BRIDGE_MODE',
  // 'COORDINATOR_MODE',
  // 'KAIROS',
  // 'PROACTIVE',
  // 'BUDDY',
  // 'VOICE_MODE',
]

// 这些包要么是 Anthropic 内部的 native addon，要么我们没 stub
// 标成 external 就不会被打进 bundle（运行时如果真的调到会炸，但只要
// 相关代码路径被 feature flag DCE 掉就没事）
// 只把这些标 external：要么是原生 addon 我们没安装，要么 feature gate 关了不会真的加载，
// 要么是可选云厂商 SDK 只在对应 provider 启用时才 require。
// 真正装了的 npm 包（@anthropic-ai/sdk、yaml、jsonc-parser 等）不能 external，
// 否则 bun --compile 出来的单文件运行时找不到。
const EXTERNALS = [
  '@ant/*',
  // OTLP exporters — telemetry 默认关
  '@opentelemetry/exporter-logs-otlp-grpc',
  '@opentelemetry/exporter-logs-otlp-http',
  '@opentelemetry/exporter-logs-otlp-proto',
  '@opentelemetry/exporter-metrics-otlp-grpc',
  '@opentelemetry/exporter-metrics-otlp-http',
  '@opentelemetry/exporter-metrics-otlp-proto',
  '@opentelemetry/exporter-prometheus',
  '@opentelemetry/exporter-trace-otlp-grpc',
  '@opentelemetry/exporter-trace-otlp-http',
  '@opentelemetry/exporter-trace-otlp-proto',
  // 只在对应 provider 被选中时才 dynamic import
  '@aws-sdk/client-bedrock',
  '@aws-sdk/client-sts',
  '@azure/identity',
  '@anthropic-ai/bedrock-sdk',
  '@anthropic-ai/foundry-sdk',
  '@anthropic-ai/vertex-sdk',
]

const buildTime = new Date().toISOString()
const version = dev ? `${pkg.version}-dev.${Date.now()}` : pkg.version

// 把源码里直接写 `MACRO.VERSION` 之类的访问点编译期替换成字面量
const DEFINES: Record<string, string> = {
  'process.env.USER_TYPE': JSON.stringify('external'),
  'process.env.CLAUDE_CODE_FORCE_FULL_LOGO': JSON.stringify('true'),
  'MACRO.VERSION': JSON.stringify(version),
  'MACRO.BUILD_TIME': JSON.stringify(buildTime),
  'MACRO.PACKAGE_URL': JSON.stringify(pkg.name),
  'MACRO.NATIVE_PACKAGE_URL': 'undefined',
  'MACRO.FEEDBACK_CHANNEL': JSON.stringify('github'),
  'MACRO.ISSUES_EXPLAINER': JSON.stringify('local research build; no internal issue routing'),
  'MACRO.VERSION_CHANGELOG': JSON.stringify('local build'),
}
if (dev) {
  DEFINES['process.env.NODE_ENV'] = JSON.stringify('development')
}

const outfile = dev ? './dist/cli-dev' : './dist/cli'
mkdirSync(dirname(outfile), { recursive: true })

const cmd: string[] = [
  'bun', 'build', './src/entrypoints/cli.tsx',
  '--target', 'bun',
  '--format', 'esm',
  '--conditions', 'bun',
  '--packages', 'bundle',
]
if (compile) cmd.push('--compile', '--outfile', outfile)
else cmd.push('--outdir', './dist')

for (const ext of EXTERNALS) cmd.push('--external', ext)
for (const feat of ENABLED_FEATURES) cmd.push(`--feature=${feat}`)
for (const [k, v] of Object.entries(DEFINES)) cmd.push('--define', `${k}=${v}`)

console.log('$', cmd.join(' '))
const proc = Bun.spawnSync({ cmd, stdout: 'inherit', stderr: 'inherit' })
if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1)

if (compile && existsSync(outfile)) chmodSync(outfile, 0o755)
console.log(`✓ built ${compile ? outfile : './dist/'}`)
