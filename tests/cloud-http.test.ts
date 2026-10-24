import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer,request as httpRequest,type Server} from 'node:http'
import {mkdtemp,rm,readdir,mkdir,writeFile,readFile,symlink,copyFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {createCloudHTTP} from '../server/cloud/http'
import {NativeDrawioRenderer} from '../server/rendering/renderer'
import {NativeExportService} from '../server/application/native-exports'
import {NativeDiagramService} from '../server/application/native-diagrams'
import {CloudTeamWorkspaces,cloudRequestId} from '../server/cloud/team-workspaces'
import {CloudExportPool} from '../server/cloud/export-pool'
import {DiagramStore} from '../server/store'
import {spawn} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import Database from 'better-sqlite3'
import type {NativeExportRenderer} from '../server/exports/types'
import {businessContent} from './fixtures/native-business'
import {cloudMcpHandshake} from '../server/cloud/mcp-compat'

const tokens={alice:'alice_session_abcdefghijklmnopqrstuvwxyz_0123456789',bob:'bob_session_abcdefghijklmnopqrstuvwxyz_0123456789',viewer:'viewer_session_abcdefghijklmnopqrstuvwxyz_0123456789'}
async function listen(server:Server){await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+(server.address() as {port:number}).port}
async function stop(server:Server){const done=new Promise<void>(r=>server.close(()=>r()));server.closeAllConnections();await done}
async function setup(renderer?:NativeExportRenderer,maxQueuedTeams=4,identity?:import('../server/cloud/identity').CloudIdentityProvider){
 const root=await mkdtemp(join(tmpdir(),'flymind-cloud-http-')),revoked=new Set<string>(),calls:Array<{path:string;token:string;body:any}>=[]
 const authority=createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part
  const body=raw?JSON.parse(raw):{},token=req.headers.authorization?.slice(7)??'',user=Object.entries(tokens).find(([,t])=>t===token)?.[0]
  calls.push({path:req.url!,token,body});res.setHeader('Content-Type','application/json')
  const reply=(status:number,data:unknown)=>{res.statusCode=status;res.end(JSON.stringify(status===200?{code:200,message:'ok',data}:{code:status,errorCode:status===401?'LOGIN_REQUIRED':'TEAM_ACCESS_DENIED',message:'拒绝访问'}))}
  if(req.url==='/app/flymind/auth/login'){if(body.password!=='test-password'||body.phone!=='alice')return reply(401,{});return reply(200,{sessionToken:tokens.alice,expiresAt:Date.now()+3600000,user:{id:'alice',name:'Alice'}})}
  if(!user||revoked.has(token))return reply(401,{})
  if(req.url==='/app/flymind/auth/me')return reply(200,{user:{id:user,name:user},expiresAt:Date.now()+3600000,teams:[{id:'team-a',name:'A',role:user==='viewer'?'viewer':'editor'}]})
  if(req.url==='/app/flymind/auth/logout'){revoked.add(token);return reply(200,{success:true})}
  if(req.url==='/app/flymind/auth/password'){assert.deepEqual(Object.keys(body),['newPassword']);revoked.add(token);return reply(200,{success:true,reauthenticate:true})}
  if(req.url==='/app/flymind/teams')return reply(200,[{id:'team-a',name:'A',role:'editor'}])
  if(req.url==='/app/flymind/session/introspect'){
   if(user==='bob'&&body.teamId!=='team-b'||user==='viewer'&&body.teamId!=='team-a')return reply(403,{})
   return reply(200,{user:{id:user,name:user},session:{id:'session-'+user,expiresAt:Date.now()+3600000},team:{id:body.teamId,name:body.teamId,role:user==='viewer'?'viewer':'editor'}})
  }
  return reply(404,{})
 })
 const controlPlaneURL=await listen(authority),cloud=createCloudHTTP({controlPlaneURL,publicOrigin:'http://localhost',cloudDataRoot:join(root,'data'),allowInsecureLoopback:true,renderer:renderer??{render:async()=>{throw Error('Unexpected render')},close:async()=>{}},serveAssets:false,maxOpenTeams:4,maxQueuedTeams,identity}),http=createServer(cloud.app),base=await listen(http)
 async function request(path:string,options:{method?:string;body?:unknown;token?:string;rootId?:string;cookie?:string;origin?:string|null;host?:string;userId?:string|null}={}){
  const cookieUser=Object.entries(tokens).find(([,value])=>options.cookie?.endsWith('='+value))?.[0],expectedUser=options.userId===null?undefined:options.userId??cookieUser
  const headers:Record<string,string>={Host:options.host??'localhost',...(options.origin===null?{}:{Origin:options.origin??'http://localhost'}),...(options.token?{Authorization:'Bearer '+options.token}:{}),...(options.cookie?{Cookie:options.cookie}:{}),...(expectedUser?{'X-FlyMind-User-Id':expectedUser}:{}),...(options.rootId?{'X-FlyMind-DataRoot-Id':options.rootId}:{}),...(options.body===undefined?{}:{'Content-Type':'application/json'})}
  // Every fixture request owns its connection. Native font packaging can block
  // this same event loop across keep-alive expiry; don't reuse a stale global
  // Agent socket between these short-lived loopback servers or retry a write.
  return await new Promise<Response>((yes,no)=>{
   const method=options.method??'GET'
   const fail=(error:Error)=>{const contextual=new Error(`Loopback ${method} ${path}: ${error.message}`,{cause:error});if('code'in error)Object.assign(contextual,{code:error.code});no(contextual)}
   const request=httpRequest(base+path,{method,headers,agent:false},response=>{
    const chunks:Buffer[]=[];response.on('data',chunk=>chunks.push(chunk));response.on('error',fail)
    response.once('aborted',()=>fail(new Error('Response aborted before completion')))
    response.once('end',()=>{const h=new Headers();for(const [key,value] of Object.entries(response.headers))if(value!==undefined)for(const v of Array.isArray(value)?value:[value])h.append(key,v);yes(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:h}))})
   });request.once('error',fail);request.end(options.body===undefined?undefined:JSON.stringify(options.body))
  })
 }
 const team=(id:string,path:string)=>'/cloud-api/teams/'+id+'/studio-api'+path
 async function health(id='team-a',token=tokens.alice){const r=await request(team(id,'/health'),{token});assert.equal(r.status,200);return await r.json() as any}
 async function close(){await stop(http);await cloud.close();await stop(authority);assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-cloud-http-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
 return {root,cloud,request,team,health,close,calls,revoked,base}
}

