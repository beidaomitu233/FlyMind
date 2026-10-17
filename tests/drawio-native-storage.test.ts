import {test} from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {mkdtemp,rm,readFile,mkdir,writeFile,rename} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {spawn,type ChildProcess} from 'node:child_process'
import {ensureNativeRuntime} from '../server/runtime-instance/client'
import {once} from 'node:events'
import {createServer} from 'node:net'
import {request as httpRequest} from 'node:http'
import {randomUUID} from 'node:crypto'
import {DOMParser,XMLSerializer} from '@xmldom/xmldom'
import {DiagramStore,PROJECT_ROOT} from '../server/store'
import {NativeDiagramService} from '../server/application/native-diagrams'
import {nativePilotConfiguration} from '../server/native-pilot'
import {sampleFor} from '../src/drawing/core/samples'
import type {DiagramContent} from '../src/drawing/core/model'
import {drawioRenderSignature,patchDrawio} from '../src/drawing/engine/drawio'

const basic:DiagramContent={schemaVersion:1,id:'native-test',title:'独立原生测试',kind:'swimlane',nodes:[{id:'n1',label:'接收请求',kind:'start',laneId:'owner',phaseId:'intake'},{id:'n2',label:'处理完成',kind:'end',laneId:'owner',phaseId:'intake'}],edges:[{id:'e1',source:'n1',target:'n2'}],lanes:[{id:'owner',label:'办理人员'}],phases:[{id:'intake',label:'受理'}],groups:[]}
const clone=<T>(v:T):T=>structuredClone(v)
async function temporary(){const root=await mkdtemp(join(tmpdir(),'flymind-native-'));return root}
async function cleanup(root:string,closedSqlite=false){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-native-'));await rm(root,{recursive:true,force:true,...(closedSqlite?{maxRetries:6,retryDelay:100}:{})})}
function sql<T>(store:DiagramStore,fn:(db:Database.Database)=>T){const db=new Database(store.databasePath);try{return fn(db)}finally{db.close()}}
function counts(store:DiagramStore,id='native-test'){return sql(store,db=>({versions:(db.prepare('SELECT count(*) n FROM diagram_versions WHERE diagram_id=?').get(id) as any).n,requests:(db.prepare('SELECT count(*) n FROM native_mutation_requests WHERE diagram_id=?').get(id) as any).n}))}
function edit(xml:string,change:(doc:Document)=>void){const doc=new DOMParser().parseFromString(xml,'text/xml');change(doc);return new XMLSerializer().serializeToString(doc)}
function titleEdit(xml:string,label:string){return edit(xml,doc=>{const e=Array.from(doc.getElementsByTagName('*')).find(e=>e.getAttribute('fmId')==='n1'&&e.getAttribute('fmRole')==='main');assert.ok(e);e.setAttribute('label',label)})}
async function setup(){const root=await temporary(),store=new DiagramStore(root);await store.init();return {root,store,service:new NativeDiagramService(store,true)}}

test('mixed v2/v3 uses the same diagrams identity, metadata, group, history and legacy guards',async()=>{
  const {root,store,service}=await setup()
  try{
    const group=await store.createGroup('隔离测试分组')
    const legacy=sampleFor('flowchart');legacy.id='legacy-control';const old=await store.create(legacy)
    const native=await service.create({content:basic,workspaceGroupId:group.id,requestId:'create-1'})
    assert.equal(native.document.schemaVersion,3);assert.equal(native.revision,1)
    const mixed=await service.workspace();assert.ok(mixed.diagrams.some(r=>r.format===2));assert.ok(mixed.diagrams.some(r=>r.format===3))
    assert.equal(mixed.diagrams.find(r=>r.format===3)?.document.content.id,basic.id)
    const metadata=(await service.list()).find(r=>r.id===basic.id)!
    assert.equal(metadata.format,3);assert.equal(metadata.workspaceGroupId,group.id)
    assert.equal((await store.get(legacy.id)).revision,old.revision)
    for(const action of [()=>store.get(basic.id),()=>store.list(),()=>store.snapshot(),()=>store.update(basic.id,1,legacy),()=>store.patch(basic.id,1,[])])await assert.rejects(action(),(e:any)=>e.code==='NATIVE_DOCUMENT_REQUIRED')
    await assert.rejects(store.create(native.document),(e:any)=>e.code==='NATIVE_DOCUMENT_REQUIRED')
    const moved=await store.moveStoredToGroup(basic.id,null,group.id)
    assert.equal(moved.workspaceGroupId,null);assert.equal(moved.revision,1)
    assert.equal((await service.get(basic.id)).document.rendering.engine.xml,native.document.rendering.engine.xml)
    assert.deepEqual(counts(store),{versions:1,requests:1})
    const persisted=sql(store,db=>JSON.parse((db.prepare('SELECT document FROM diagrams WHERE id=?').get(basic.id) as any).document))
    assert.deepEqual(persisted,native.document)
    assert.equal(sql(store,db=>db.pragma('integrity_check',{simple:true})),'ok')
  }finally{await cleanup(root)}
})

test('native create/save replay returns the original snapshot and rejects changed payload across instances',async()=>{
  const {root,store,service}=await setup()
  try{
    const input={content:basic,requestId:'create-replay'},first=await service.create(input)
    assert.deepEqual(await new NativeDiagramService(new DiagramStore(root),true).create(clone(input)),first)
    await assert.rejects(service.create({...input,content:{...basic,title:'更改后的创建'}}),(e:any)=>e.code==='IDEMPOTENCY_KEY_REUSED')
    const request={xml:titleEdit(first.document.rendering.engine.xml,'办理请求'),expectedRevision:1,requestId:'save-replay'}
    const duplicate=await Promise.all([service,new NativeDiagramService(new DiagramStore(root),true)].map(s=>s.saveEditor(basic.id,clone(request))))
    const second=duplicate[0];assert.equal(second.revision,2);assert.deepEqual(duplicate[1],second)
    const third=await service.patchContent(basic.id,{expectedRevision:2,requestId:'patch-third',operations:[{op:'set_title',title:'后续修订'}]})
    assert.equal(third.revision,3)
    assert.deepEqual(await new NativeDiagramService(new DiagramStore(root),true).saveEditor(basic.id,request),second)
    await assert.rejects(service.saveEditor(basic.id,{...request,xml:titleEdit(request.xml,'其他办理动作')}),(e:any)=>e.code==='IDEMPOTENCY_KEY_REUSED')
    assert.equal((await service.get(basic.id)).revision,3)
    assert.deepEqual(counts(store),{versions:3,requests:3})
  }finally{await cleanup(root)}
})

test('CAS concurrency commits one complete native revision and rejects the competing base',async()=>{
  const {root,store,service}=await setup()
  try{
    const first=await service.create({content:basic,requestId:'cas-create'})
    const results=await Promise.allSettled(['甲动作','乙动作'].map((label,i)=>new NativeDiagramService(new DiagramStore(root),true).saveEditor(basic.id,{expectedRevision:1,requestId:'cas-'+i,xml:titleEdit(first.document.rendering.engine.xml,label)})))
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1)
    const failure=results.find(x=>x.status==='rejected') as PromiseRejectedResult
    assert.equal(failure.reason.status,409);assert.equal(failure.reason.currentRevision,2)
    assert.equal(failure.reason.code,'REVISION_CONFLICT')
    assert.equal((await service.get(basic.id)).revision,2)
    assert.deepEqual(counts(store),{versions:2,requests:2})
  }finally{await cleanup(root)}
})

