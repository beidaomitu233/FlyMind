import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,stat,readdir,writeFile,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {randomUUID} from 'node:crypto'
import Database from 'better-sqlite3'
import sharp from 'sharp'
import {DiagramStore} from '../server/store'
import {NativeDiagramService} from '../server/application/native-diagrams'
import {NativeExportService} from '../server/application/native-exports'
import {NativeExportWorker} from '../server/exports/worker'
import {CloudExportPool} from '../server/cloud/export-pool'
import {EXPORT_FORMATS,type NativeExportRenderer} from '../server/exports/types'
import {sha256,exportSnapshotHash,prepareNativeArtifacts,verifyNativeArtifact} from '../server/exports/artifacts'
import {exportBasename} from '../src/drawing/core/export-metadata'
import type {DrawingProjectV3} from '../src/drawing/engine/types'
import type {DiagramContent} from '../src/drawing/core/model'
import type {CloudReleaseManifest} from '../server/cloud/mcp-compat'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'
import {createNativeMcpServer} from '../server/mcp-native/server'
import {runtimeCapabilities} from '../server/runtime-instance/config'
import {guideData} from '../server/mcp-native/guide'
import {inspectDrawing} from '../src/drawing/core/drawing-quality'

const content:DiagramContent={schemaVersion:1,id:'export-test',title:'导出隔离测试',kind:'swimlane',nodes:[{id:'a',kind:'start',label:'开始',laneId:'owner',phaseId:'work'},{id:'b',kind:'end',label:'完成',laneId:'owner',phaseId:'work'}],edges:[{id:'ab',source:'a',target:'b'}],lanes:[{id:'owner',label:'办理人员'}],phases:[{id:'work',label:'办理'}],groups:[]}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms))
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve}}
async function until(fn:()=>boolean,timeoutMs=10000){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){if(fn())return;await sleep(5)}assert.fail('expected checkpoint not reached within wall-clock allowance')}
async function untilAsync(fn:()=>Promise<boolean>,timeoutMs=10000){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){if(await fn())return;await sleep(5)}assert.fail('expected async checkpoint not reached within wall-clock allowance')}
async function rendered(project:DrawingProjectV3){return {png:await sharp({create:{width:20,height:12,channels:4,background:'#4266aa'}}).png().toBuffer(),svg:'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="12" viewBox="0 0 20 12"><rect width="20" height="12" fill="#4266aa"/></svg>',width:20,height:12,scale:1,nativeXML:project.rendering.engine.xml,runtime:{drawioVersion:'unit-mock',browserVersion:'unit-mock',fontFamily:'unit-mock',fontSha256:'0'.repeat(64)},timings:{totalMs:1,browserStartMs:0,loadMs:0,exportMs:1},warnings:[]}}
class Renderer implements NativeExportRenderer {
  calls:DrawingProjectV3[]=[];active=0;maxActive=0;closed=false
  action:(project:DrawingProjectV3)=>ReturnType<NativeExportRenderer['render']>=rendered
  async render(project:DrawingProjectV3){this.calls.push(structuredClone(project));this.active++;this.maxActive=Math.max(this.maxActive,this.active);try{return await this.action(project)}finally{this.active--}}
  async close(){this.closed=true}
}
async function setup(){const root=await mkdtemp(join(tmpdir(),'flymind-export-')),store=new DiagramStore(root);await store.init();const diagrams=new NativeDiagramService(store,true),record=await diagrams.create({content,requestId:'create-source'}),exports=new NativeExportService(store,true);return {root,store,diagrams,record,exports,identity:diagrams.dataRootId!}}
async function cleanup(root:string){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-export-'));await rm(root,{recursive:true,force:true})}
function sql<T>(store:DiagramStore,fn:(db:Database.Database)=>T){const db=new Database(store.databasePath);try{return fn(db)}finally{db.close()}}
const create=(s:Awaited<ReturnType<typeof setup>>,requestId='export-request')=>s.exports.create(content.id,{expectedRevision:1,requestId},s.identity)

test('cloud jobs persist their release across restart and reject a changed renderer before executing',async()=>{
 const s=await setup(),bound:CloudReleaseManifest={releaseId:'release-a',appVersion:'1.1.0',policyBundleHash:'a'.repeat(64),standardVersion:'1.1',engineResourceKey:'b'.repeat(64),adapterVersion:'1',migrationLevel:1},exports=new NativeExportService(s.store,true,Promise.resolve(bound)),renderer=new Renderer()
 try{
  const job=await exports.create(content.id,{expectedRevision:1,requestId:'cloud-bound'},s.identity);assert.deepEqual(job.release,bound)
  const restarted=new DiagramStore(s.root),stored=await restarted.getNativeExport(job.id);assert.deepEqual(stored.job.release,bound)
  const changed={...bound,releaseId:'release-b',engineResourceKey:'c'.repeat(64)},worker=new NativeExportWorker(restarted,renderer,{release:Promise.resolve(changed)})
  const failed=await worker.runOnce();assert.equal(failed?.status,'failed');assert.equal(failed?.error?.code,'EXPORT_SUPPLY_UNAVAILABLE');assert.equal(renderer.calls.length,0);await worker.close()
  const retry=await exports.retry(job.id,{requestId:'bound-retry'},s.identity);assert.deepEqual(retry.release,bound)
  const matching=new Renderer(),compatible=new NativeExportWorker(restarted,matching,{release:Promise.resolve({...bound,releaseId:'policy-update',policyBundleHash:'d'.repeat(64)})})
  const succeeded=await compatible.runOnce();assert.equal(succeeded?.status,'succeeded');assert.deepEqual(succeeded?.manifest?.release,bound);assert.equal(matching.calls.length,1);await compatible.close()
  const legacy=await create(s,'old-job'),blocked=new NativeExportWorker(restarted,new Renderer(),{release:Promise.resolve(bound)})
  const unknown=await blocked.runOnce();assert.equal(unknown?.id,legacy.id);assert.equal(unknown?.error?.code,'EXPORT_RELEASE_UNKNOWN');await blocked.close()
  await assert.rejects(exports.retry(legacy.id,{requestId:'unknown-retry'},s.identity),(e:any)=>e.code==='EXPORT_RELEASE_UNKNOWN')
 }finally{await cleanup(s.root)}
})

test('export enqueue uses immutable same-SQLite snapshots, strict options, CAS and payload idempotence',async()=>{
  const s=await setup()
  try{
    for(const options of [{scale:0},{scale:5},{scale:'1'},{background:'red'},{extra:true}])await assert.rejects(s.exports.create(content.id,{expectedRevision:1,requestId:'bad-options',options},s.identity))
    for(const rootId of [undefined,'wrong'])await assert.rejects(s.exports.create(content.id,{expectedRevision:1,requestId:'bad-root'},rootId),(e:any)=>e.code==='WORKSPACE_MISMATCH')
    await assert.rejects(s.exports.create(content.id,{expectedRevision:2,requestId:'stale'},s.identity),(e:any)=>e.code==='REVISION_CONFLICT')
    await assert.rejects(s.exports.create('sample-swimlane',{expectedRevision:1,requestId:'legacy'},s.identity),(e:any)=>e.code==='NATIVE_DOCUMENT_REQUIRED')
    const jobs=await Promise.all([create(s),create(s)]);assert.equal(jobs[0].id,jobs[1].id)
    await assert.rejects(s.exports.create(content.id,{expectedRevision:1,requestId:'export-request',options:{scale:2}},s.identity),(e:any)=>e.code==='IDEMPOTENCY_KEY_REUSED')
    await s.diagrams.patchContent(content.id,{expectedRevision:1,requestId:'rev2',operations:[{op:'set_title',title:'修订二'}]})
    const replay=await create(s);assert.equal(replay.id,jobs[0].id);assert.equal(replay.revision,1);assert.equal(replay.isCurrentRevision,false)
    const stored=await s.store.getNativeExport(replay.id);assert.deepEqual(stored.job.snapshot,s.record.document);assert.equal(stored.job.snapshotSha256,exportSnapshotHash(s.record.document))
    assert.equal(sql(s.store,db=>(db.prepare('SELECT count(*) n FROM native_export_jobs').get() as any).n),1)
  }finally{await cleanup(s.root)}
})

test('single worker publishes five verified files from one snapshot without changing document times',async()=>{
  let diagnostic:unknown
  const s=await setup(),renderer=new Renderer(),worker=new NativeExportWorker(s.store,renderer,{onError:error=>diagnostic=error})
  try{
    const job=await create(s);await assert.rejects(s.exports.file(job.id,'png'),(e:any)=>e.code==='EXPORT_NOT_READY')
    const running=[worker.runOnce(),worker.runOnce()];await Promise.all(running)
    const done=await s.exports.get(job.id);assert.equal(done.status,'succeeded',String((diagnostic as Error)?.stack||JSON.stringify(done)));assert.equal(renderer.calls.length,1);assert.equal(renderer.maxActive,1);assert.equal(done.width,20);assert.equal(done.height,12)
    const internal=(await s.store.getNativeExport(job.id)).job
    const directory=join(s.root,'artifacts',content.id,'r1','exports',job.id,internal.leaseToken!)
    for(const format of EXPORT_FORMATS){const file=await s.exports.file(job.id,format);assert.equal(sha256(file.buffer),done.files![format].sha256);assert.equal(file.buffer.length,file.bytes);assert.ok(file.filename.startsWith(exportBasename(content.title,done.exportedAt!)));assert.ok(Math.abs((await stat(join(directory,file.filename))).mtimeMs-done.exportedAt!)<=5)}
    assert.deepEqual(JSON.parse((await s.exports.file(job.id,'json')).buffer.toString()),s.record.document.content)
    assert.deepEqual(JSON.parse((await s.exports.file(job.id,'project.json')).buffer.toString()),s.record.document)
    assert.equal((await s.exports.file(job.id,'drawio')).buffer.toString(),s.record.document.rendering.engine.xml)
    assert.deepEqual(await s.diagrams.get(content.id),s.record)
    const delivery=await s.exports.delivery(job.id)
    // Delivery intentionally returns a canonical path; Windows TEMP may use an 8.3 alias.
    for(const format of EXPORT_FORMATS){assert.equal(delivery.files[format],await realpath(join(directory,done.files![format].filename)));assert.ok((await stat(delivery.files[format])).isFile())}
    assert.ok(!JSON.stringify(done).includes(s.root));assert.ok(!JSON.stringify(done).includes('leaseToken'));assert.equal(await readFile(join(directory,'manifest.json'),'utf8').then(x=>JSON.parse(x).revision),1)
    const repeat=await create(s,'second-export');await worker.runOnce();const regenerated=await s.exports.get(repeat.id);assert.notEqual(repeat.id,job.id);assert.ok(regenerated.exportedAt!>=done.exportedAt!);assert.deepEqual(await s.diagrams.get(content.id),s.record)
  }finally{await worker.close();assert.equal(renderer.closed,true);await cleanup(s.root)}
})

test('large UTF8 SVG writes across chunk boundaries and path delivery verifies without returning a file buffer',async()=>{
 const s=await setup(),renderer=new Renderer(),worker=new NativeExportWorker(s.store,renderer)
 const prefix='<svg xmlns="http://www.w3.org/2000/svg" width="20" height="12"><text>',svg=prefix+'中'.repeat(65535-prefix.length)+'😀尾</text></svg>'
 renderer.action=async project=>({...await rendered(project),svg})
 try{
  const task=await create(s);await worker.runOnce();const {job}=await s.store.getNativeExport(task.id)
  assert.equal(job.status,'succeeded',JSON.stringify(job.error));const checked=await verifyNativeArtifact(s.root,job,'svg')
  assert.ok(!('buffer'in checked));assert.equal(checked.bytes,Buffer.byteLength(svg));assert.equal(checked.sha256,sha256(svg))
  assert.equal((await s.exports.file(task.id,'svg')).buffer.toString('utf8'),svg)
  const delivery=await s.exports.delivery(task.id);assert.equal(delivery.files.svg,checked.path)
  await writeFile(checked.path,svg.replace('😀','😁'));await assert.rejects(s.exports.delivery(task.id),(e:any)=>e.code==='EXPORT_ARTIFACT_CORRUPT')
 }finally{await worker.close();await cleanup(s.root)}
})

test('failed r1 retry after r2 preserves snapshot metadata and delivery rejects unregistered or corrupt files',async()=>{
 const s=await setup(),renderer=new Renderer(),worker=new NativeExportWorker(s.store,renderer)
 try{
  renderer.action=async()=>{throw new Error('injected failure')};const first=await create(s);await worker.runOnce();assert.equal((await s.exports.get(first.id)).status,'failed');await assert.rejects(s.exports.delivery(first.id),(e:any)=>e.code==='EXPORT_NOT_READY')
  await s.diagrams.patchContent(content.id,{expectedRevision:1,requestId:'advance',operations:[{op:'set_title',title:'修订二'}]},s.identity)
  const anchor=await s.exports.snapshot(first.id);assert.equal(anchor.content.title,content.title);assert.equal(anchor.revision,1);assert.equal(anchor.currentRevision,2);assert.equal(anchor.updatedAt,s.record.document.updatedAt)
  renderer.action=rendered;const retry=await s.exports.retry(first.id,{requestId:'retry-old'},s.identity);await worker.runOnce();assert.equal((await s.exports.get(retry.id)).status,'succeeded');assert.equal((await s.exports.snapshot(retry.id)).content.title,content.title);assert.deepEqual(JSON.parse((await s.exports.file(retry.id,'project.json')).buffer.toString()),s.record.document)
  const delivery=await s.exports.delivery(retry.id);await writeFile(delivery.files.png,'corrupt');await assert.rejects(s.exports.delivery(retry.id),(e:any)=>e.code==='EXPORT_ARTIFACT_CORRUPT')
 }finally{await worker.close();await cleanup(s.root)}
})

test('remote MCP resumes and retries an immutable export snapshot with application quality',async()=>{
 const s=await setup(),renderer=new Renderer(),worker=new NativeExportWorker(s.store,renderer)
 let facade:Awaited<ReturnType<typeof createNativeMcpServer>>|undefined,client:Client|undefined,omitQuality=false
 const calls:{path:string;method:string}[]=[]
 try{
  renderer.action=async()=>{throw new Error('injected failure')}
  const first=await create(s);await worker.runOnce();assert.equal((await s.exports.get(first.id)).status,'failed')
  await s.diagrams.patchContent(content.id,{expectedRevision:1,requestId:'advance-quality',operations:[{op:'set_title',title:'修订二'},{op:'update_node',id:'a',changes:{label:'核对资料并逐项完成所有必要审核工作流程'}}]},s.identity)
  const oldQuality=inspectDrawing(s.record.document.content),current=await s.diagrams.get(content.id)
  assert.notDeepEqual(inspectDrawing(current.document.content),oldQuality)
  facade=await createNativeMcpServer(async()=>({baseURL:'http://127.0.0.1:5179',dataRootId:s.identity,instanceId:'test-instance',sessionToken:'secret',capabilities:runtimeCapabilities(),headers:()=>({}),authenticatedFetch:async(path,init={})=>{
   calls.push({path,method:init.method??'GET'})
   let value:unknown
   if(path.endsWith('/guide'))value={...guideData,guide:'authoritative application guide'}
   else if(path.endsWith('/snapshot')){const snapshot=await s.exports.snapshot(first.id);if(omitQuality){const copy={...snapshot} as any;delete copy.quality;value=copy}else value=snapshot}
   else if(path.endsWith('/retry'))value=await s.exports.retry(first.id,JSON.parse(String(init.body)),s.identity)
   else if(path.includes('/records/'))value=await s.diagrams.get(content.id)
   else if(path.includes('/exports/'))value=await s.exports.get(path.split('/').at(-1)!)
   else throw new Error('unexpected application path '+path)
   return Response.json(value)
  },close:async()=>{}}),{remoteApplication:true,waitMs:0,pollMs:1})
  const [serverTransport,clientTransport]=InMemoryTransport.createLinkedPair();client=new Client({name:'remote-export-regression',version:'1'});await facade.server.connect(serverTransport);await client.connect(clientTransport)
  const resumed=await client.callTool({name:'export_diagram',arguments:{id:content.id,requestId:'resume-old',jobId:first.id,expectedRevision:1}}),resumedData=resumed.structuredContent as any
  assert.equal(resumed.isError,undefined,JSON.stringify(resumed));assert.equal(resumedData.exportStatus,'failed');assert.equal(resumedData.jobId,first.id);assert.equal(resumedData.revision,1);assert.equal(resumedData.currentRevision,2);assert.equal(resumedData.isCurrentRevision,false);assert.deepEqual(resumedData.quality,oldQuality)
  assert.equal(calls.some(call=>call.method==='POST'),false)
  omitQuality=true
  const denied=await client.callTool({name:'export_diagram',arguments:{id:content.id,requestId:'missing-quality',retryJobId:first.id,expectedRevision:1}})
  assert.equal(denied.isError,true);assert.match(JSON.stringify(denied),/APPLICATION_QUALITY_MISSING/);assert.equal(calls.some(call=>call.method==='POST'),false)
  omitQuality=false
  const retried=await client.callTool({name:'export_diagram',arguments:{id:content.id,requestId:'retry-old',retryJobId:first.id,expectedRevision:1}}),retryData=retried.structuredContent as any
  assert.equal(retried.isError,undefined,JSON.stringify(retried));assert.equal(retryData.exportStatus,'waiting_timeout');assert.notEqual(retryData.jobId,first.id);assert.equal(retryData.revision,1);assert.equal(retryData.currentRevision,2);assert.deepEqual(retryData.quality,oldQuality)
  assert.deepEqual((await s.exports.snapshot(retryData.jobId)).quality,oldQuality);assert.equal((await s.exports.get(retryData.jobId)).sourceJobId,first.id)
  assert.equal(calls.filter(call=>call.method==='POST').length,1);assert.ok(calls.some(call=>call.path.endsWith('/retry')))
 }finally{await client?.close();await facade?.close();await worker.close();await cleanup(s.root)}
})

test('a queued old revision remains historical when the document changes during rendering',async()=>{
  const s=await setup(),renderer=new Renderer(),gate=deferred<Awaited<ReturnType<NativeExportRenderer['render']>>>(),worker=new NativeExportWorker(s.store,renderer)
  try{
    renderer.action=()=>gate.promise;const job=await create(s),running=worker.runOnce();await until(()=>renderer.calls.length===1)
    const newer=await s.diagrams.patchContent(content.id,{expectedRevision:1,requestId:'newer',operations:[{op:'set_title',title:'新修订必须保留'}]})
    gate.resolve(await rendered(s.record.document));await running
    const old=await s.exports.get(job.id);assert.equal(old.revision,1);assert.equal(old.isCurrentRevision,false);assert.equal(JSON.parse((await s.exports.file(job.id,'project.json')).buffer.toString()).content.title,content.title);assert.deepEqual(await s.diagrams.get(content.id),newer)
  }finally{await worker.close();await cleanup(s.root)}
})

test('expired leases can restart; a late old worker cannot publish over the new owner',async()=>{
  const s=await setup(),slow=new Renderer(),fast=new Renderer(),gate=deferred<Awaited<ReturnType<NativeExportRenderer['render']>>>()
  const first=new NativeExportWorker(s.store,slow,{leaseMs:25,heartbeat:false,timeoutMs:2000}),second=new NativeExportWorker(new DiagramStore(s.root),fast,{leaseMs:1000})
  try{
    slow.action=()=>gate.promise;const job=await create(s),late=first.runOnce();await until(()=>slow.calls.length===1);await sleep(35)
    await second.runOnce();const completed=(await s.store.getNativeExport(job.id)).job;assert.equal(completed.attempts,2);assert.equal(completed.status,'succeeded')
    const token=completed.leaseToken;gate.resolve(await rendered(s.record.document));await late
    const after=(await s.store.getNativeExport(job.id)).job;assert.equal(after.leaseToken,token);assert.equal(after.manifest!.exportedAt,completed.manifest!.exportedAt);assert.equal((await s.exports.file(job.id,'png')).sha256,completed.manifest!.files.png.sha256)
    const folders=await readdir(join(s.root,'artifacts',content.id,'r1','exports',job.id));assert.ok(folders.some(f=>f.startsWith('.')),'late staging may remain but is not registered or publicly readable')
  }finally{gate.resolve(await rendered(s.record.document));await first.close();await second.close();await cleanup(s.root)}
})

test('timeout ignores a renderer that resolves late, and explicit retry gets a new immutable job',async()=>{
  const s=await setup(),renderer=new Renderer(),gate=deferred<Awaited<ReturnType<NativeExportRenderer['render']>>>(),worker=new NativeExportWorker(s.store,renderer,{leaseMs:5000,timeoutMs:2000})
  try{
    renderer.action=()=>gate.promise;const original=await create(s),attempt=worker.runOnce();await until(()=>renderer.calls.length===1);await untilAsync(async()=>(await s.exports.get(original.id)).status==='failed');const failed=await s.exports.get(original.id);assert.equal(failed.error?.code,'EXPORT_TIMEOUT');assert.equal(failed.files,undefined)
    const queued=await create(s,'behind-timeout');let finished=false;void attempt.then(()=>{finished=true});assert.strictEqual(worker.runOnce(),attempt);await sleep(20);assert.equal(finished,false);assert.equal((await s.store.getNativeExport(queued.id)).job.attempts,0)
    gate.resolve(await rendered(s.record.document));await attempt;assert.equal((await s.exports.get(original.id)).status,'failed');await assert.rejects(s.exports.file(original.id,'png'))
    renderer.action=rendered;await worker.runOnce();assert.equal((await s.exports.get(queued.id)).status,'succeeded')
    await s.diagrams.patchContent(content.id,{expectedRevision:1,requestId:'after-failure',operations:[{op:'set_title',title:'新业务修订'}]})
    const retry=await s.exports.retry(original.id,{requestId:'retry-failed'},s.identity);assert.notEqual(retry.id,original.id);assert.equal(retry.sourceJobId,original.id);assert.equal(retry.revision,1);assert.equal(retry.isCurrentRevision,false)
    const successRenderer=new Renderer(),retryWorker=new NativeExportWorker(s.store,successRenderer)
    try{await retryWorker.runOnce();const retried=await s.exports.get(retry.id);assert.equal(retried.status,'succeeded',JSON.stringify(retried.error));assert.equal((await s.exports.retry(original.id,{requestId:'retry-failed'},s.identity)).id,retry.id)}finally{await retryWorker.close()}
  }finally{gate.resolve(await rendered(s.record.document));await worker.close();await cleanup(s.root)}
})

test('crashed lease resumes across store instances and bounded expired attempts become explicit failure',async()=>{
  const s=await setup()
  try{
    const job=await create(s),now=Date.now();const lease=await s.store.claimNativeExport('crashed-owner',10,now);assert.equal(lease!.id,job.id)
    const replacement=new DiagramStore(s.root),reclaimed=await replacement.claimNativeExport('replacement-owner',10,now+11);assert.equal(reclaimed!.attempts,2);assert.notEqual(reclaimed!.leaseToken,lease!.leaseToken)
    await assert.rejects(s.store.renewNativeExport(job.id,'crashed-owner',lease!.leaseToken!,10,now+12),(e:any)=>e.code==='EXPORT_LEASE_LOST')
    await replacement.claimNativeExport('third-owner',10,now+22);assert.equal(await replacement.claimNativeExport('exhausted-owner',10,now+33),undefined);assert.equal((await s.exports.get(job.id)).error?.code,'EXPORT_LEASE_EXPIRED')
  }finally{await cleanup(s.root)}
})

test('cloud pool holds all teams after cancellation until the old pipeline settles',async()=>{
 const a=await setup(),b=await setup(),renderer=new Renderer(),gate=deferred<Awaited<ReturnType<NativeExportRenderer['render']>>>()
 const pool=new CloudExportPool(renderer,2);let releaseA:(()=>void)|undefined,releaseB:(()=>void)|undefined
 try{
  releaseA=pool.reserve({store:a.store,dataRootId:a.identity});releaseB=pool.reserve({store:b.store,dataRootId:b.identity})
  const first=await create(a,'pool-a'),second=await create(b,'pool-b')
  renderer.action=project=>renderer.calls.length===1?gate.promise:rendered(project)
  releaseA();releaseA=undefined;releaseB();releaseB=undefined
  await until(()=>renderer.calls.length===1)
  const worker=(pool as any).entries.get(a.identity).worker as NativeExportWorker
  ;(worker as any).controller.abort(Object.assign(new Error('cancelled fixture'),{code:'TEST_CANCELLED'}))
  await untilAsync(async()=>(await a.exports.get(first.id)).status==='failed')
  const pending=(await b.store.getNativeExport(second.id)).job;assert.equal(pending.status,'queued');assert.equal(pending.attempts,0)
  assert.equal(renderer.calls.length,1);await sleep(20);assert.equal(renderer.calls.length,1)
  gate.resolve(await rendered(a.record.document))
  await untilAsync(async()=>(await b.exports.get(second.id)).status==='succeeded')
  assert.equal(renderer.calls.length,2);assert.equal(renderer.maxActive,1)
  assert.equal((await a.exports.get(first.id)).status,'failed');await assert.rejects(a.exports.file(first.id,'png'),(e:any)=>e.code==='EXPORT_NOT_READY')
 }finally{releaseA?.();releaseB?.();gate.resolve(await rendered(a.record.document));await pool.close();await cleanup(a.root);await cleanup(b.root)}
})

test('cloud pool waits for the tracked renderer quiescence after result cancellation',async()=>{
 const a=await setup(),b=await setup(),renderer=new Renderer(),gate=deferred<void>(),pool=new CloudExportPool(renderer,2)
 let releaseA:(()=>void)|undefined,releaseB:(()=>void)|undefined
 ;(renderer as any).renderTracked=(project:DrawingProjectV3,options:{signal:AbortSignal})=>{
  const first=renderer.calls.length===0
  renderer.action=first?()=>new Promise((_yes,no)=>options.signal.addEventListener('abort',()=>no(options.signal.reason),{once:true})):rendered
  return {result:renderer.render(project),quiescence:first?gate.promise:Promise.resolve()}
 }
 try{
  releaseA=pool.reserve({store:a.store,dataRootId:a.identity});releaseB=pool.reserve({store:b.store,dataRootId:b.identity})
  const first=await create(a,'tracked-pool-a'),second=await create(b,'tracked-pool-b');releaseA();releaseA=undefined;releaseB();releaseB=undefined
  await until(()=>renderer.calls.length===1);const worker=(pool as any).entries.get(a.identity).worker as NativeExportWorker
  ;(worker as any).controller.abort(Object.assign(Error('cancelled fixture'),{code:'TEST_CANCELLED'}))
  await untilAsync(async()=>(await a.exports.get(first.id)).status==='failed');await sleep(20)
  assert.equal(renderer.calls.length,1);assert.equal((await b.store.getNativeExport(second.id)).job.attempts,0)
  gate.resolve();await untilAsync(async()=>(await b.exports.get(second.id)).status==='succeeded')
  assert.equal(renderer.calls.length,2);assert.equal((await a.exports.get(first.id)).status,'failed');await assert.rejects(a.exports.file(first.id,'png'),(e:any)=>e.code==='EXPORT_NOT_READY')
 }finally{releaseA?.();releaseB?.();gate.resolve();await pool.close();await cleanup(a.root);await cleanup(b.root)}
})

test('tracked cleanup rejection faults all teams and reports close and maintenance failure',async()=>{
 const a=await setup(),b=await setup(),renderer=new Renderer(),pool=new CloudExportPool(renderer,2);let rejectQuiescence!:(error:Error)=>void
 const quiescence=new Promise<void>((_yes,no)=>{rejectQuiescence=no})
 void quiescence.catch(()=>{})
 ;(renderer as any).renderTracked=(project:DrawingProjectV3,options:{signal:AbortSignal})=>{
  renderer.action=()=>new Promise((_yes,no)=>options.signal.addEventListener('abort',()=>no(options.signal.reason),{once:true}))
  return {result:renderer.render(project),quiescence}
 }
 let releaseA:(()=>void)|undefined,releaseB:(()=>void)|undefined
 try{
  releaseA=pool.reserve({store:a.store,dataRootId:a.identity});releaseB=pool.reserve({store:b.store,dataRootId:b.identity})
  const first=await create(a,'cleanup-failed-a'),second=await create(b,'cleanup-failed-b');releaseA();releaseA=undefined;releaseB();releaseB=undefined
  await until(()=>renderer.calls.length===1);const worker=(pool as any).entries.get(a.identity).worker as NativeExportWorker
  ;(worker as any).controller.abort(Object.assign(Error('cancelled fixture'),{code:'TEST_CANCELLED'}))
  await untilAsync(async()=>(await a.exports.get(first.id)).status==='failed');rejectQuiescence(Error('private cleanup detail'))
  await until(()=>worker.cleanupFailure?.code==='EXPORT_CLEANUP_UNCERTAIN');await until(()=>!!(pool as any).cleanupError)
  assert.equal((await b.store.getNativeExport(second.id)).job.attempts,0);assert.equal(renderer.calls.length,1)
  assert.throws(()=>pool.reserve({store:b.store,dataRootId:b.identity}),(e:any)=>e.code==='EXPORT_CLEANUP_UNCERTAIN')
  await assert.rejects(pool.quiesce({timeoutMs:25}),(e:any)=>e.code==='EXPORT_CLEANUP_UNCERTAIN')
  await assert.rejects(pool.close(),(e:any)=>e.code==='EXPORT_CLEANUP_UNCERTAIN');assert.equal(renderer.closed,true)
 }finally{releaseA?.();releaseB?.();rejectQuiescence(Error('cleanup'));await pool.close().catch(()=>{});await cleanup(a.root);await cleanup(b.root)}
})

test('stop is idempotent and waits for cancelled pipeline without claiming the next job',async()=>{
 const s=await setup(),renderer=new Renderer(),gate=deferred<Awaited<ReturnType<NativeExportRenderer['render']>>>(),worker=new NativeExportWorker(s.store,renderer)
 let closeCalls=0;renderer.close=async()=>{closeCalls++;renderer.closed=true}
 try{
  const first=await create(s,'stop-a'),second=await create(s,'stop-b');renderer.action=()=>gate.promise
  const running=worker.runOnce();await until(()=>renderer.calls.length===1)
  const closing=worker.close();assert.strictEqual(worker.close(),closing)
  await untilAsync(async()=>(await s.exports.get(first.id)).status==='failed');assert.equal(closeCalls,1)
  let finished=false;void closing.then(()=>{finished=true});await sleep(20);assert.equal(finished,false)
  assert.equal((await s.store.getNativeExport(second.id)).job.attempts,0)
  gate.resolve(await rendered(s.record.document));await Promise.all([running,closing])
  assert.equal((await s.exports.get(first.id)).status,'failed');await assert.rejects(s.exports.file(first.id,'png'),(e:any)=>e.code==='EXPORT_NOT_READY')
  assert.equal(await worker.runOnce(),undefined);assert.equal(renderer.calls.length,1)
 }finally{gate.resolve(await rendered(s.record.document));await worker.close();await cleanup(s.root)}
})

test('stop during claim does not wait for an unresolved release or start rendering',async()=>{
 const s=await setup(),renderer=new Renderer(),claimGate=deferred<void>(),releaseGate=deferred<CloudReleaseManifest>(),claimStarted=deferred<void>()
 const originalClaim=s.store.claimNativeExport.bind(s.store)
 s.store.claimNativeExport=async(...args)=>{claimStarted.resolve();await claimGate.promise;return originalClaim(...args)}
 const worker=new NativeExportWorker(s.store,renderer,{release:releaseGate.promise})
 try{
  const job=await create(s,'claim-stop'),running=worker.runOnce();await claimStarted.promise
  const closing=worker.close();claimGate.resolve()
  await Promise.race([closing,sleep(2000).then(()=>{throw Error('stop waited for unresolved release')})]);await running
  assert.equal((await s.exports.get(job.id)).status,'failed');assert.equal((await s.exports.get(job.id)).error?.code,'EXPORT_WORKER_STOPPED');assert.equal(renderer.calls.length,0);assert.equal(renderer.closed,true)
 }finally{claimGate.resolve();releaseGate.resolve({releaseId:'unused',appVersion:'1',policyBundleHash:'a'.repeat(64),standardVersion:'1',engineResourceKey:'b'.repeat(64),adapterVersion:'1',migrationLevel:1});await worker.close();await cleanup(s.root)}
})

test('pool close attempts worker and renderer cleanup after scan and synchronous close failures',async()=>{
 const scanError=Error('scan fixture'),closeError=Error('renderer close fixture');let workers=0,renders=0
 const pool=new CloudExportPool({render:async()=>{throw Error('unused')},close:(()=>{renders++;throw closeError}) as any},1)
 pool.reserve({store:{} as DiagramStore,dataRootId:'fixture'})
 ;(pool as any).entries.get('fixture').worker.close=async()=>{workers++}
 ;(pool as any).scanning=Promise.reject(scanError)
 const closing=pool.close();assert.strictEqual(pool.close(),closing)
 await assert.rejects(closing,error=>error===scanError);assert.equal(workers,1);assert.equal(renders,1)
})

test('stop cancels an already waiting release without waiting for it to settle',async()=>{
 const s=await setup(),renderer=new Renderer(),releaseGate=deferred<CloudReleaseManifest>();let entered=false
 const release={then:(yes:(value:CloudReleaseManifest)=>unknown,no:(error:unknown)=>unknown)=>{entered=true;return releaseGate.promise.then(yes,no)}} as unknown as Promise<CloudReleaseManifest>
 const worker=new NativeExportWorker(s.store,renderer,{release})
 try{
  const job=await create(s,'release-stop'),running=worker.runOnce();await until(()=>entered)
  const closing=worker.close();await Promise.race([closing,sleep(2000).then(()=>{throw Error('stop waited for unresolved release')})]);await running
  const failed=await s.exports.get(job.id);assert.equal(failed.status,'failed');assert.equal(failed.error?.code,'EXPORT_WORKER_STOPPED');assert.equal(renderer.calls.length,0)
 }finally{releaseGate.resolve({releaseId:'unused',appVersion:'1',policyBundleHash:'a'.repeat(64),standardVersion:'1',engineResourceKey:'b'.repeat(64),adapterVersion:'1',migrationLevel:1});await worker.close();await cleanup(s.root)}
})

test('pool awaits workers even when shared renderer close throws synchronously',async()=>{
 const closeError=Error('renderer close fixture'),gate=deferred<void>();let workers=0
 const pool=new CloudExportPool({render:async()=>{throw Error('unused')},close:(()=>{throw closeError}) as any},1)
 pool.reserve({store:{} as DiagramStore,dataRootId:'fixture'})
 ;(pool as any).entries.get('fixture').worker.close=async()=>{workers++;await gate.promise}
 try{let finished=false;const closing=pool.close();void closing.catch(()=>{finished=true});await until(()=>workers===1);await sleep(20);assert.equal(finished,false);gate.resolve();await assert.rejects(closing,error=>error===closeError)}finally{gate.resolve()}
})

test('cloud maintenance refuses to drain a failed but still unsettled pipeline',async()=>{
 const s=await setup(),renderer=new Renderer(),gate=deferred<Awaited<ReturnType<NativeExportRenderer['render']>>>(),pool=new CloudExportPool(renderer,1)
 let release:(()=>void)|undefined
 try{
  release=pool.reserve({store:s.store,dataRootId:s.identity});const first=await create(s,'maintenance-a'),second=await create(s,'maintenance-b')
  renderer.action=()=>gate.promise;release();release=undefined;await until(()=>renderer.calls.length===1)
  const worker=(pool as any).entries.get(s.identity).worker as NativeExportWorker
  ;(worker as any).controller.abort(Object.assign(new Error('cancelled fixture'),{code:'TEST_CANCELLED'}))
  await untilAsync(async()=>(await s.exports.get(first.id)).status==='failed')
  await assert.rejects(pool.quiesce({timeoutMs:25}),(e:any)=>e.code==='CLOUD_EXPORT_DRAIN_TIMEOUT')
  assert.equal((await s.store.getNativeExport(second.id)).job.attempts,0);assert.equal(renderer.calls.length,1)
  gate.resolve(await rendered(s.record.document));await pool.quiesce({timeoutMs:2000})
  assert.equal((await s.exports.get(first.id)).status,'failed');assert.equal((await s.exports.get(second.id)).status,'queued')
 }finally{release?.();gate.resolve(await rendered(s.record.document));await pool.close();await cleanup(s.root)}
})

test('hard deadline covers stalled preparation and publication; late filesystem work stays unregistered',async()=>{
  for(const stage of ['prepare','publish','event-loop'] as const){
    const s=await setup(),renderer=new Renderer(),gate=deferred<void>();let entered=false,finished=false,preparationError:unknown
    // Leave ample budget for validation under the default suite/build CPU load.
    // The injected stall starts only after the intended stage has been observed.
    const timeoutMs=2000
    const worker=new NativeExportWorker(s.store,renderer,{leaseMs:5000,timeoutMs,prepareArtifacts:async(...args)=>{
      if(stage==='prepare'){entered=true;await gate.promise}
      let prepared:Awaited<ReturnType<typeof prepareNativeArtifacts>>
      try{prepared=await prepareNativeArtifacts(...args)}catch(error){preparationError=error;finished=true;throw error}
      if(stage==='event-loop'){entered=true;const until=Date.now()+timeoutMs+250;while(Date.now()<until){};finished=true;return prepared}
      if(stage==='publish')return {...prepared,publish:async()=>{entered=true;await gate.promise;await prepared.publish();finished=true}}
      finished=true;return prepared
    }})
    try{
      const job=await create(s),attempt=worker.runOnce();await until(()=>entered);await untilAsync(async()=>(await s.exports.get(job.id)).status==='failed')
      assert.equal((await s.exports.get(job.id)).status,'failed');assert.equal((await s.exports.get(job.id)).error?.code,'EXPORT_TIMEOUT')
      await assert.rejects(s.exports.file(job.id,'png'),(e:any)=>e.code==='EXPORT_NOT_READY')
      const failed=(await s.store.getNativeExport(job.id)).job;assert.equal(failed.leaseOwner,undefined);assert.equal(failed.manifest,undefined)
      gate.resolve();await attempt;await until(()=>finished);await sleep(5)
      if(stage==='prepare')assert.equal((preparationError as {code?:string})?.code,'HEAVY_WORK_ABORTED')
      assert.equal((await s.exports.get(job.id)).status,'failed');assert.equal((await s.store.getNativeExport(job.id)).job.manifest,undefined)
    }finally{gate.resolve();await worker.close();await cleanup(s.root)}
  }
})

test('SQLite lease gate keeps two worker instances from rendering different jobs concurrently',async()=>{
  const s=await setup(),first=new Renderer(),second=new Renderer(),gate=deferred<Awaited<ReturnType<NativeExportRenderer['render']>>>()
  const a=new NativeExportWorker(s.store,first),b=new NativeExportWorker(new DiagramStore(s.root),second)
  try{
    await create(s,'single-global-a');await create(s,'single-global-b');first.action=()=>gate.promise
    const running=a.runOnce();await until(()=>first.calls.length===1);assert.equal(await b.runOnce(),undefined);assert.equal(second.calls.length,0)
    gate.resolve(await rendered(s.record.document));await running;await b.runOnce();assert.equal(second.calls.length,1)
  }finally{await a.close();await b.close();await cleanup(s.root)}
})

test('deleted records and changed workspace identities reject enqueue, replay, completion and download',async()=>{
  const s=await setup(),renderer=new Renderer(),worker=new NativeExportWorker(s.store,renderer)
  try{
    const job=await create(s);await worker.runOnce();await s.store.delete(content.id,1)
    await assert.rejects(create(s),(e:any)=>e.status===410);await assert.rejects(s.exports.file(job.id,'png'),(e:any)=>e.status===410)
    const trash=(await s.store.listTrash()).find(t=>t.id===content.id)!;await s.store.restoreStored(content.id,trash.revision,trash.deletedAt)
    sql(s.store,db=>db.prepare("UPDATE metadata SET value=? WHERE key='native_workspace_id'").run(randomUUID()))
    await assert.rejects(create(s),(e:any)=>e.code==='WORKSPACE_MISMATCH');await assert.rejects(s.exports.file(job.id,'png'),(e:any)=>e.code==='WORKSPACE_MISMATCH')
  }finally{await worker.close();await cleanup(s.root)}
})

test('renderer failure/invalid output never returns old artifacts and resource reads enforce whitelist and digest',async()=>{
  const s=await setup(),renderer=new Renderer(),worker=new NativeExportWorker(s.store,renderer)
  try{
    const first=await create(s);await worker.runOnce()
    renderer.action=async()=>{throw Object.assign(new Error(s.root+'/private/font missing'),{code:'FONT_MISSING'})}
    const failed=await create(s,'failed-next');await worker.runOnce();const status=await s.exports.get(failed.id);assert.equal(status.status,'failed');assert.equal(status.error?.code,'FONT_MISSING');assert.ok(!JSON.stringify(status).includes(s.root));await assert.rejects(s.exports.file(failed.id,'png'))
    renderer.action=async p=>({...await rendered(p),width:999})
    const invalid=await create(s,'invalid-output');await worker.runOnce();assert.equal((await s.exports.get(invalid.id)).error?.code,'EXPORT_RENDER_INVALID')
    for(const format of ['../png','manifest.json','xml','content','project','png/../../private'])await assert.rejects(s.exports.file(first.id,format),(e:any)=>e.code==='EXPORT_FORMAT_NOT_FOUND')
    const stored=(await s.store.getNativeExport(first.id)).job,path=join(s.root,'artifacts',content.id,'r1','exports',first.id,stored.leaseToken!,stored.manifest!.files.png.filename)
    await writeFile(path,Buffer.from('corrupt'))
    await assert.rejects(s.exports.file(first.id,'png'),(e:any)=>e.code==='EXPORT_ARTIFACT_CORRUPT')
  }finally{await worker.close();await cleanup(s.root)}
})