test('front-end password proxy requires identity and origin, rejects legacy extra fields, and clears it after revocation',async()=>{
 const s=await setup();try{
  const cookie='fm_cloud_session='+tokens.alice,body={newPassword:'easy12'}
  let r=await s.request('/cloud-api/auth/password',{cookie,method:'POST',body,origin:null});assert.equal(r.status,403)
  r=await s.request('/cloud-api/auth/password',{cookie,method:'POST',body,userId:'bob'});assert.equal(r.status,409)
  r=await s.request('/cloud-api/auth/password',{cookie,method:'POST',body:{...body,newPassword:'123'}});assert.equal(r.status,400)
  r=await s.request('/cloud-api/auth/password',{cookie,method:'POST',body:{...body,newPassword:'😀😀😀'}});assert.equal(r.status,400)
  r=await s.request('/cloud-api/auth/password',{cookie,method:'POST',body:{...body,extra:'bad'}});assert.equal(r.status,400)
  r=await s.request('/cloud-api/auth/password',{cookie,method:'POST',body:{...body,currentPassword:'wrong'}});assert.equal(r.status,400);assert.equal((await r.json()).code,'INVALID_INPUT');assert.equal(r.headers.get('set-cookie'),null)
  r=await s.request('/cloud-api/auth/me',{cookie});assert.equal(r.status,200)
  r=await s.request('/cloud-api/auth/password',{cookie,method:'POST',body});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie')!,/Expires=/);assert.deepEqual((await r.json()).data,{success:true,reauthenticate:true})
  r=await s.request('/cloud-api/auth/me',{cookie});assert.equal(r.status,401)
  assert.equal(s.calls.filter(c=>c.path==='/app/flymind/auth/password').length,1)
 }finally{await s.close()}
})

