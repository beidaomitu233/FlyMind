import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import Database from 'better-sqlite3'
import sharp from 'sharp'
import {DiagramStore,StoreError} from '../server/store'
import {NativeDiagramService} from '../server/application/native-diagrams'
import {NativeExportService} from '../server/application/native-exports'
import {NativeExportWorker} from '../server/exports/worker'
import type {NativeExportRenderer} from '../server/exports/types'
import {businessContent} from './fixtures/native-business'

const diagramId='admission-fixture'
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>resolve=yes);return {promise,resolve}}
function sql<T>(store:DiagramStore,fn:(db:Database.Database)=>T){const db=new Database(store.databasePath);try{return fn(db)}finally{db.close()}}
const count=(store:DiagramStore)=>sql(store,db=>(db.prepare('SELECT count(*) n FROM native_export_jobs').get() as {n:number}).n)
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'flymind-local-admission-')),store=new DiagramStore(root);await store.init({seedExamples:false})
 const diagrams=new NativeDiagramService(store,true);await diagrams.create({content:businessContent('flowchart',diagramId),requestId:'fixture-create'})
 return {root,store,identity:diagrams.dataRootId!}
}
async function cleanup(root:string){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-local-admission-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
const normal=(service:NativeExportService,identity:string,requestId:string,options?:unknown)=>service.create(diagramId,{expectedRevision:1,requestId,...(options===undefined?{}:{options})},identity)
const historical=(service:NativeExportService,identity:string,requestId:string)=>service.createSnapshot(diagramId,{revision:1,requestId},identity)
async function failSource(store:DiagramStore,service:NativeExportService,identity:string){
 const source=await normal(service,identity,'source'),job=await store.claimNativeExport('fixture-owner',60000)
 assert.equal(job?.id,source.id);await store.failNativeExport(source.id,'fixture-owner',job!.leaseToken!,{code:'FIXTURE',message:'fixture failure'});return source
}

test('local cleanup failure rejects new jobs but preserves all three replays and reads',async()=>{
 const s=await setup();let worker!:NativeExportWorker
 const service=new NativeExportService(s.store,true,undefined,()=>{if(worker.cleanupFailure)throw worker.cleanupFailure})
 const renderer:NativeExportRenderer={async render(project){return {png:await sharp({create:{width:20,height:12,channels:4,background:'#fff'}}).png().toBuffer(),svg:'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="12"/>',width:20,height:12,scale:1,nativeXML:project.rendering.engine.xml,runtime:{},timings:{totalMs:1,browserStartMs:0,loadMs:0,exportMs:1},warnings:[]}},async close(){}}
 worker=new NativeExportWorker(s.store,renderer)
 try{
  const done=await normal(service,s.identity,'done');await worker.runOnce();assert.equal((await service.get(done.id)).status,'succeeded')
  const source=await failSource(s.store,service,s.identity)
  const first=await normal(service,s.identity,'existing-create'),history=await historical(service,s.identity,'existing-history'),retry=await service.retry(source.id,{requestId:'existing-retry'},s.identity)
  renderer.renderTracked=()=>({result:Promise.reject(Object.assign(Error('fixture render'),{code:'FIXTURE_RENDER'})),quiescence:Promise.reject(Error('fixture cleanup'))})
  await assert.rejects(worker.runOnce(),(e:any)=>e.code==='EXPORT_CLEANUP_UNCERTAIN');assert.equal(worker.cleanupFailure?.code,'EXPORT_CLEANUP_UNCERTAIN')
  const before=count(s.store)
  for(const request of [()=>normal(service,s.identity,'new-create'),()=>historical(service,s.identity,'new-history'),()=>service.retry(source.id,{requestId:'new-retry'},s.identity)])await assert.rejects(request(),(e:any)=>e.code==='EXPORT_CLEANUP_UNCERTAIN'&&e.status===503)
  assert.equal(count(s.store),before)
  assert.equal((await normal(service,s.identity,'existing-create')).id,first.id);assert.equal((await historical(service,s.identity,'existing-history')).id,history.id);assert.equal((await service.retry(source.id,{requestId:'existing-retry'},s.identity)).id,retry.id)
  await assert.rejects(normal(service,s.identity,'existing-create',{scale:2}),(e:any)=>e.code==='IDEMPOTENCY_KEY_REUSED')
  await assert.rejects(normal(service,'wrong-root','existing-create'),(e:any)=>e.code==='WORKSPACE_MISMATCH')
  sql(s.store,db=>{db.exec('CREATE TABLE restored_request_barriers(scope TEXT NOT NULL,request_id TEXT NOT NULL,restore_id TEXT NOT NULL,PRIMARY KEY(scope,request_id))');db.prepare('INSERT INTO restored_request_barriers VALUES(?,?,?)').run('export','blocked-epoch','fixture')})
  await assert.rejects(normal(service,s.identity,'blocked-epoch'),(e:any)=>e.code==='REQUEST_EPOCH_CHANGED')
  assert.equal((await service.get(done.id)).status,'succeeded');assert.equal((await service.snapshot(done.id)).revision,1);assert.equal((await service.file(done.id,'png')).buffer.length>0,true);assert.ok((await service.delivery(done.id)).files.png)
  assert.equal(count(s.store),before)
 }finally{await worker.close().catch(()=>{});await cleanup(s.root)}
})

test('fault appearing before the transaction rejects all three new request types',async()=>{
 const s=await setup(),unblocked=deferred<void>();let fault=false,entered=0
 const service=new NativeExportService(s.store,true,undefined,()=>{if(fault)throw new StoreError('fixture fault',503,undefined,'EXPORT_CLEANUP_UNCERTAIN')})
 try{
  const source=await failSource(s.store,service,s.identity),before=count(s.store),original=s.store.enqueueNativeExport.bind(s.store)
  s.store.enqueueNativeExport=async(...args)=>{entered++;await unblocked.promise;return original(...args)}
  const pending=[normal(service,s.identity,'racing-create'),historical(service,s.identity,'racing-history'),service.retry(source.id,{requestId:'racing-retry'},s.identity)]
  const deadline=Date.now()+5000;while(entered<3&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));assert.equal(entered,3)
  fault=true;unblocked.resolve();const results=await Promise.allSettled(pending)
  for(const result of results){assert.equal(result.status,'rejected');if(result.status==='rejected')assert.equal(result.reason.code,'EXPORT_CLEANUP_UNCERTAIN')}
  assert.equal(count(s.store),before)
 }finally{unblocked.resolve();await cleanup(s.root)}
})

test('transaction replay wins if a concurrent identical request committed before fault',async()=>{
 const s=await setup(),unblocked=deferred<void>();let fault=false,entered=false
 const service=new NativeExportService(s.store,true,undefined,()=>{if(fault)throw new StoreError('fixture fault',503,undefined,'EXPORT_CLEANUP_UNCERTAIN')})
 try{
  const original=s.store.enqueueNativeExport.bind(s.store);let calls=0
  s.store.enqueueNativeExport=async(...args)=>{calls++;if(calls===1){entered=true;await unblocked.promise}return original(...args)}
  const first=normal(service,s.identity,'same-request');const deadline=Date.now()+5000;while(!entered&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));assert.equal(entered,true)
  const second=await normal(service,s.identity,'same-request');fault=true;unblocked.resolve()
  assert.equal((await first).id,second.id);assert.equal(count(s.store),1)
 }finally{unblocked.resolve();await cleanup(s.root)}
})
