// Minimal mock of LangFuse ingestion endpoint for SPIKE compat testing.
// Accepts POST /api/public/ingestion and logs received batch count + first event type.
import { serve } from 'bun'

let batchCount = 0
let eventCount = 0
const seenTypes = new Set<string>()

const server = serve({
  port: 3001,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/api/public/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.pathname === '/api/public/ingestion' && req.method === 'POST') {
      const body = await req.json() as { batch?: Array<{ type: string }> }
      batchCount++
      if (body.batch && Array.isArray(body.batch)) {
        eventCount += body.batch.length
        body.batch.forEach(e => seenTypes.add(e.type))
      }
      console.error(`[mock] batch #${batchCount}, ${body.batch?.length ?? 0} events, types=[${[...seenTypes].join(',')}]`)
      return new Response(JSON.stringify({ successes: body.batch ?? [], errors: [] }), {
        status: 207,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('not found', { status: 404 })
  },
})

console.error(`[mock] listening on http://localhost:${server.port}`)
console.error(`[mock] PID=${process.pid}`)