test('native save normalization and view/serialization differences are no-ops while geometry and style are edits',async()=>{
  const {root,store,service}=await setup()
  try{
    const first=await service.create({content:basic,requestId:'noop-create'}),xml=first.document.rendering.engine.xml
    const saved=await service.saveEditor(basic.id,{xml,expectedRevision:1,requestId:'noop-first'})
    assert.deepEqual(saved,first)
    assert.deepEqual(await service.saveEditor(basic.id,{xml:saved.document.rendering.engine.xml,expectedRevision:1,requestId:'noop-again'}),first)
    const view=edit(xml,doc=>{const model=doc.getElementsByTagName('mxGraphModel')[0];model.setAttribute('dx','1800');model.setAttribute('dy','900');model.setAttribute('grid','0');model.setAttribute('page','0');model.setAttribute('pageWidth','900');doc.documentElement.setAttribute('modified','2026-10-16');const geometry=doc.getElementsByTagName('mxGeometry')[0];if(geometry.getAttribute('x')==='0')geometry.removeAttribute('x')})
    assert.equal(drawioRenderSignature(view),drawioRenderSignature(xml))
    assert.deepEqual(await service.saveEditor(basic.id,{xml:view,expectedRevision:1,requestId:'noop-view'}),first)
    const geometry=edit(xml,doc=>{const e=Array.from(doc.getElementsByTagName('*')).find(e=>e.getAttribute('fmId')==='n1'&&e.getAttribute('fmRole')==='main')!;e.getElementsByTagName('mxGeometry')[0].setAttribute('x','777')})
    const moved=await service.saveEditor(basic.id,{xml:geometry,expectedRevision:1,requestId:'real-geometry'})
    assert.equal(moved.revision,2);assert.equal(moved.document.rendering.engine.contentHash,first.document.rendering.engine.contentHash);assert.ok(moved.document.updatedAt>first.document.updatedAt)
    const styled=edit(moved.document.rendering.engine.xml,doc=>{const cell=doc.getElementsByTagName('mxCell')[2];cell.setAttribute('style',(cell.getAttribute('style')||'')+'strokeWidth=3;')})
    const changed=await service.saveEditor(basic.id,{xml:styled,expectedRevision:2,requestId:'real-style'})
    assert.equal(changed.revision,3);assert.deepEqual(counts(store),{versions:3,requests:6})
  }finally{await cleanup(root)}
})

