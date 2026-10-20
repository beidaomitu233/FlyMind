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

test('fixed user guard stops cookie account changes before sending a mutation',async()=>{
 const {CloudIdentityGuard}=await import('../src/drawing/services/cloud-client');let mutations=0,lost=0
 const guard=new CloudIdentityGuard('u1',async(input)=>{if(String(input).endsWith('/auth/me'))return Response.json({code:200,data:{user:{id:'u2'},teams:[{id:'t1',role:'editor'}]}});mutations++;return Response.json({code:200})},()=>lost++)
 const api=new CloudClient(guard.fetch());await assert.rejects(()=>api.createTeam('team'));await assert.rejects(()=>api.createTeam('team'));assert.equal(mutations,0);assert.equal(lost,1)
})

test('a cookie swap after preflight still carries immutable user header and closes the old transport',async()=>{
 const {CloudIdentityGuard}=await import('../src/drawing/services/cloud-client');let writes=0,lost=0
 const guard=new CloudIdentityGuard('u1',async(input,init)=>{assert.equal(new Headers(init?.headers).get('X-FlyMind-User-Id'),'u1');if(String(input).endsWith('/auth/me'))return Response.json({code:200,data:{user:{id:'u1'},teams:[]}});writes++;return Response.json({code:'USER_IDENTITY_MISMATCH'},{status:409})},()=>lost++)
 await assert.rejects(()=>new CloudClient(guard.fetch()).createTeam('x'));await assert.rejects(()=>guard.check());assert.equal(writes,1);assert.equal(lost,1)
})

test('removed membership blocks native requests and current viewer role blocks stale editor writes',async()=>{
 const {CloudIdentityGuard}=await import('../src/drawing/services/cloud-client');let calls=0,lost=0
 const removed=new CloudIdentityGuard('u1',async()=>Response.json({code:200,data:{user:{id:'u1'},teams:[]}}),()=>lost++)
 await assert.rejects(()=>removed.fetch('t1')('/cloud-api/teams/t1/studio-api/native'));assert.equal(lost,1)
 const viewer=new CloudIdentityGuard('u1',async(input)=>{if(String(input).endsWith('/auth/me'))return Response.json({code:200,data:{user:{id:'u1'},teams:[{id:'t1',role:'viewer'}]}});calls++;return Response.json({})})
 await assert.rejects(()=>viewer.fetch('t1')('/cloud-api/teams/t1/studio-api/native/diagrams',{method:'POST'}));assert.equal(calls,0)
})

test('late rejected old connection cannot invalidate a separately bound new user',async()=>{
 const {CloudIdentityGuard}=await import('../src/drawing/services/cloud-client');let finish!:(r:Response)=>void,oldLost=0,newLost=0
 const old=new CloudIdentityGuard('u1',()=>new Promise(resolve=>{finish=resolve}),()=>oldLost++);const pending=old.check()
 const current=new CloudIdentityGuard('u2',async()=>Response.json({code:200,data:{user:{id:'u2'},teams:[]}}),()=>newLost++)
 finish(Response.json({},{status:401}));await assert.rejects(()=>pending);assert.equal((await current.check()).user.id,'u2');assert.equal(oldLost,1);assert.equal(newLost,0)
})

test('consent uses application identity transport; denial needs no selected team and unsafe redirects are rejected',async()=>{
 const {cloudAuthorizationRedirect}=await import('../src/drawing/services/cloud-client');const calls:Array<{url:string;body:unknown}>=[]
 const api=new CloudClient(async(input,init)=>{calls.push({url:String(input),body:JSON.parse(String(init?.body))});return Response.json({code:200,data:{redirectUri:'http://127.0.0.1:1234/callback?error=access_denied'}})})
 const request='a'.repeat(43);await api.inspectAuthorization(request);await api.approveAuthorization(request,false);await api.approveAuthorization(request,true,'t1')
 assert.deepEqual(calls[1].body,{requestId:request,approved:false});assert.deepEqual(calls[2].body,{requestId:request,approved:true,teamId:'t1'});assert.ok(calls[0].url.endsWith('/oauth/requests/inspect'))
 for(const url of ['javascript:alert(1)','http://evil.test/cb','https://user:pass@example.test/','https://example.test/#fragment'])assert.throws(()=>cloudAuthorizationRedirect(url,'https://flymind.test'))
 assert.equal(cloudAuthorizationRedirect('http://127.0.0.1:1234/cb?code=opaque','https://flymind.test'),'http://127.0.0.1:1234/cb?code=opaque')
})

test('401 and 403 close every protected channel once; expired guards cannot return late data',async()=>{
 const {CloudIdentityGuard}=await import('../src/drawing/services/cloud-client')
 for(const status of [401,403]){let losses=0,writes=0;const guard=new CloudIdentityGuard('u1',async(input)=>{if(String(input).endsWith('/auth/me'))return Response.json({code:200,data:{user:{id:'u1'},teams:[]}});writes++;return Response.json({error:'revoked'},{status})},()=>losses++)
 await assert.rejects(()=>new CloudClient(guard.fetch()).approveAuthorization('a'.repeat(43),false));await assert.rejects(()=>new CloudClient(guard.fetch()).createTeam('x'));assert.equal(writes,1);assert.equal(losses,1)}
 let finish!:(r:Response)=>void
 const guard=new CloudIdentityGuard('u1',()=>new Promise(resolve=>{finish=resolve}));const pending=guard.check();guard.invalidate();finish(Response.json({code:200,data:{user:{id:'u1'},teams:[]}}));await assert.rejects(()=>pending)
})

test('actual OAuth scopes offer write consent only to owner admin editor and read consent to viewers',async()=>{
 const {cloudConsentTeams}=await import('../src/drawing/services/cloud-client');const teams=[{id:'o',name:'O',role:'owner' as const},{id:'a',name:'A',role:'admin' as const},{id:'e',name:'E',role:'editor' as const},{id:'v',name:'V',role:'viewer' as const}]
 const base={client:{id:'c',name:'Client'},teams,expiresAt:Date.now()+1000}
 assert.deepEqual(cloudConsentTeams({...base,scopes:['flymind:read','flymind:write']}).map(t=>t.id),['o','a','e']);assert.equal(cloudConsentTeams({...base,scopes:['flymind:read']}).length,4)
})
