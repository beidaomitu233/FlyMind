import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as moduleAPI from 'node:module'

test('real cloud gateway import does not load application store or drawing engine', {skip:typeof moduleAPI.registerHooks!=='function'?'Node synchronous module hooks unavailable':false},async()=>{
 const observed=new Set()
 const hooks=moduleAPI.registerHooks({resolve(specifier,context,nextResolve){
  const result=nextResolve(specifier,context),url=String(result.url).replaceAll('\\','/').toLowerCase()
  if(/\/server\/store\.(?:ts|js)(?:\?|$)/.test(url))observed.add('store')
  if(/\/drawing\/engine\/native-canvas\.(?:ts|js)(?:\?|$)/.test(url))observed.add('native-canvas')
  if(url.includes('/drawing/engine/drawio/'))observed.add('drawio-engine')
  if(url.includes('/better-sqlite3/')||specifier==='better-sqlite3')observed.add('better-sqlite3')
  return result
 }})
 try{
  const {createCloudMcpGateway}=await import('../server/cloud/mcp-gateway.ts')
  const gateway=createCloudMcpGateway({publicOrigin:'http://127.0.0.1:19001',applicationOrigin:'http://127.0.0.1:19002',controlPlaneURL:'http://127.0.0.1:19003',gatewayKey:'fixed-test-only-key-12345678901234567890',allowInsecureLoopback:true})
  await gateway.close()
  assert.deepEqual([...observed],[])
 }finally{hooks.deregister()}
})