test('store verifies no-op against the transaction current document and ignores caller boolean hints',async()=>{
  const {root,store,service}=await setup()
  try{
    const first=await service.create({content:basic,requestId:'untrusted-hint-create'})
    const engine=await patchDrawio(first.document,[{op:'set_title',title:'必须保留的真实变更'}])
    const candidate={...first.document,content:{...first.document.content,title:'必须保留的真实变更'},rendering:{...first.document.rendering,engine}}
    const result=await (store.commitNative as any)(basic.id,1,candidate,{requestId:'untrusted-true',requestHash:'a'.repeat(64),operation:'content-patch'},true)
    assert.equal(result.revision,2);assert.equal(result.document.content.title,'必须保留的真实变更')
    const repeated=await (store.commitNative as any)(basic.id,2,result.document,{requestId:'untrusted-false',requestHash:'b'.repeat(64),operation:'editor-save'},false)
    assert.equal(repeated.revision,2);assert.equal(repeated.document.updatedAt,result.document.updatedAt)
    assert.deepEqual(counts(store),{versions:2,requests:3})
  }finally{await cleanup(root)}
})

test('delete blocks delayed saves/retries and restore retains native XML, identity and group',async()=>{
  const {root,store,service}=await setup()
  try{
    const group=await store.createGroup('恢复测试'),first=await service.create({content:basic,workspaceGroupId:group.id,requestId:'delete-create'})
    const delayed={xml:titleEdit(first.document.rendering.engine.xml,'迟到更改'),expectedRevision:1,requestId:'delete-late'}
    const pending=store.commitNative(basic.id,1,first.document,{requestId:'in-flight-before-delete',requestHash:'c'.repeat(64),operation:'editor-save'})
    await store.delete(basic.id,1)
    await assert.rejects(pending,(e:any)=>e.status===410)
    await assert.rejects(service.saveEditor(basic.id,delayed),(e:any)=>e.status===410)
    await assert.rejects(service.create({content:basic,workspaceGroupId:group.id,requestId:'delete-create'}),(e:any)=>e.status===410)
    const item=(await store.listTrash()).find(x=>x.id===basic.id)!
    const restored=await store.restoreStored(item.id,item.revision,item.deletedAt)
    assert.equal(restored.format,3);assert.equal(restored.revision,2);assert.equal(restored.createdAt,first.createdAt);assert.equal(restored.workspaceGroupId,group.id)
    assert.equal((restored as typeof first).document.rendering.engine.xml,first.document.rendering.engine.xml)
    await assert.rejects(service.saveEditor(basic.id,delayed),(e:any)=>e.status===409&&e.currentRevision===2)
    await store.delete(basic.id,2);const again=(await store.listTrash()).find(x=>x.id===basic.id)!;await store.purge(basic.id,again.revision,again.deletedAt)
    await assert.rejects(service.create({content:basic,requestId:'after-purge'}),(e:any)=>e.status===410)
    assert.ok((await service.workspace()).deletedIds.includes(basic.id))
  }finally{await cleanup(root)}
})

