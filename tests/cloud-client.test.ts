import test from 'node:test'
import assert from 'node:assert/strict'
import {CloudClient,cloudDraftDatabase,cloudTeamFetch} from '../src/drawing/services/cloud-client'
import {NativeClient} from '../src/drawing/services/native-client'
import {NativeApiError} from '../src/drawing/services/native-types'

test('cloud authentication uses same-origin cookie without persisting or returning a browser token',async()=>{
 const calls:Array<{url:string;init?:RequestInit}>=[]
 const client=new CloudClient(async(input,init)=>{calls.push({url:String(input),init});return Response.json({code:200,data:{user:{id:'u1',name:'Alice'},expiresAt:123}})})
 await client.login('13800000000','not-a-real-password')
 assert.equal(calls[0].url,'/cloud-api/auth/login');assert.equal(calls[0].init?.credentials,'same-origin');assert.equal(calls[0].init?.redirect,'error');assert.equal(new Headers(calls[0].init?.headers).has('Authorization'),false)
})
test('draft namespaces cannot collide between users or teams; local database is separate',()=>{
 const values=[cloudDraftDatabase('u1','t1'),cloudDraftDatabase('u1','t2'),cloudDraftDatabase('u2','t1'),cloudDraftDatabase('u:1','t1'),cloudDraftDatabase('u','1:t1')]
 assert.equal(new Set(values).size,values.length);assert.ok(values.every(v=>v!=='flymind-native-drafts-v1'))
})
test('viewer blocks all diagram and organization mutations while allowing a real export',async()=>{
 const calls:string[]=[];const transport=cloudTeamFetch('viewer',async(input)=>{calls.push(String(input));return Response.json({})})
 for(const [path,method] of [['/diagrams/d1/editor','POST'],['/diagrams','POST'],['/groups','POST'],['/diagrams/d1/group','PUT'],['/trash/d1','DELETE']])await assert.rejects(()=>transport('/cloud-api/teams/t1/studio-api/native'+path,{method}),e=>e instanceof NativeApiError&&e.status===403)
 await transport('/cloud-api/teams/t1/studio-api/native/diagrams/d1/exports',{method:'POST'});await transport('/cloud-api/teams/t1/studio-api/native/exports/j1/retry',{method:'POST'});assert.equal(calls.length,2)
})
test('native cloud transport binds the team path and immutable workspace header without local session bootstrap',async()=>{
 const calls:Array<{url:string;headers:Headers}>=[]
 const client=new NativeClient('/cloud-api/teams/t1',{bootstrapSession:false,expectedDataRootId:'root1',fetch:async(input,init)=>{calls.push({url:String(input),headers:new Headers(init?.headers)});return Response.json({format:3})}})
 await client.saveEditor('diagram1',{xml:'<xml/>',expectedRevision:4,requestId:'same-request'})
 assert.equal(calls.length,1);assert.equal(calls[0].url,'/cloud-api/teams/t1/studio-api/native/diagrams/diagram1/editor-save');assert.equal(calls[0].headers.get('X-FlyMind-DataRoot-Id'),'root1')
})
test('team membership management uses explicit team and user IDs for every request',async()=>{
 const calls:Array<{url:string;method?:string}>=[];const api=new CloudClient(async(input,init)=>{calls.push({url:String(input),method:init?.method});return Response.json({code:200,data:{success:true}})})
 await api.role('team1','user2','editor');await api.remove('team1','user2');await api.transfer('team1','user2');await api.leave('team1')
 assert.deepEqual(calls,[{url:'/cloud-api/teams/team1/members/user2',method:'PATCH'},{url:'/cloud-api/teams/team1/members/user2',method:'DELETE'},{url:'/cloud-api/teams/team1/transfer',method:'POST'},{url:'/cloud-api/teams/team1/leave',method:'POST'}]);assert.throws(()=>api.members('../outside'))
})
test('cloud permission failures remain explicit and are not converted into fake success',async()=>{
 const api=new CloudClient(async()=>Response.json({error:'团队无权访问',code:'FORBIDDEN'},{status:403}))
 await assert.rejects(()=>api.members('team1'),e=>e instanceof NativeApiError&&e.status===403&&e.code==='FORBIDDEN')
})
