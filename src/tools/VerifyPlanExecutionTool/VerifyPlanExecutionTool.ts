// Stub: feature-gated
const stub: any = new Proxy({}, { get: () => () => undefined })
export default stub
export {}