test('invalid editor XML, visual operations and injected transaction failure leave no half-written records',async()=>{
  const {root,store,service}=await setup()
  try{
    const first=await service.create({content:basic,requestId:'fail-create'})
    await assert.rejects(service.saveEditor(basic.id,{xml:'<bad/>',expectedRevision:1,requestId:'bad-xml'}))
    await assert.rejects(service.patchContent(basic.id,{operations:[{op:'set_node_presentation',id:'n1',position:{x:10}}],expectedRevision:1,requestId:'visual-operation'}))
    await assert.rejects(service.saveEditor(basic.id,{xml:first.document.rendering.engine.xml,content:basic,expectedRevision:1,requestId:'mixed-content'}))
    assert.deepEqual(await service.get(basic.id),first);assert.deepEqual(counts(store),{versions:1,requests:1})
    sql(store,db=>db.exec("CREATE TRIGGER fail_native_request BEFORE INSERT ON native_mutation_requests BEGIN SELECT RAISE(ABORT,'injected request failure'); END"))
    await assert.rejects(service.create({content:{...basic,id:'failed-new-record'},requestId:'failed-create'}),/injected/)
    await assert.rejects(store.getStored('failed-new-record'),(e:any)=>e.status===404)
    const input={xml:titleEdit(first.document.rendering.engine.xml,'原子事务变更'),expectedRevision:1,requestId:'atomic-failure'}
    await assert.rejects(service.saveEditor(basic.id,input),/injected/)
    assert.deepEqual(await service.get(basic.id),first);assert.deepEqual(counts(store),{versions:1,requests:1})
    sql(store,db=>db.exec('DROP TRIGGER fail_native_request'))
    assert.equal((await service.saveEditor(basic.id,input)).revision,2)
    assert.deepEqual(counts(store),{versions:2,requests:2})
  }finally{await cleanup(root)}
})

test('manual PBS draft can enter native pilot without automatic v2 conversion',async()=>{
  const {root,store,service}=await setup()
  try{
    const content=JSON.parse(await readFile(new URL('./fixtures/drawio-baseline/pbs-main.content.json',import.meta.url),'utf8'))
    const first=await service.create({content,requestId:'pbs-create'})
    assert.deepEqual(first.document.content,content)
    assert.equal((await service.get(content.id)).document.content.nodes.length,23)
    assert.equal((await store.get('sample-swimlane')).document.schemaVersion,1)
    assert.equal(sql(store,db=>(db.prepare("SELECT json_extract(document,'$.schemaVersion') version FROM diagrams WHERE id='sample-swimlane'").get() as any).version),2)
  }finally{await cleanup(root)}
})