test('cloud login proxies only fixed authority paths, keeps token in HttpOnly cookie, protects Host/Origin and logout',async()=>{
 const s=await setup();try{
  let r=await s.request('/cloud-api/auth/login',{method:'POST',body:{phone:'alice',password:'test-password'}});assert.equal(r.status,200);const body=await r.json();assert.ok(!JSON.stringify(body).includes(tokens.alice));const setCookie=r.headers.get('set-cookie')!;assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);const cookie=setCookie.split(';')[0]
  r=await s.request('/cloud-api/auth/me',{cookie});assert.equal(r.status,200)
  r=await s.request('/cloud-api/teams',{cookie});assert.equal(r.status,200)
  r=await s.request('/cloud-api/auth/logout',{cookie,method:'POST',origin:null});assert.equal(r.status,403)
  r=await s.request('/cloud-api/auth/me',{cookie,origin:'https://attacker.invalid'});assert.equal(r.status,403)
  r=await s.request('/cloud-api/auth/me',{cookie,host:'attacker.invalid'});assert.equal(r.status,403)
  r=await s.request('/cloud-api/auth/me',{cookie,token:tokens.bob});assert.equal(r.status,401)
  r=await s.request('/cloud-api/auth/logout',{cookie,method:'POST',userId:null});assert.equal(r.status,409)
  r=await s.request('/cloud-api/auth/logout',{cookie:'fm_cloud_session='+tokens.bob,method:'POST',userId:'alice'});assert.equal(r.status,409)
  assert.ok(!s.calls.some(c=>c.path==='/app/flymind/auth/logout'&&c.token===tokens.bob),'old tab cannot log out the newly logged-in account')
  r=await s.request('/cloud-api/auth/logout',{cookie,method:'POST'});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie')!,/Expires=/)
  r=await s.request('/cloud-api/auth/me',{cookie});assert.equal(r.status,401)
  assert.ok(s.calls.every(c=>c.path.startsWith('/app/flymind/')))
 }finally{await s.close()}
})

