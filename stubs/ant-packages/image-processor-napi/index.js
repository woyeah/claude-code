module.exports = new Proxy(function(){}, {
  get(_t,p){if(p==='__esModule')return true;if(p==='default')return module.exports;return ()=>undefined},
  apply(){return undefined},
  construct(){return {}},
})
