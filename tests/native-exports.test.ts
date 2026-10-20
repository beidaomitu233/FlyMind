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
import {EXPORT_FORMATS,type NativeExportRenderer} from '../server/exports/types'
import {sha256,exportSnapshotHash,prepareNativeArtifacts} from '../server/exports/artifacts'
import {exportBasename} from '../src/drawing/core/export-metadata'
import type {DrawingProjectV3} from '../src/drawing/engine/types'
import type {DiagramContent} from '../src/drawing/core/model'
import type {CloudReleaseManifest} from '../server/cloud/mcp-compat'

const content:DiagramContent={schemaVersion:1,id:'export-test',title:'导出隔离测试',kind:'swimlane',nodes:[{id:'a',kind:'start',label:'开始',laneId:'owner',phaseId:'work'},{id:'b',kind:'end',label:'完成',laneId:'owner',phaseId:'work'}],edges:[{id:'ab',source:'a',target:'b'}],lanes:[{id:'owner',label:'办理人员'}],phases:[{id:'work',label:'办理'}],groups:[]}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms))
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve}}
async function until(fn:()=>boolean,timeoutMs=10000){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){if(fn())return;await sleep(5)}assert.fail('expected checkpoint not reached within wall-clock allowance')}
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
  }finally{await first.close();await second.close();await cleanup(s.root)}
})

test('timeout ignores a renderer that resolves late, and explicit retry gets a new immutable job',async()=>{
  const s=await setup(),renderer=new Renderer(),gate=deferred<Awaited<ReturnType<NativeExportRenderer['render']>>>(),worker=new NativeExportWorker(s.store,renderer,{leaseMs:5000,timeoutMs:2000})
  try{
    renderer.action=()=>gate.promise;const original=await create(s),attempt=worker.runOnce();await until(()=>renderer.calls.length===1);await attempt;const failed=await s.exports.get(original.id);assert.equal(failed.status,'failed');assert.equal(failed.error?.code,'EXPORT_TIMEOUT');assert.equal(failed.files,undefined)
    gate.resolve(await rendered(s.record.document));await sleep(10);assert.equal((await s.exports.get(original.id)).status,'failed');await assert.rejects(s.exports.file(original.id,'png'))
    await s.diagrams.patchContent(content.id,{expectedRevision:1,requestId:'after-failure',operations:[{op:'set_title',title:'新业务修订'}]})
    const retry=await s.exports.retry(original.id,{requestId:'retry-failed'},s.identity);assert.notEqual(retry.id,original.id);assert.equal(retry.sourceJobId,original.id);assert.equal(retry.revision,1);assert.equal(retry.isCurrentRevision,false)
    const successRenderer=new Renderer(),retryWorker=new NativeExportWorker(s.store,successRenderer)
    try{await retryWorker.runOnce();assert.equal((await s.exports.get(retry.id)).status,'succeeded');assert.equal((await s.exports.retry(original.id,{requestId:'retry-failed'},s.identity)).id,retry.id)}finally{await retryWorker.close()}
  }finally{await worker.close();await cleanup(s.root)}
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

test('hard deadline covers stalled preparation and publication; late filesystem work stays unregistered',async()=>{
  for(const stage of ['prepare','publish','event-loop'] as const){
    const s=await setup(),renderer=new Renderer(),gate=deferred<void>();let entered=false,finished=false
    // Leave ample budget for validation under the default suite/build CPU load.
    // The injected stall starts only after the intended stage has been observed.
    const timeoutMs=2000
    const worker=new NativeExportWorker(s.store,renderer,{leaseMs:5000,timeoutMs,prepareArtifacts:async(...args)=>{
      if(stage==='prepare'){entered=true;await gate.promise}
      const prepared=await prepareNativeArtifacts(...args)
      if(stage==='event-loop'){entered=true;const until=Date.now()+timeoutMs+250;while(Date.now()<until){};finished=true;return prepared}
      if(stage==='publish')return {...prepared,publish:async()=>{entered=true;await gate.promise;await prepared.publish();finished=true}}
      finished=true;return prepared
    }})
    try{
      const job=await create(s),attempt=worker.runOnce();await until(()=>entered);await attempt
      assert.equal((await s.exports.get(job.id)).status,'failed');assert.equal((await s.exports.get(job.id)).error?.code,'EXPORT_TIMEOUT')
      await assert.rejects(s.exports.file(job.id,'png'),(e:any)=>e.code==='EXPORT_NOT_READY')
      const failed=(await s.store.getNativeExport(job.id)).job;assert.equal(failed.leaseOwner,undefined);assert.equal(failed.manifest,undefined)
      gate.resolve();await until(()=>finished);await sleep(5)
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
