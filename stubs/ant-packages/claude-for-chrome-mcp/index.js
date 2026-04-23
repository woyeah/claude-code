// Stub for @ant/claude-for-chrome-mcp
// Real impl is Anthropic-internal. Returning permissive no-ops so imports resolve.
module.exports = new Proxy({}, {
  get(_target, prop) {
    if (prop === '__esModule') return true
    if (prop === 'default') return module.exports
    return () => undefined
  },
})
