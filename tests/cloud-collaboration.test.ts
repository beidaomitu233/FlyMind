import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createCloudHTTP} from '../server/cloud/http'
import {CloudAccessError,type CloudIdentityProvider} from '../server/cloud/identity'
import {parseNative,attr,setCellText,serialize} from '../src/drawing/engine/drawio/xml'
import {businessContent} from './fixtures/native-business'
import {subscribeCloudCollaboration,commitCloudCollaboration} from '../src/drawing/services/cloud-collaboration'

const alice='alice_abcdefghijklmnopqrstuvwxyz0123456789',bob='bob_abcdefghijklmnopqrstuvwxyz0123456789',viewer='viewer_abcdefghijklmnopqrstuvwxyz0123456789'
function label(xml:string,id:string,value:string){const n=parseNative(xml);setCellText([...n.cells.values()].find(e=>attr(e.object,'fmType')==='node'&&attr(e.object,'fmId')===id)!,value);return serialize(n.document)}
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'fm-cloud-collaboration-')),revoked=new Set<string>(),faults=new Map<string,CloudAccessError>(),server=createServer()
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+(server.address() as {port:number}).port
 const identity:CloudIdentityProvider={async authorize(token,team){if(faults.has(token))throw faults.get(token)!;if(revoked.has(token)||![alice,bob,viewer].includes(token))throw new CloudAccessError(401,'LOGIN_REQUIRED','会话失效');if(team!=='team-a')throw new CloudAccessError(403,'TEAM_ACCESS_DENIED','拒绝');const user=token===alice?'alice':token===bob?'bob':'viewer';return {user:{id:user,name:user},session:{id:'session-'+user,expiresAt:Date.now()+60000},team:{id:team,name:team,role:user==='viewer'?'viewer':'editor'}}}}
 const options={publicOrigin:base,controlPlaneURL:base,cloudDataRoot:join(root,'teams-root'),allowInsecureLoopback:true,identity,serveAssets:false,serveSPA:false,collaborationIntervalMs:30,renderer:{async render(){throw Error('unused')},async close(){}}}
 let cloud=createCloudHTTP(options);server.on('request',cloud.app)
 const prefix=base+'/cloud-api/teams/team-a/studio-api/native';let rootId=''
 async function req(path:string,body?:unknown,credential=alice,extra:Record<string,string>={}){return fetch(prefix+path,{method:body===undefined?'GET':'POST',headers:{Origin:base,Authorization:'Bearer '+credential,'X-FlyMind-DataRoot-Id':rootId,...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body)})}
 const health=await fetch(base+'/cloud-api/teams/team-a/studio-api/health',{headers:{Authorization:'Bearer '+alice}});rootId=(await health.json()).dataRootId
 const created=await req('/diagrams',{content:businessContent('flowchart','collab'),requestId:'create'});assert.equal(created.status,201);const record=await created.json()
 async function stream(since?:number,credential=alice){
  const controller=new AbortController(),response=await fetch(prefix+'/collaboration/collab/events'+(since?'?since='+since:''),{headers:{Authorization:'Bearer '+credential,'X-FlyMind-DataRoot-Id':rootId},signal:controller.signal});assert.equal(response.status,200)
  const reader=response.body!.getReader(),decoder=new TextDecoder();let pending=''
  async function next(wanted='revision'):Promise<any>{const timeout=setTimeout(()=>controller.abort(),5000);try{for(;;){const end=pending.indexOf('\n\n');if(end>=0){const frame=pending.slice(0,end);pending=pending.slice(end+2);const event=frame.match(/event: (.*)/)?.[1],data=JSON.parse(frame.match(/data: (.*)/)![1]);if(event===wanted)return data;continue}const part=await reader.read();if(part.done)throw Error('stream ended');pending+=decoder.decode(part.value,{stream:true})}}finally{clearTimeout(timeout)}}
  return {next,close:async()=>{controller.abort();await reader.cancel().catch(()=>{})}}
 }
 return {req,record,stream,revoked,faults,prefix,base,rootId,cloud,async restart(){await cloud.close();server.removeListener('request',cloud.app);cloud=createCloudHTTP(options);server.on('request',cloud.app)},async close(){await cloud.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}}
}
test('two authenticated peers receive durable revisions; independent edits merge, same-field conflict preserves revision, replay and reconnect work',async()=>{
 const s=await setup(),a=await s.stream(),b=await s.stream(undefined,bob)
 try{
  assert.equal((await a.next('snapshot')).revision,1);assert.equal((await b.next('snapshot')).revision,1)
  const xml=s.record.document.rendering.engine.xml,first={xml:label(xml,'start','甲修改'),expectedRevision:1,requestId:'a'}
  let response=await s.req('/collaboration/collab/commit',first);assert.equal(response.status,200);assert.equal((await response.json()).requestId,'a')
  const event=await a.next();assert.equal(event.revision,2);assert.equal(event.fromRevision,1);assert.ok(event.patch);assert.equal((await b.next()).revision,2)
  response=await s.req('/collaboration/collab/commit',{xml:label(xml,'task','乙修改'),expectedRevision:1,requestId:'b'},bob);assert.equal(response.status,200)
  const merged=await response.json();assert.equal(merged.record.revision,3);assert.match(merged.record.document.rendering.engine.xml,/甲修改/);assert.match(merged.record.document.rendering.engine.xml,/乙修改/)
  response=await s.req('/collaboration/collab/commit',{...first,xml:label(xml,'start','冲突修改'),requestId:'conflict'});assert.equal(response.status,409);assert.equal((await response.json()).code,'COLLABORATION_CONFLICT')
  response=await s.req('/collaboration/collab/commit',first);assert.equal((await response.json()).record.revision,2)
  const reconnect=await s.stream(1);try{const current=await reconnect.next();assert.equal(current.fromRevision,1);assert.equal(current.revision,3);assert.match(current.record.document.rendering.engine.xml,/乙修改/)}finally{await reconnect.close()}
  response=await s.req('/diagrams/collab/content-patch',{operations:[{op:'set_title',title:'MCP同服务提交'}],expectedRevision:3,requestId:'mcp'});assert.equal(response.status,200)
  let notified;do{notified=await a.next()}while(notified.revision<4);assert.equal(notified.record.document.content.title,'MCP同服务提交')
 }finally{await a.close();await b.close();await s.close()}
})
test('viewer can subscribe but not commit; wrong root/team/user and swapped cookie reject without writing; revocation ends live subscription',async()=>{
 const s=await setup(),peer=await s.stream(undefined,viewer)
 try{
  await peer.next('snapshot');const input={xml:s.record.document.rendering.engine.xml,expectedRevision:1,requestId:'write'}
  assert.equal((await s.req('/collaboration/collab/commit',input,viewer)).status,403)
  assert.equal((await s.req('/collaboration/collab/commit',input,alice,{'X-FlyMind-DataRoot-Id':'wrong'})).status,409)
  assert.equal((await s.req('/collaboration/collab/commit',input,bob,{'X-FlyMind-User-Id':'alice'})).status,409)
  const swapped=await fetch(s.prefix+'/collaboration/collab/commit',{method:'POST',headers:{Origin:s.base,Cookie:'fm_cloud_session='+bob,'X-FlyMind-User-Id':'alice','X-FlyMind-DataRoot-Id':s.rootId,'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(swapped.status,409)
  const missing=await fetch(s.prefix+'/collaboration/collab/commit',{method:'POST',headers:{Origin:s.base,Cookie:'fm_cloud_session='+alice,'X-FlyMind-DataRoot-Id':s.rootId,'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(missing.status,409)
  const wrongTeam=await fetch(s.prefix.replace('team-a','team-b')+'/collaboration/collab/events',{headers:{Authorization:'Bearer '+alice,'X-FlyMind-DataRoot-Id':s.rootId}});assert.equal(wrongTeam.status,403)
  assert.equal((await (await s.req('/diagrams/collab')).json()).revision,1)
  s.revoked.add(viewer);assert.equal((await peer.next('access-revoked')).code,'LOGIN_REQUIRED')
 }finally{await peer.close();await s.close()}
})
test('fresh room process recovers persisted cursor; browser protocol callback is ordered and retains explicit ACK identity',async()=>{
 const s=await setup()
 try{
  const request={xml:label(s.record.document.rendering.engine.xml,'task','重启后保留'),expectedRevision:1,requestId:'restart'}
  assert.equal((await s.req('/collaboration/collab/commit',request)).status,200);await s.restart()
  const controller=new AbortController(),seen:number[]=[],options={baseURL:'/cloud-api/teams/team-a/studio-api/native',diagramId:'collab',dataRootId:s.rootId,userId:'alice',fetch:((url:any,init:any)=>fetch(s.base+url,{...init,headers:{...init.headers,Authorization:'Bearer '+alice}})) as typeof fetch}
  const ack=await commitCloudCollaboration(options,request);assert.equal(ack.record.revision,2);assert.equal(ack.requestId,'restart')
  await assert.rejects(subscribeCloudCollaboration({...options,since:1,signal:controller.signal,onEvent:async event=>{seen.push(event.revision);assert.equal(event.fromRevision,1);assert.ok(event.patch);assert.match(event.record.document.rendering.engine.xml,/重启后保留/);controller.abort()}}),(e:any)=>e.name==='AbortError')
  assert.deepEqual(seen,[2])
  const latest=await s.stream(9999);try{assert.equal((await latest.next('snapshot')).revision,2)}finally{await latest.close()}
 }finally{await s.close()}
})
test('per-room connection budget rejects the seventeenth peer and releases slots on disconnect',async()=>{
 const s=await setup(),peers:Array<Awaited<ReturnType<typeof s.stream>>>=[]
 try{
  for(let i=0;i<16;i++){const p=await s.stream();await p.next('snapshot');peers.push(p)}
  const rejected=await fetch(s.prefix+'/collaboration/collab/events',{headers:{Authorization:'Bearer '+alice,'X-FlyMind-DataRoot-Id':s.rootId}})
  assert.equal(rejected.status,503);assert.equal((await rejected.json()).code,'COLLABORATION_CAPACITY')
  await peers.pop()!.close();await new Promise(r=>setTimeout(r,50));const replacement=await s.stream();await replacement.next('snapshot');await replacement.close()
 }finally{for(const p of peers)await p.close();await s.close()}
})
test('large native snapshots drain transport backpressure without losing the live revision stream',async()=>{
 const s=await setup()
 try{
  const n=parseNative(s.record.document.rendering.engine.xml),cell=n.document.createElement('mxCell'),geo=n.document.createElement('mxGeometry')
  for(const [key,value] of Object.entries({id:'large-decoration',vertex:'1',parent:'1',value:'环境装饰'.repeat(18000)}))cell.setAttribute(key,value)
  for(const [key,value] of Object.entries({as:'geometry',x:'10',y:'10',width:'100',height:'30'}))geo.setAttribute(key,value)
  cell.appendChild(geo);n.root.appendChild(cell)
  const result=await s.req('/collaboration/collab/commit',{xml:serialize(n.document),expectedRevision:1,requestId:'large'});assert.equal(result.status,200,await result.clone().text())
  const peer=await s.stream();try{
   const snapshot=await peer.next('snapshot');assert.ok(JSON.stringify(snapshot).length>65536)
   const update=await s.req('/diagrams/collab/content-patch',{operations:[{op:'set_title',title:'大消息后继续'}],expectedRevision:2,requestId:'after-large'});assert.equal(update.status,200)
   assert.equal((await peer.next()).revision,3)
  }finally{await peer.close()}
 }finally{await s.close()}
})
test('temporary authority outage is retryable and distinct from document deletion and access revocation',async()=>{
 const s=await setup(),peer=await s.stream(undefined,viewer)
 try{
  await peer.next('snapshot');s.faults.set(viewer,new CloudAccessError(503,'IDENTITY_UNAVAILABLE','authority private failure'))
  const outage=await peer.next('unavailable');assert.deepEqual(outage,{code:'COLLABORATION_UNAVAILABLE',status:503});await peer.close();s.faults.delete(viewer)
  const recovered=await s.stream(undefined,viewer);try{
   assert.equal((await recovered.next('snapshot')).revision,1)
   const deleted=await fetch(s.prefix+'/diagrams/collab?revision=1',{method:'DELETE',headers:{Authorization:'Bearer '+alice,'X-FlyMind-DataRoot-Id':s.rootId}});assert.equal(deleted.status,200)
   assert.deepEqual(await recovered.next('diagram-deleted'),{code:'DIAGRAM_DELETED',status:410})
  }finally{await recovered.close()}
 }finally{await peer.close();await s.close()}
})
test('browser stream reports typed outage/deletion/revocation without treating 503 as permission loss',async()=>{
 for(const [event,status,code] of [['unavailable',503,'COLLABORATION_UNAVAILABLE'],['diagram-deleted',410,'DIAGRAM_DELETED'],['access-revoked',401,'LOGIN_REQUIRED'],['access-revoked',403,'PERMISSION_DENIED']] as const){
  const controller=new AbortController()
  await assert.rejects(subscribeCloudCollaboration({baseURL:'/cloud-api/teams/team-a/studio-api/native',diagramId:'collab',dataRootId:'root',userId:'alice',signal:controller.signal,onEvent(){assert.fail('failure must not apply XML')},fetch:async()=>new Response('event: '+event+'\ndata: '+JSON.stringify({status,code})+'\n\n',{headers:{'Content-Type':'text/event-stream'}})}),(e:any)=>e.status===status&&e.code===code)
 }
})
test('shared page view commits reach SSE, unsupported model changes reject before receipt and leave original revision intact',async()=>{
 const s=await setup(),peer=await s.stream()
 try{
  await peer.next('snapshot');const n=parseNative(s.record.document.rendering.engine.xml)
  const props={background:'#faf0e6',page:'1',pageScale:'1.25',pageWidth:'960',pageHeight:'720',shadow:'1',fold:'0',math:'1'}
  for(const [key,value] of Object.entries(props))n.model.setAttribute(key,value)
  const input={xml:serialize(n.document),expectedRevision:1,requestId:'view'}
  const saved=await s.req('/collaboration/collab/commit',input);assert.equal(saved.status,200,await saved.clone().text())
  const notification=await peer.next(),page=Object.values((notification.patch as any).u)[0] as any
  assert.equal(page.view.background,'"#faf0e6"');assert.equal(page.view.pageVisible,'true');assert.equal(page.view.pageScale,'1.25');assert.equal(page.view.shadowVisible,'true');assert.equal(page.view.foldingEnabled,'false');assert.equal(page.view.mathEnabled,'true');assert.deepEqual(JSON.parse(page.view.pageFormat),{x:0,y:0,width:960,height:720})
  const current=(await saved.json()).record,unsupported=parseNative(current.document.rendering.engine.xml);unsupported.model.setAttribute('backgroundImage','{"src":"https://invalid.example/image.png"}')
  const bad={xml:serialize(unsupported.document),expectedRevision:2,requestId:'unsupported'}
  const rejected=await s.req('/collaboration/collab/commit',bad);assert.equal(rejected.status,422);assert.equal((await rejected.json()).code,'COLLABORATION_VIEW_UNSUPPORTED')
  assert.equal((await (await s.req('/diagrams/collab')).json()).revision,2)
  const fixed=await s.req('/collaboration/collab/commit',{...bad,xml:current.document.rendering.engine.xml});assert.equal(fixed.status,200,'Rejected request must not persist an idempotency receipt')
  const pureScale=parseNative(current.document.rendering.engine.xml);pureScale.model.setAttribute('pageScale','1.5')
  const onlyScale=await s.req('/collaboration/collab/commit',{xml:serialize(pureScale.document),expectedRevision:2,requestId:'only-scale'});assert.equal(onlyScale.status,200);assert.equal((await onlyScale.json()).record.revision,3,'Paper-only change cannot be classified as a viewport no-op')
 }finally{await peer.close();await s.close()}
})