test('cloud native HTTP isolates team stores, binds root/CAS and actor requests, denies viewers and revoked sessions',async()=>{
 const s=await setup();try{
  let r=await s.request(s.team('team-a','/native/diagrams'));assert.equal(r.status,401);await assert.rejects(readdir(join(s.root,'data')),(e:any)=>e.code==='ENOENT')
  const a=await s.health(),b=await s.health('team-b');assert.notEqual(a.dataRootId,b.dataRootId);assert.equal(a.capabilities.nativeDocumentWrites,true)
  for(const [team,health,label] of [['team-a',a,'A'],['team-b',b,'B']] as const){const content=businessContent('flowchart','shared-id');content.title=label;r=await s.request(s.team(team,'/native/diagrams'),{token:tokens.alice,rootId:health.dataRootId,method:'POST',body:{content,requestId:'same-client-key'}});assert.equal(r.status,201,await r.clone().text())}
  r=await s.request(s.team('team-a','/native/diagrams/shared-id'),{token:tokens.bob});assert.equal(r.status,403)
  r=await s.request(s.team('team-a','/native/diagrams/shared-id'),{token:tokens.alice});assert.equal((await r.json() as any).document.content.title,'A')
  r=await s.request(s.team('team-b','/native/diagrams/shared-id'),{token:tokens.alice});assert.equal((await r.json() as any).document.content.title,'B')
  r=await s.request(s.team('team-a','/native/workspace'),{token:tokens.alice,rootId:b.dataRootId});assert.equal(r.status,409)
  const input={expectedRevision:1,requestId:'patch-key',operations:[{op:'set_title',title:'A changed'}]}
  r=await s.request(s.team('team-a','/native/diagrams/shared-id/content-patch'),{token:tokens.alice,method:'POST',body:input});assert.equal(r.status,409)
  for(let i=0;i<2;i++){r=await s.request(s.team('team-a','/native/diagrams/shared-id/content-patch'),{token:tokens.alice,rootId:a.dataRootId,method:'POST',body:input});assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json() as any).revision,2)}
  r=await s.request(s.team('team-a','/native/diagrams/shared-id/content-patch'),{token:tokens.viewer,rootId:a.dataRootId,method:'POST',body:{...input,requestId:'viewer'}});assert.equal(r.status,403)
  r=await s.request(s.team('team-a','/native/diagrams/shared-id/content-patch'),{token:tokens.alice,rootId:a.dataRootId,method:'POST',body:{...input,requestId:'stale'}});assert.equal(r.status,409)
  const other=businessContent('flowchart','same-id-different-member');r=await s.request(s.team('team-b','/native/diagrams'),{token:tokens.bob,rootId:b.dataRootId,method:'POST',body:{content:other,requestId:'same-client-key'}});assert.equal(r.status,201,'other actor must not replay Alice response')
  s.revoked.add(tokens.alice);r=await s.request(s.team('team-a','/native/workspace'),{token:tokens.alice});assert.equal(r.status,401)
  r=await s.request(s.team('team-a','/native/not-a-route'),{token:tokens.viewer});assert.equal(r.status,404)
  assert.ok(s.calls.filter(c=>c.path.endsWith('/introspect')).length>=12)
 }finally{await s.close()}
})

test('viewer can create a real native export, download team-scoped PNG and shared renderer closes exactly once',async()=>{
 const renderer=new NativeDrawioRenderer();let active=0,maxActive=0,closed=0
 const wrapped:NativeExportRenderer={async render(...args){active++;maxActive=Math.max(maxActive,active);try{return await renderer.render(...args)}finally{active--}},async close(){closed++;await renderer.close()}}
 const s=await setup(wrapped);try{
  const h=await s.health(),content=businessContent('flowchart','cloud-export');let r=await s.request(s.team('team-a','/native/diagrams'),{token:tokens.alice,rootId:h.dataRootId,method:'POST',body:{content,requestId:'create-export'}});assert.equal(r.status,201)
  r=await s.request(s.team('team-a','/native/diagrams/cloud-export/exports'),{token:tokens.viewer,rootId:h.dataRootId,method:'POST',body:{expectedRevision:1,requestId:'viewer-export'}});assert.equal(r.status,202);let job=await r.json() as any;const jobId=job.id,deadline=Date.now()+60000
  while(['queued','running'].includes(job.status)&&Date.now()<deadline){await new Promise(r=>setTimeout(r,150));r=await s.request(s.team('team-a','/native/exports/'+jobId),{token:tokens.viewer});assert.equal(r.status,200);job=await r.json()}
  assert.equal(job.status,'succeeded',JSON.stringify(job.error));assert.ok(job.files.png.url.startsWith('/cloud-api/teams/team-a/studio-api/native/'))
  r=await s.request(job.files.png.url,{token:tokens.viewer});assert.equal(r.status,200);const png=Buffer.from(await r.arrayBuffer());assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.length,job.files.png.bytes)
  r=await s.request(job.files.png.url.replace('/team-a/','/team-b/'),{token:tokens.bob});assert.equal(r.status,404)
  r=await s.request(job.files.png.url);assert.equal(r.status,401);assert.equal(maxActive,1)
 }finally{await s.close();assert.equal(closed,1)}
})

