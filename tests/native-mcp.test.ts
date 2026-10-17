import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'
import {createNativeMcpServer} from '../server/mcp-native/server'
import {extractContent} from '../src/drawing/core/layers'
import {sampleFor} from '../src/drawing/core/samples'
import {runtimeCapabilities} from '../server/runtime-instance/config'
import {nativeDocumentCapabilities} from '../src/drawing/services/native-capabilities'
const content=extractContent(sampleFor('swimlane'))
const record={format:3,document:{content,createdAt:100,updatedAt:100},revision:1,createdAt:100,workspaceGroupId:null}
const pure={format:3,content,revision:1,createdAt:100,updatedAt:100,workspaceGroupId:null,readOnly:false,syncStatus:'synced'}
async function harness(handler:(path:string,init:RequestInit)=>unknown,options={waitMs:20,pollMs:1}){
 const calls:{path:string;init:RequestInit}[]=[],facade=createNativeMcpServer(async()=>({baseURL:'http://127.0.0.1:5179',dataRootId:'test-root',instanceId:'test-instance',sessionToken:'secret',capabilities:runtimeCapabilities(),headers:()=>({}),authenticatedFetch:async(path,init={})=>{calls.push({path,init});const value=await handler(path,init);return value instanceof Response?value:new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}})},close:async()=>{}}),options)
 const [serverTransport,clientTransport]=InMemoryTransport.createLinkedPair(),client=new Client({name:'test',version:'1'});await facade.server.connect(serverTransport);await client.connect(clientTransport)
 return {client,calls,async close(){await client.close();await facade.close()}}
}
async function reconnectHarness(connect:()=>Promise<any>){
 const facade=createNativeMcpServer(connect,{waitMs:5,pollMs:1}),[a,b]=InMemoryTransport.createLinkedPair(),client=new Client({name:'reconnect-test',version:'1'});await facade.server.connect(a);await client.connect(b)
 return {client,async close(){await client.close();await facade.close()}}
}
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status})
function fakeConnection(root:string,fetch:(path:string,init?:RequestInit)=>Promise<Response>){return {baseURL:'http://127.0.0.1:5179',dataRootId:root,instanceId:'instance',sessionToken:'secret',capabilities:runtimeCapabilities(),headers:()=>({}),authenticatedFetch:fetch,close:async()=>{}}}
test('native SDK exposes original names, stable requestId schemas and truthful guide/configuration',async()=>{
 const h=await harness(path=>path.endsWith('/rendering')?response({error:'此profile未开放配置',code:'NATIVE_RENDERING_EDIT_UNSUPPORTED'},422):path.endsWith('/records/'+content.id)?pure:record)
 try{
  const tools=(await h.client.listTools()).tools;assert.equal(tools.length,18)
  for(const name of ['create_diagram','patch_diagram','update_diagram','configure_rendering']){const tool=tools.find(t=>t.name===name)!;assert.ok(tool.inputSchema.required?.includes('requestId'))}
  const guide=await h.client.callTool({name:'get_drawing_guide',arguments:{kind:'swimlane'}});assert.equal(guide.isError,undefined);assert.match((guide.structuredContent as any).guide,/profile/);assert.deepEqual((guide.structuredContent as any).capabilities,nativeDocumentCapabilities())
  for(const unsupportedKind of nativeDocumentCapabilities().profiles.filter(p=>!p.compile)){const unsupported=await h.client.callTool({name:'get_drawing_guide',arguments:{kind:unsupportedKind.kind}});assert.equal(unsupported.isError,true)}
  const config=await h.client.callTool({name:'configure_rendering',arguments:{id:content.id,expectedRevision:1,requestId:'configure-key',rendering:{}}});assert.match(JSON.stringify(config),/NATIVE_RENDERING_EDIT_UNSUPPORTED/);assert.equal(JSON.parse(String(h.calls.find(c=>c.path.endsWith('/rendering'))?.init.body)).requestId,'configure-key')
  const got=await h.client.callTool({name:'get_diagram',arguments:{id:content.id}});assert.equal((got.structuredContent as any).content.schemaVersion,1);assert.equal((got.structuredContent as any).exportStatus,'not_requested')
 }finally{await h.close()}
})
test('saved mutation remains saved when renderer job fails; never repeats create',async()=>{
 const job={id:'failed-job',diagramId:content.id,dataRootId:'test-root',revision:1,status:'failed',error:{code:'RENDER_FAILED',message:'injected'}}
 const h=await harness(path=>path.endsWith('/ai/diagrams')?record:path.endsWith('/exports/snapshot')?job:pure)
 try{const got=await h.client.callTool({name:'create_diagram',arguments:{content,requestId:'create-one'}});const data=got.structuredContent as any;assert.equal(data.saved,true);assert.equal(data.revision,1);assert.equal(data.exportStatus,'failed');assert.equal(data.jobId,'failed-job');assert.equal(got.content.some((x:any)=>x.type==='image'),false);assert.equal(h.calls.filter(c=>c.path.endsWith('/ai/diagrams')).length,1)}finally{await h.close()}
})
test('waiting timeout returns saved receipt/job; original mutation replay exports exact old revision',async()=>{
 const job={id:'queued-job',diagramId:content.id,dataRootId:'test-root',revision:1,status:'queued'}
 const h=await harness(path=>path.endsWith('/ai/diagrams')?record:path.endsWith('/records/'+content.id)?{...pure,revision:2}:job)
 try{const args={name:'create_diagram',arguments:{content,requestId:'stable-create'}},a=await h.client.callTool(args),b=await h.client.callTool(args);for(const got of [a,b]){const d=got.structuredContent as any;assert.equal(d.saved,true);assert.equal(d.exportStatus,'waiting_timeout');assert.equal(d.currentRevision,2);assert.equal(d.isCurrentRevision,false);assert.equal(d.revision,1)}const bodies=h.calls.filter(c=>c.path.endsWith('/exports/snapshot')).map(c=>JSON.parse(String(c.init.body)));assert.deepEqual(bodies[0],bodies[1]);assert.equal(bodies[0].revision,1)}finally{await h.close()}
})
test('resource id/revision/root mismatches reject before reading bytes; legacy resource cannot guess export',async()=>{
 const h=await harness(()=>({id:'job',diagramId:content.id,dataRootId:'wrong-root',revision:1,status:'succeeded'}))
 try{await assert.rejects(h.client.readResource({uri:`flymind://exports/${content.id}/1/job/png`}),/资源不属于/);assert.equal(h.calls.some(c=>c.path.includes('/files/')),false);await assert.rejects(h.client.readResource({uri:`flymind://artifacts/${content.id}/1/png`}),/exportId/)}finally{await h.close()}
})
test('SDK preserves actual native HTTP error code/currentRevision/quality',async()=>{
 for(const [status,body] of [[409,{error:'版本冲突',code:'REVISION_CONFLICT',currentRevision:4}],[422,{error:'质量拒绝',code:'QUALITY_FAILED',quality:{passed:false,issues:[{code:'decision_exits'}]}}]] as const){
  const h=await harness(()=>new Response(JSON.stringify(body),{status}));try{const result=await h.client.callTool({name:'create_diagram',arguments:{content,requestId:'error-case'}});assert.equal(result.isError,true);const error=JSON.parse((result.content[0] as any).text).error;assert.equal(error.code,body.code);assert.equal(error.status,status);if('currentRevision'in body)assert.equal(error.currentRevision,body.currentRevision);if('quality'in body)assert.deepEqual(error.quality,body.quality)}finally{await h.close()}
 }
})
test('failed r1 retry after current r2 anchors title/time/content and PNG to r1; resume never enqueues',async()=>{
 const old={...pure,content:{...content,title:'原始标题'},createdAt:100,updatedAt:100},job={id:'retry-job',diagramId:content.id,dataRootId:'test-root',revision:1,status:'succeeded',width:2,height:3,exportedAt:1000,files:Object.fromEntries(['png','svg','drawio','json','project.json'].map(f=>[f,{bytes:24,filename:'one.'+f,url:'/studio-api/native/exports/retry-job/files/'+f}]))}
 const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(2,16);png.writeUInt32BE(3,20)
 const h=await harness(path=>path.endsWith('/snapshot')?old:path.endsWith('/delivery')?{jobId:job.id,diagramId:content.id,revision:1,dataRootId:'test-root',files:{png:'C:/isolated/one.png'}}:path.endsWith('/files/png')?new Response(png):path.includes('/records/')?{...pure,revision:2,content:{...content,title:'新标题'},updatedAt:200}:job)
 try{
  const result=await h.client.callTool({name:'export_diagram',arguments:{id:content.id,requestId:'retry-one',retryJobId:'failed-old-job',expectedRevision:1}}),data=result.structuredContent as any
  assert.equal(data.title,'原始标题');assert.equal(data.updatedAt,100);assert.equal(data.revision,1);assert.equal(data.currentRevision,2);assert.equal(data.isCurrentRevision,false);assert.equal(data.width,2);assert.equal(data.exportStatus,'succeeded');assert.equal(result.content.some((x:any)=>x.type==='image'),true)
  h.calls.length=0
  await h.client.callTool({name:'export_diagram',arguments:{id:content.id,requestId:'resume-one',jobId:'retry-job'}})
  assert.ok(h.calls.every(call=>(call.init.method??'GET')==='GET'))
 }finally{await h.close()}
})
test('inline budget retains successful export files, rejects large resources and leaves SDK connection usable',async()=>{
 const png=Buffer.alloc(7*1024*1024);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(2,16);png.writeUInt32BE(3,20)
 const job={id:'large-job',diagramId:content.id,dataRootId:'test-root',revision:1,status:'succeeded',width:2,height:3,exportedAt:1000,files:Object.fromEntries(['png','svg','drawio','json','project.json'].map(f=>[f,{bytes:f==='png'?png.length:f==='svg'?22*1024*1024:100,filename:'large.'+f,url:'/studio-api/native/exports/large-job/files/'+f}]))}
 const h=await harness(path=>path.endsWith('/ai/diagrams')?record:path.endsWith('/snapshot')?job:path.endsWith('/delivery')?{jobId:job.id,diagramId:content.id,revision:1,dataRootId:'test-root',files:{png:'C:/isolated/large.png',svg:'C:/isolated/large.svg'}}:path.endsWith('/files/png')?new Response(png):path.endsWith('/files/svg')?new Response('x'.repeat(9*1024*1024)):path.includes('/records/')?pure:job)
 try{
  const result=await h.client.callTool({name:'create_diagram',arguments:{content,requestId:'large-create'}}),data=result.structuredContent as any
  assert.equal(data.exportStatus,'succeeded');assert.equal(data.previewStatus,'too_large');assert.equal(data.previewError.code,'MCP_PREVIEW_TOO_LARGE');assert.equal(data.files.png,'C:/isolated/large.png');assert.equal(result.content.some((x:any)=>x.type==='image'),false)
  await assert.rejects(h.client.readResource({uri:`flymind://exports/${content.id}/1/large-job/svg`}),(error:any)=>error.data?.code==='MCP_RESOURCE_TOO_LARGE')
  const alive=await h.client.callTool({name:'get_diagram',arguments:{id:content.id}});assert.equal(alive.isError,undefined)
 }finally{await h.close()}
})
test('uncertain write is not replayed automatically; next same-key request re-ensures same workspace',async()=>{
 let connects=0,writes=0,commits=0;const seen=new Set<string>()
 const h=await reconnectHarness(async()=>{const attempt=++connects;return fakeConnection('root',async(path,init)=>{
  if(path.endsWith('/ai/diagrams')){writes++;const key=JSON.parse(String(init?.body)).requestId;if(!seen.has(key)){seen.add(key);commits++}if(attempt===1)throw new TypeError('connection reset after commit');return response(record)}
  return response(path.endsWith('/snapshot')?{id:'failed',diagramId:content.id,dataRootId:'root',revision:1,status:'failed'}:pure)
 })})
 try{const args={name:'create_diagram',arguments:{content,requestId:'same-key'}},first=await h.client.callTool(args);assert.equal(first.isError,true);assert.match(JSON.stringify(first),/RUNTIME_CONNECTION_LOST/);assert.match(JSON.stringify(first),/requestId/);assert.equal(writes,1);const second=await h.client.callTool(args);assert.equal((second.structuredContent as any).saved,true);assert.equal(connects,2);assert.equal(writes,2);assert.equal(commits,1)}finally{await h.close()}
})
test('401 re-ensures while business conflicts do not; changed workspace never rebinds',async()=>{
 let connects=0,mode='401',newRoot='root',requests=0
 const h=await reconnectHarness(async()=>{connects++;return fakeConnection(newRoot,async()=>{requests++;if(mode==='401')return response({error:'expired',code:'UNAUTHORIZED'},401);if(mode==='conflict')return response({error:'stale',code:'REVISION_CONFLICT',currentRevision:9},409);return response(pure)})})
 try{const args={name:'get_diagram',arguments:{id:content.id}};assert.match(JSON.stringify(await h.client.callTool(args)),/RUNTIME_UNAUTHORIZED/);mode='conflict';await h.client.callTool(args);await h.client.callTool(args);assert.equal(connects,2);mode='401';await h.client.callTool(args);newRoot='other-root';mode='ok';const before=requests;assert.match(JSON.stringify(await h.client.callTool(args)),/WORKSPACE_MISMATCH/);assert.equal(requests,before);newRoot='root';assert.equal((await h.client.callTool(args)).isError,undefined)}finally{await h.close()}
})
test('late old network failure cannot clear a newly connected cache',async()=>{
 let connects=0,rejectLate!:(e:Error)=>void,entered!:(value?:unknown)=>void;const reached=new Promise(r=>entered=r),late=new Promise<Response>((_r,reject)=>rejectLate=reject)
 const h=await reconnectHarness(async()=>{const instance=++connects;return fakeConnection('root',async path=>{if(instance===1){if(path.includes('/late')){entered();return late}throw new TypeError('offline')}return response(pure)})})
 try{const pending=h.client.callTool({name:'get_diagram',arguments:{id:'late'}});await reached;await h.client.callTool({name:'get_diagram',arguments:{id:'trigger'}});await h.client.callTool({name:'get_diagram',arguments:{id:content.id}});assert.equal(connects,2);rejectLate(new TypeError('late reset'));await pending;await h.client.callTool({name:'get_diagram',arguments:{id:content.id}});assert.equal(connects,2)}finally{await h.close()}
})
test('resource byte and preview PNG network failures use the same connection invalidation',async()=>{
 for(const resource of [false,true])for(const failure of ['network','401','body']){
  let connects=0;const job={id:'job',diagramId:content.id,dataRootId:'root',revision:1,status:'succeeded',files:Object.fromEntries(['png','svg','drawio','json','project.json'].map(f=>[f,{bytes:24,filename:'a.'+f,url:'/studio-api/native/exports/job/files/'+f}]))}
  const h=await reconnectHarness(async()=>{connects++;return fakeConnection('root',async path=>{if(path.includes('/files/')){if(failure==='401')return response({error:'expired'},401);if(failure==='body')return new Response(new ReadableStream({start(controller){controller.error(new TypeError('body lost'))}}));throw new TypeError('network lost')}if(path.endsWith('/delivery'))return response({jobId:'job',diagramId:content.id,dataRootId:'root',revision:1,files:{}});if(path.includes('/exports/')||path.endsWith('/snapshot'))return response(job);return response(pure)})})
  try{if(resource)await assert.rejects(h.client.readResource({uri:`flymind://exports/${content.id}/1/job/json`}),/requestId/);else assert.match(JSON.stringify(await h.client.callTool({name:'get_diagram',arguments:{id:content.id,preview:true}})),failure==='401'?/RUNTIME_UNAUTHORIZED/:/RUNTIME_CONNECTION_LOST/);assert.equal(connects,1);await h.client.callTool({name:'get_diagram',arguments:{id:content.id}});assert.equal(connects,2)}finally{await h.close()}
 }
})


test('native MCP lists and reads canvas-only metadata without fabricated kind/content/quality',async()=>{
 const canvas={format:3,mode:'canvas-only',id:'canvas-only',title:'仅画布',revision:1,createdAt:100,updatedAt:100,workspaceGroupId:null,readOnly:false,syncStatus:'canvas-only'},h=await harness(path=>path==='/studio-api/native/records'?[pure,canvas]:canvas)
 try{const listed=await h.client.callTool({name:'list_diagrams',arguments:{}});assert.ok(!listed.isError,JSON.stringify(listed));const rows=(listed.structuredContent as any).diagrams,row=rows.find((r:any)=>r.diagramId==='canvas-only');assert.equal(row.mode,'canvas-only');for(const key of ['kind','quality','content'])assert.ok(!(key in row));const read=await h.client.callTool({name:'get_diagram',arguments:{id:'canvas-only'}});assert.ok(!read.isError,JSON.stringify(read));assert.equal(read.structuredContent?.mode,'canvas-only');for(const key of ['kind','quality','content'])assert.ok(!(key in read.structuredContent!))}finally{await h.close()}
})
