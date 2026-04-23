const makeProxy = (name) => new Proxy(function(){}, {
  get(_t,p){
    if(p==='__esModule') return true
    if(p==='then') return undefined
    if(typeof p!=='string') return undefined
    return makeProxy(`${name}.${p}`)
  },
  apply(){return makeProxy('(result)')},
  construct(){return makeProxy('(instance)')},
})
const root = makeProxy('root')
export default root
export const BROWSER_TOOLS = root
const exported = new Proxy({default: root}, {
  get(t,p){ if(p in t) return t[p]; return makeProxy(String(p)) },
})
export { exported as __stubAny__ }