test('global export queue is bounded before enqueue, while unrelated team reads remain available',async()=>{
 let renderStarted!:()=>void,closed=0;const started=new Promise<void>(r=>renderStarted=r)
 const renderer:NativeExportRenderer={render:async(_project,options)=>{renderStarted();return await new Promise<never>((_yes,no)=>options?.signal?.addEventListener('abort',()=>no(options.signal!.reason),{once:true}))},close:async()=>{closed++}}
 const s=await setup(renderer,1);try{
  const a=await s.health(),b=await s.health('team-b')
  for(const [team,h] of [['team-a',a],['team-b',b]] as const){const r=await s.request(s.team(team,'/native/diagrams'),{token:tokens.alice,rootId:h.dataRootId,method:'POST',body:{content:businessContent('flowchart','queue-doc'),requestId:'queue-source'}});assert.equal(r.status,201)}
  let r=await s.request(s.team('team-a','/native/diagrams/queue-doc/exports'),{token:tokens.alice,rootId:a.dataRootId,method:'POST',body:{expectedRevision:1,requestId:'queue-a'}});assert.equal(r.status,202);await started
  r=await s.request(s.team('team-b','/native/diagrams/queue-doc/exports'),{token:tokens.alice,rootId:b.dataRootId,method:'POST',body:{expectedRevision:1,requestId:'queue-b'}});assert.equal(r.status,503);assert.equal((await r.json() as any).code,'EXPORT_CAPACITY')
  r=await s.request(s.team('team-b','/native/diagrams/queue-doc'),{token:tokens.alice});assert.equal(r.status,200)
 }finally{await s.close();assert.equal(closed,1)}
})

async function within<T>(promise:Promise<T>,ms=5000):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<never>((_yes,no)=>{timer=setTimeout(()=>no(Error('bounded test wait expired')),ms)})])}finally{clearTimeout(timer)}}

test('aborted HTTP export still settles its delayed create and runs without client polling',async()=>{
 let entered!:()=>void,release!:()=>void,created!:(id:string)=>void,rendered!:()=>void
 const entering=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r),committed=new Promise<string>(r=>created=r),rendering=new Promise<void>(r=>rendered=r)
 const original=NativeExportService.prototype.create
 NativeExportService.prototype.create=async function(...args){entered();await gate;const result=await original.apply(this,args);created(result.id);return result}
 const renderer:NativeExportRenderer={render:async()=>{rendered();throw Error('planned no-image scheduling test')},close:async()=>{}}
 const s=await setup(renderer);try{
  const h=await s.health();let response=await s.request(s.team('team-a','/native/diagrams'),{token:tokens.alice,rootId:h.dataRootId,method:'POST',body:{content:businessContent('flowchart','abort-doc'),requestId:'abort-source'}});assert.equal(response.status,201)
  const request=httpRequest(s.base+s.team('team-a','/native/diagrams/abort-doc/exports'),{method:'POST',headers:{Host:'localhost',Origin:'http://localhost',Authorization:'Bearer '+tokens.alice,'Content-Type':'application/json','X-FlyMind-DataRoot-Id':h.dataRootId}});request.on('error',()=>{});const aborted=new Promise<void>(r=>request.once('close',r));request.end(JSON.stringify({expectedRevision:1,requestId:'abort-export'}))
  await within(entering);request.destroy();await within(aborted);await new Promise(r=>setTimeout(r,75));release();const id=await within(committed);await within(rendering)
  // Direct durable state inspection is not an HTTP poll and cannot kick the pool.
  await s.cloud.workspaces.run(tokens.alice,'team-a','export:read',async workspace=>{const deadline=Date.now()+2000;let job;do{job=(await workspace.store.getNativeExport(id)).job;if(job.status==='failed')break;await new Promise(r=>setTimeout(r,20))}while(Date.now()<deadline);assert.equal(job.status,'failed')})
 }finally{release();NativeExportService.prototype.create=original;await s.close()}
})