test('pilot defaults off and root protection checks explicit isolated paths before store initialization',async()=>{
  const root=await temporary()
  try{
    const config=nativePilotConfiguration({},root);assert.equal(config.enabled,false)
    assert.throws(()=>nativePilotConfiguration({FLYMIND_NATIVE_PILOT:'1'},root),/explicit/)
    for(const path of [join(root,'data'),join(root,'data','nested')])assert.throws(()=>nativePilotConfiguration({FLYMIND_NATIVE_PILOT:'1',FLYMIND_DATA_DIR:path},root),/isolated/)
    const a=nativePilotConfiguration({FLYMIND_NATIVE_PILOT:'1',FLYMIND_DATA_DIR:join(root,'pilot')},root)
    const b=nativePilotConfiguration({FLYMIND_NATIVE_PILOT:'1',FLYMIND_DATA_DIR:join(root,'pilot')},root)
    assert.equal(a.dataRootId,b.dataRootId);assert.match(a.dataRootId,/^[a-f0-9]{64}$/)
    const store=new DiagramStore(join(root,'disabled')),service=new NativeDiagramService(store)
    await assert.rejects(service.create({content:basic,requestId:'disabled'}),(e:any)=>e.code==='NATIVE_PILOT_DISABLED')
    await assert.rejects(readFile(store.databasePath),(e:any)=>e.code==='ENOENT')
    await store.init();assert.equal(store.nativeWorkspaceId(false),undefined,'disabled legacy workspace must not get a native identity write')
    const identityRoot=join(root,'identity'),firstStore=new DiagramStore(identityRoot);await firstStore.init()
    const firstService=new NativeDiagramService(firstStore,true)
    assert.equal(new NativeDiagramService(new DiagramStore(identityRoot),true).dataRootId,firstService.dataRootId)
    assert.ok(firstStore.nativeWorkspaceId(false))
    // Store methods close their synchronous SQLite handle before returning. Retire
    // the closed directory atomically; deleting its entries is not the replacement.
    const retired=join(root,'retired-identity')
    for(const path of [identityRoot,retired])assert.ok(resolve(path).startsWith(resolve(root)+sep))
    assert.notEqual(resolve(identityRoot),resolve(retired));await rename(identityRoot,retired)
    const replacement=new DiagramStore(identityRoot);await replacement.init()
    assert.notEqual(new NativeDiagramService(replacement,true).dataRootId,firstService.dataRootId,'same-path replacement must not reuse old draft identity')
  }finally{
    // Windows can briefly report ENOTEMPTY while removing already closed SQLite
    // files. Bounded retries still surface persistent failures; no error is ignored.
    await cleanup(root,true)
  }
})

test('workspace guard rechecks after asynchronous normalization and before receipt replay',async()=>{
  const {root,store,service}=await setup()
  const subtle=globalThis.crypto.subtle,original=subtle.digest.bind(subtle)
  try{
    const identity=service.dataRootId!,first=await service.create({content:basic,requestId:'identity-create'},identity)
    const request={xml:titleEdit(first.document.rendering.engine.xml,'异步期间变化'),expectedRevision:1,requestId:'identity-pending'}
    let release!:()=>void,entered!:()=>void
    const gate=new Promise<void>(r=>release=r),reached=new Promise<void>(r=>entered=r)
    let paused=false
    subtle.digest=(async(...args:Parameters<SubtleCrypto['digest']>)=>{if(!paused){paused=true;entered();await gate}return original(...args)}) as SubtleCrypto['digest']
    const pending=service.saveEditor(basic.id,request,identity)
    await reached
    sql(store,db=>db.prepare("UPDATE metadata SET value=? WHERE key='native_workspace_id'").run(randomUUID()))
    release()
    await assert.rejects(pending,(e:any)=>e.status===409&&e.code==='WORKSPACE_MISMATCH')
    assert.deepEqual(await service.get(basic.id),first);assert.deepEqual(counts(store),{versions:1,requests:1})
    await assert.rejects(service.create({content:basic,requestId:'identity-create'},identity),(e:any)=>e.code==='WORKSPACE_MISMATCH')
    assert.deepEqual(counts(store),{versions:1,requests:1})
  }finally{subtle.digest=original;await cleanup(root)}
})

async function freePort(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as any).port;await new Promise<void>(r=>server.close(()=>r()));return port}
async function runtime(root:string,enabled:boolean){
  const port=await freePort(),base=`http://127.0.0.1:${port}`
  const child=spawn(process.execPath,['server/start.mjs','--runtime'],{cwd:PROJECT_ROOT,env:{...process.env,FLYMIND_DATA_DIR:root,FLYMIND_PORT:String(port),FLYMIND_NATIVE_PILOT:enabled?'1':'0',FLYMIND_PRIVATE_RUNTIME_DIR:join(root,'.private-runtime')},stdio:['ignore','pipe','pipe'],windowsHide:true})
  let stderr='',healthError='';child.stderr.on('data',b=>{stderr+=b.toString()})
  for(let i=0;i<80;i++){if(child.exitCode!==null)throw new Error('Runtime failed: '+stderr);try{const response=await fetch(base+'/studio-api/health');if(response.ok){const connection=enabled?await ensureNativeRuntime({dataRoot:root,privateRuntimeRoot:join(root,'.private-runtime'),port,env:{FLYMIND_NATIVE_PILOT:'1'}}):undefined;return {child,base,connection}};healthError=`status=${response.status} body=${await response.text()}`}catch(e){healthError=String(e)}await new Promise(r=>setTimeout(r,100))}
  child.kill();throw new Error('Runtime health timeout: '+base+' '+healthError+' '+stderr)
}
async function stop(child:ChildProcess){if(child.exitCode===null&&child.signalCode===null){child.kill();await once(child,'exit')}}

