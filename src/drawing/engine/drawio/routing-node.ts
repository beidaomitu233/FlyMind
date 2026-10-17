// Node-only, lazily imported by routing.ts. Never imported by project/projection.
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
import {RESOURCE_ROOT} from '../../../../server/package-paths'
import {ROUTING_SUPPLY,type RoutingSupply} from './routing-supply'
export async function loadNodeRoutingSupply():Promise<RoutingSupply>{
 const directory=pathToFileURL(resolve(RESOURCE_ROOT,'drawio/vendor/js/libavoid-js')+'/')
 for(const [file,expected] of Object.entries(ROUTING_SUPPLY)){
  let bytes:Buffer;try{bytes=await readFile(fileURLToPath(new URL(file,directory)))}catch{throw Object.assign(Error('固定本地libavoid供应缺失；运行setup:runtime'),{code:'ROUTING_SUPPLY_MISSING'})}
  if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Object.assign(Error('固定libavoid供应SHA256不匹配'),{code:'ROUTING_SUPPLY_HASH_MISMATCH'})
 }
 await import(new URL('libavoid.min.js',directory).href)
 const global=globalThis as any, Avoid=await global.__libavoidReady
 if(!Avoid||typeof Avoid.Router!=='function')throw Object.assign(Error('固定libavoid初始化失败'),{code:'ROUTING_INIT_FAILED'})
 await import(new URL('libavoid-routing.js',directory).href)
 if(typeof global.AvoidRouting?.computeRoutes!=='function')throw Object.assign(Error('固定路由API不可用'),{code:'ROUTING_INIT_FAILED'})
 return {Avoid,core:global.AvoidRouting}
}