test('cloud sanitizes both inner nativeRouter filesystem errors and outer unknown server errors',async()=>{
 const original=NativeDiagramService.prototype.list
 NativeDiagramService.prototype.list=async()=>{throw Object.assign(Error('EACCES open D:\\private\\cloud\\secret.sqlite'),{code:'EACCES'})}
 const s=await setup();try{const r=await s.request(s.team('team-a','/native/diagrams'),{token:tokens.alice});assert.equal(r.status,503);const body=await r.json();assert.equal((body as any).code,'CLOUD_STORAGE_ERROR');assert.doesNotMatch(JSON.stringify(body),/private|secret|EACCES/)}finally{NativeDiagramService.prototype.list=original;await s.close()}
 const outer=await setup(undefined,4,{authorize:async()=>{throw Object.assign(Error('unhandled service implementation secret'),{status:500,code:'CLOUD_TEST_FAILURE'})}})
 try{const r=await outer.request(outer.team('team-a','/health'),{token:tokens.alice});assert.equal(r.status,500);const body=await r.json();assert.equal((body as any).code,'CLOUD_TEST_FAILURE');assert.doesNotMatch(JSON.stringify(body),/implementation|secret/)}finally{await outer.close()}
})

test('a fresh process recovers persisted queued and live-lease jobs without any page or HTTP request',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flymind-cloud-http-recovery-')),data=join(root,'data')
 const identity={authorize:async(_token:string,teamId:string)=>({user:{id:'alice',name:'Alice'},session:{id:'session-a',expiresAt:Date.now()+60000},team:{id:teamId,name:teamId,role:'editor' as const}})}
 const registry=new CloudTeamWorkspaces(data,identity,{release:cloudMcpHandshake().then(v=>v.release)});let child:ReturnType<typeof spawn>|undefined,childClosed:Promise<number|null>|undefined
 try{
  const prepared=await registry.run(tokens.alice,'team-a','export:create',async(workspace,principal)=>{
   await workspace.diagrams.create({content:businessContent('flowchart','restart-doc'),requestId:cloudRequestId(principal,'restart-source')},workspace.dataRootId)
   const first=await workspace.exports.create('restart-doc',{expectedRevision:1,requestId:'first'},workspace.dataRootId),second=await workspace.exports.create('restart-doc',{expectedRevision:1,requestId:'second'},workspace.dataRootId)
   assert.deepEqual(await workspace.store.nativeExportQueueState(),{pending:true,ready:true})
   const claimed=await workspace.store.claimNativeExport('old-process',900,Date.now());assert.ok(claimed)
   assert.deepEqual(await workspace.store.nativeExportQueueState(),{pending:true,ready:false,nextAttemptAt:claimed.leaseUntil})
   return {workspace,first,second,leaseUntil:claimed.leaseUntil!}
  });registry.close()
  const teams=join(data,'teams'),unknown=join(teams,'b'.repeat(64));await mkdir(unknown);const unknownFile=join(unknown,'flymind.sqlite'),unknownDB=new Database(unknownFile);unknownDB.exec('CREATE TABLE unrelated(value TEXT);');unknownDB.close();const untouched=await readFile(unknownFile)
  await mkdir(join(teams,'c'.repeat(64)));await mkdir(join(teams,'not-a-team'));await mkdir(join(root,'local-only'));await copyFile(prepared.workspace.store.databasePath,join(root,'local-only','flymind.sqlite'));await symlink(join(root,'local-only'),join(teams,'d'.repeat(64)),'junction')
  const script=join(root,'recovery-child.mjs'),moduleURL=pathToFileURL(resolve('server/cloud/http.ts')).href
  await writeFile(script,`import {createCloudHTTP} from ${JSON.stringify(moduleURL)};const attempted=[];let closed=0;const cloud=createCloudHTTP({controlPlaneURL:'https://auth.example.invalid',cloudDataRoot:${JSON.stringify(data)},publicOrigin:'https://cloud.example.invalid',serveAssets:false,maxQueuedTeams:1,recoveryIntervalMs:100,recoveryBatchSize:1,renderer:{render:async()=>{attempted.push(Date.now());throw Error('planned recovery test')},close:async()=>{closed++}}});process.send({type:'ready'});process.on('message',async m=>{if(m==='stop'){await cloud.close();process.send({type:'closed',attempted,closed});process.disconnect()}});`)
  child=spawn(process.execPath,['--import','tsx',script],{cwd:resolve('.'),windowsHide:true,shell:false,stdio:['ignore','ignore','pipe','ipc']});let stderr='';child.stderr!.on('data',b=>stderr+=b.toString());const ready=new Promise<void>((yes,no)=>{child!.once('error',no);child!.on('message',(m:any)=>{if(m.type==='ready')yes()})});childClosed=new Promise(r=>child!.once('close',r));await within(ready)
  // The existing live lease blocks the entire team, including its queued job.
  if(Date.now()<prepared.leaseUntil-80){assert.equal((await prepared.workspace.store.getNativeExport(prepared.first.id)).job.status,'running')}
  const deadline=Date.now()+7000;let rows
  do{rows=await Promise.all([prepared.first,prepared.second].map(j=>prepared.workspace.store.getNativeExport(j.id)));if(rows.every(r=>r.job.status==='failed'))break;await new Promise(r=>setTimeout(r,40))}while(Date.now()<deadline)
  assert.ok(rows!.every(r=>r.job.status==='failed'),'both durable jobs must run without any request to the new process')
  const result=new Promise<any>(yes=>child!.on('message',(m:any)=>{if(m.type==='closed')yes(m)}));child.send('stop');const evidence=await within(result);assert.equal(await within(childClosed),0,stderr);child=undefined
  assert.equal(evidence.closed,1);assert.equal(evidence.attempted.length,2);assert.ok(evidence.attempted.every((at:number)=>at>=prepared.leaseUntil),'no task may run before the old lease expires');assert.deepEqual(await readFile(unknownFile),untouched);assert.deepEqual(await readdir(join(teams,'c'.repeat(64))),[]);assert.deepEqual(await readdir(join(teams,'not-a-team')),[])
 }finally{registry.close();if(child?.connected)child.send('stop');if(childClosed)try{await within(childClosed)}catch{child?.kill();await within(childClosed)}assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-cloud-http-recovery-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
})