test('isolated HTTP pilot exposes shared workspace, structured errors and public local assets only',async()=>{
  const root=await temporary();let child:ChildProcess|undefined
  try{
    const running=await runtime(root,true);child=running.child;const base=running.base
    let boundIdentity=''
    async function api(path:string,method='GET',body?:unknown,headers:Record<string,string>={}){return fetch(base+path,{method,headers:{...running.connection?.headers(),...(body?{'Content-Type':'application/json'}:{}),...(method==='POST'?{'X-FlyMind-DataRoot-Id':boundIdentity}:{}),...headers},body:body?JSON.stringify(body):undefined})}
    const health=await (await api('/studio-api/health')).json();assert.equal(health.capabilities.nativePilot,true);assert.match(health.dataRootId,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(health).includes(root))
    for(const header of ['', 'wrong-workspace']){const response=await api('/studio-api/native/diagrams','POST',{content:basic,requestId:'http-create'},{'X-FlyMind-DataRoot-Id':header});assert.equal(response.status,409);assert.equal((await response.json()).code,'WORKSPACE_MISMATCH')}
    boundIdentity=health.dataRootId
    const createdResponse=await api('/studio-api/native/diagrams','POST',{content:basic,requestId:'http-create'});assert.equal(createdResponse.status,201);const first=await createdResponse.json()
    const mixed=await (await api('/studio-api/native/workspace')).json();assert.equal(mixed.metadata.find((r:any)=>r.id===basic.id).format,3)
    const legacy=await api('/studio-api/diagrams');assert.equal(legacy.status,409);assert.equal((await legacy.json()).code,'NATIVE_DOCUMENT_REQUIRED')
    const oldPut=await api('/studio-api/diagrams/'+basic.id,'PUT',{expectedRevision:1,document:sampleFor('swimlane')});assert.equal(oldPut.status,409)
    const oldExport=await api('/studio-api/diagrams/'+basic.id+'/export','POST',{});assert.equal(oldExport.status,409)
    const stale=await api(`/studio-api/native/diagrams/${basic.id}/editor-save`,'POST',{expectedRevision:7,requestId:'http-conflict',xml:first.document.rendering.engine.xml});assert.equal(stale.status,409);const conflict=await stale.json();assert.equal(conflict.currentRevision,1);assert.equal(conflict.code,'REVISION_CONFLICT')
    assert.equal((await api('/studio-api/native/diagrams','POST',{content:{...basic,id:'origin-denied'},requestId:'http-origin'},{Origin:'https://example.com'})).status,403)
    const badHost=await new Promise<number|undefined>((resolve,reject)=>{const req=httpRequest(base+'/studio-api/health',{headers:{host:'untrusted.example'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end()})
    assert.equal(badHost,403)
    const asset=await api('/drawio/index.html');assert.equal(asset.status,200);assert.match(asset.headers.get('content-security-policy')||'',/connect-src 'self'/)
    for(const path of ['/drawio/WEB-INF/web.xml','/drawio/META-INF/MANIFEST.MF','/drawio/.secret','/drawio/%252e%252e/package.json'])assert.equal((await api(path)).status,404)
    await stop(child);child=undefined
    const off=await runtime(root,false);child=off.child
    const offHealth=await (await fetch(off.base+'/studio-api/health')).json();assert.equal(offHealth.dataRootId,health.dataRootId);assert.equal(offHealth.capabilities.nativePilot,false)
    const blocked=await fetch(off.base+'/studio-api/native/diagrams');assert.equal(blocked.status,404);assert.equal((await blocked.json()).code,'NATIVE_PILOT_DISABLED')
  }finally{if(child)await stop(child);await cleanup(root)}
})
