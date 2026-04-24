// SPIKE T2.0 · Does LangFuse JS SDK work under Bun runtime + bun build --compile?
// Points at a locally-mocked ingestion endpoint (see mock-ingestion.ts) so we do
// NOT depend on a running LangFuse instance. Primary goal is compat, not delivery.

import { Langfuse } from 'langfuse'

const baseUrl = process.env.LANGFUSE_BASE_URL ?? 'http://localhost:3001'
const publicKey = process.env.LANGFUSE_PUBLIC_KEY ?? 'pk-lf-spike'
const secretKey = process.env.LANGFUSE_SECRET_KEY ?? 'sk-lf-spike'

console.log(`[spike] bun=${Bun.version} langfuse-sdk target=${baseUrl}`)

const lf = new Langfuse({
  baseUrl,
  publicKey,
  secretKey,
  flushAt: 1,
  flushInterval: 100,
})

const trace = lf.trace({
  name: 'spike-smoke',
  metadata: { runtime: 'bun', version: Bun.version },
})

const span = trace.span({ name: 'child-span', input: { q: 'hello' } })
span.end({ output: { a: 'world' } })

const gen = trace.generation({
  name: 'mock-llm-call',
  model: 'claude-opus-4-7',
  input: [{ role: 'user', content: 'hi' }],
})
gen.end({
  output: { role: 'assistant', content: 'hi back' },
  usage: { input: 2, output: 3, total: 5 },
})

const t0 = Date.now()
await lf.flushAsync()
console.log(`[spike] flushAsync returned after ${Date.now() - t0}ms`)

await lf.shutdownAsync()
console.log('[spike] shutdownAsync done, exiting clean')