test('HTTP maintenance drains a disconnected delayed create, rejects new writes, and sends rooms reconnect not revocation',async()=>{
 let entered!:()=>void,release!:()=>void
 const entering=new Promise<void>(r=>entered=r),barrier=new Promise<void>(r=>release=r),original=NativeDiagramService.prototype.create
 const s=await setup();let stream:ReturnType<typeof httpRequest>|undefined
 try{
  const h=await s.health();let response=await s.request(s.team('team-a','/native/diagrams'),{token:tokens.alice,rootId:h.dataRootId,method:'POST',body:{content:businessContent('flowchart','maintenance-room'),requestId:'maintenance-source'}});assert.equal(response.status,201)
  let text='',snapshot!:()=>void;const snap=new Promise<void>(r=>snapshot=r),ended=new Promise<void>((yes,no)=>{
   stream=httpRequest(s.base+s.team('team-a','/native/collaboration/maintenance-room/events'),{headers:{Host:'localhost',Origin:'http://localhost',Authorization:'Bearer '+tokens.alice,'X-FlyMind-DataRoot-Id':h.dataRootId}},res=>{assert.equal(res.statusCode,200);res.on('data',b=>{text+=b.toString();if(text.includes('event: snapshot'))snapshot()});res.on('end',yes);res.on('error',no)});stream.on('error',no);stream.end()
  });await within(snap)
  NativeDiagramService.prototype.create=async function(...args){entered();await barrier;return original.apply(this,args)}
  const req=httpRequest(s.base+s.team('team-a','/native/diagrams'),{method:'POST',headers:{Host:'localhost',Origin:'http://localhost',Authorization:'Bearer '+tokens.alice,'X-FlyMind-DataRoot-Id':h.dataRootId,'Content-Type':'application/json'}});req.on('error',()=>{});req.end(JSON.stringify({content:businessContent('flowchart','maintenance-delayed'),requestId:'maintenance-delayed'}))
  await within(entering);req.destroy()
  await assert.rejects(s.cloud.quiesce({timeoutMs:25}),{code:'CLOUD_DRAIN_TIMEOUT'})
  assert.equal(s.cloud.maintenance.snapshot().pendingWrites,1)
  response=await s.request(s.team('team-a','/native/diagrams'),{token:tokens.alice,rootId:h.dataRootId,method:'POST',body:{content:businessContent('flowchart','must-not-write'),requestId:'denied'}});assert.equal(response.status,503);assert.equal((await response.json() as any).code,'CLOUD_UPDATING');assert.equal(response.headers.get('retry-after'),'2')
  release();await s.cloud.quiesce({timeoutMs:3000});await within(ended)
  assert.match(text,/event: reconnect/);assert.match(text,/CLOUD_UPDATING/);assert.doesNotMatch(text,/access-revoked/)
  response=await s.request(s.team('team-a','/native/diagrams/maintenance-delayed'),{token:tokens.alice});assert.equal(response.status,200,'disconnected accepted write actually persisted')
  response=await s.request('/readyz');assert.equal(response.status,503);assert.equal((await response.json() as any).ready,false)
 }finally{release();NativeDiagramService.prototype.create=original;stream?.destroy();await s.close()}
})

test('export quiesce finishes only current job and fresh pool resumes untouched persistent queue',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flymind-cloud-quiesce-')),data=join(root,'data')
 const registry=new CloudTeamWorkspaces(data,{authorize:async(_t,teamId)=>({user:{id:'alice',name:'Alice'},session:{id:'a',expiresAt:Date.now()+60000},team:{id:teamId,name:teamId,role:'editor'}})},{release:cloudMcpHandshake().then(v=>v.release)})
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),barrier=new Promise<void>(r=>release=r);let attempts=0,closed=0
 // Deliberate renderer failure tests queue ownership only, not image rendering.
 const pool=new CloudExportPool({render:async()=>{attempts++;entered();await barrier;throw Error('planned queue drain fixture')},close:async()=>{closed++}},1,{root:data,intervalMs:50})
 let resumed:CloudExportPool|undefined
 try{
  const prepared=await registry.run(tokens.alice,'team-a','export:create',async workspace=>{
   const reservation=pool.reserve(workspace)
   try{await workspace.diagrams.create({content:businessContent('flowchart','drain-queue'),requestId:'create'},workspace.dataRootId)
    const first=await workspace.exports.create('drain-queue',{expectedRevision:1,requestId:'first'},workspace.dataRootId),second=await workspace.exports.create('drain-queue',{expectedRevision:1,requestId:'second'},workspace.dataRootId);return {workspace,first,second}
   }finally{reservation()}
  });await within(started)
  await assert.rejects(pool.quiesce({timeoutMs:20}),{code:'CLOUD_EXPORT_DRAIN_TIMEOUT'});assert.equal(closed,0)
  assert.throws(()=>pool.reserve(prepared.workspace),{code:'CLOUD_UPDATING'})
  release();await pool.quiesce({timeoutMs:2000});assert.equal(attempts,1)
  assert.equal((await prepared.workspace.store.getNativeExport(prepared.first.id)).job.status,'failed')
  let second=(await prepared.workspace.store.getNativeExport(prepared.second.id)).job;assert.equal(second.status,'queued');assert.equal(second.attempts,0)
  await pool.close();assert.equal(closed,1)
  resumed=new CloudExportPool({render:async()=>{throw Error('planned recovered queue fixture')},close:async()=>{}},1,{root:data,intervalMs:50})
  const deadline=Date.now()+3000;do{second=(await prepared.workspace.store.getNativeExport(prepared.second.id)).job;if(second.status==='failed')break;await new Promise(r=>setTimeout(r,20))}while(Date.now()<deadline)
  assert.equal(second.status,'failed');assert.equal(second.attempts,1,'recovered without request/reserve/poll kick')
 }finally{release();await pool.close();await resumed?.close();registry.close();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-cloud-quiesce-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
})
