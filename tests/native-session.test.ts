import {test} from 'node:test'
import assert from 'node:assert/strict'
import {NativeSaveSession,recoverNativeSession,type NativeSessionOptions} from '../src/drawing/state/native-session'
import {NativeClient} from '../src/drawing/services/native-client'
import {NativeApiError,type DraftRepository,type NativeDraft,type NativeDraftKey,type NativeDraftUpdate,type NativeHealth,type NativeRecord,type NativeSaveRequest,type NativeTransport} from '../src/drawing/services/native-types'
import {acceptsDraftGuard,draftKey,draftSessionKey,IndexedDbDraftRepository,NativeDraftError,validateNativeDraft} from '../src/drawing/services/native-drafts'

const clone=<T>(value:T):T=>structuredClone(value)
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
async function until(predicate:()=>boolean){for(let i=0;i<100;i++){if(predicate())return;await new Promise<void>(resolve=>setImmediate(resolve))}assert.fail('controlled task did not reach expected checkpoint')}
function record(id='diagram-1'):NativeRecord{return {format:3,revision:1,savedAt:100,createdAt:100,workspaceGroupId:null,document:{schemaVersion:3,content:{schemaVersion:1,id,title:'会话测试',kind:'swimlane',nodes:[{id:'n1',label:'办理事项',kind:'task',laneId:'owner'}],edges:[],lanes:[{id:'owner',label:'负责人'}],phases:[],groups:[]},rendering:{profile:{id:'swimlane-standard',version:'1'},preferences:{},engine:{name:'drawio',version:'31.5.3',adapterVersion:'1',xml:'XML-0',contentHash:'a'.repeat(64)}},createdAt:100,updatedAt:100}}}
class MemoryDraftRepository implements DraftRepository {
  records=new Map<string,NativeDraft>();leases=new Map<string,{key?:NativeDraftKey;guard:NativeDraftUpdate['guard']}>();writes:NativeDraftUpdate[]=[]
  fail=false;gate:ReturnType<typeof deferred<void>>|undefined
  async write(input:NativeDraftUpdate){
    const update=clone(input);this.writes.push(update)
    if(this.gate)await this.gate.promise
    if(this.fail)throw new NativeDraftError('模拟配额不足','DRAFT_QUOTA')
    const scope=JSON.stringify(draftSessionKey(update.key)),previous=this.leases.get(scope)
    if(!acceptsDraftGuard(previous?.guard,update.guard))return false
    if(previous?.key)this.records.delete(JSON.stringify(draftKey(previous.key)))
    if(update.draft)this.records.set(JSON.stringify(draftKey(update.key)),clone(update.draft))
    else this.records.delete(JSON.stringify(draftKey(update.key)))
    this.leases.set(scope,{key:update.draft?clone(update.key):undefined,guard:clone(update.guard)})
    return true
  }
  async get(key:NativeDraftKey){const d=this.records.get(JSON.stringify(draftKey(key)));return d?clone(d):undefined}
  async list(filter:{dataRootId?:string;diagramId?:string}={}){return [...this.records.values()].filter(d=>(!filter.dataRootId||d.dataRootId===filter.dataRootId)&&(!filter.diagramId||d.diagramId===filter.diagramId)).map(clone)}
}
class ControlledTransport implements NativeTransport {
  remote:NativeRecord;rootId='workspace-1';getFailure:NativeApiError|undefined;getCalls=0;healthCalls=0
  calls:Array<{id:string;request:NativeSaveRequest;deferred:ReturnType<typeof deferred<NativeRecord>>}>=[]
  committed=new Map<string,{request:NativeSaveRequest;record:NativeRecord}>()
  constructor(id='diagram-1'){this.remote=record(id)}
  async health():Promise<NativeHealth>{this.healthCalls++;return {name:'flymind',version:'test',storage:'sqlite',dataRootId:this.rootId,capabilities:{nativePilot:true,nativeDocumentWrites:true,mixedWorkspace:true}}}
  async get(id:string){this.getCalls++;if(this.getFailure)throw this.getFailure;assert.equal(id,this.remote.document.content.id);return clone(this.remote)}
  async saveEditor(id:string,request:NativeSaveRequest){const task=deferred<NativeRecord>();this.calls.push({id,request:clone(request),deferred:task});return task.promise}
  commit(index:number,noOp=false){
    const request=this.calls[index].request,cached=this.committed.get(request.requestId)
    if(cached){assert.deepEqual(cached.request,request);return clone(cached.record)}
    if(request.expectedRevision!==this.remote.revision)throw new NativeApiError('并发修改',409,'REVISION_CONFLICT',this.remote.revision)
    const next=clone(this.remote)
    if(!noOp){next.revision++;next.document.rendering.engine.xml=request.xml;next.savedAt++;next.document.updatedAt++}
    this.remote=next;this.committed.set(request.requestId,{request:clone(request),record:clone(next)})
    return clone(next)
  }
  ack(index:number,noOp=false){try{this.calls[index].deferred.resolve(this.commit(index,noOp))}catch(error){this.calls[index].deferred.reject(error)}}
  reject(index:number,error:unknown){this.calls[index].deferred.reject(error)}
}
async function setup(id='diagram-1',repo=new MemoryDraftRepository(),extra:Partial<NativeSessionOptions>={}){
  const transport=new ControlledTransport(id)
  const options:NativeSessionOptions={dataRootId:'workspace-1',diagramId:id,transport,drafts:repo,...extra}
  const session=await NativeSaveSession.open(options)
  return {session,transport,repo,options}
}

test('one request in flight coalesces B/C; A ack advances revision without loading A over C',async()=>{
  const acknowledgements:any[]=[]
  const {session,transport,repo}=await setup('diagram-1',undefined,{onAcknowledged:ack=>acknowledgements.push(ack)})
  await session.edit('XML-A');const flush=session.flush();await until(()=>transport.calls.length===1)
  assert.ok((await repo.list())[0].inflight,'exact A must be backed up before transport')
  await session.edit('XML-B');await session.edit('XML-C')
  assert.equal(transport.calls.length,1)
  transport.ack(0);await until(()=>transport.calls.length===2)
  assert.equal(session.snapshot().latestXML,'XML-C');assert.equal(session.snapshot().dirty,true)
  assert.deepEqual(transport.calls[1].request.xml,'XML-C');assert.equal(transport.calls[1].request.expectedRevision,2)
  assert.notEqual(transport.calls[1].request.requestId,transport.calls[0].request.requestId)
  const migrated=await repo.list();assert.equal(migrated.length,1);assert.equal(migrated[0].baseRevision,2)
  assert.equal(acknowledgements[0].hasNewerEdits,true)
  transport.ack(1);await flush
  assert.equal(session.snapshot().baseRevision,3);assert.equal(session.snapshot().latestXML,'XML-C');assert.equal(session.snapshot().dirty,false)
  assert.equal((await repo.list()).length,0)
})

test('response loss preserves exact A while C waits; retry uses the original key/revision/XML',async()=>{
  const {session,transport}=await setup()
  await session.edit('XML-A');const flush=session.flush();const failure=assert.rejects(flush,(e:any)=>e.code==='NETWORK_ERROR')
  await until(()=>transport.calls.length===1);transport.commit(0);await session.edit('XML-C')
  transport.reject(0,new NativeApiError('响应丢失',0,'NETWORK_ERROR'));await failure
  assert.equal(session.snapshot().status,'offline');assert.equal(session.snapshot().latestXML,'XML-C');assert.equal(session.snapshot().baseRevision,1)
  await assert.rejects(session.flush(),(e:any)=>e.code==='NETWORK_ERROR');assert.equal(transport.calls.length,1)
  const retry=session.retry();await until(()=>transport.calls.length===2)
  assert.deepEqual(transport.calls[1].request,transport.calls[0].request)
  transport.ack(1);await until(()=>transport.calls.length===3)
  assert.equal(transport.calls[2].request.xml,'XML-C');assert.equal(transport.calls[2].request.expectedRevision,2)
  transport.ack(2);await retry
  assert.equal(session.snapshot().baseRevision,3);assert.equal(session.snapshot().dirty,false)
})

test('409 keeps the latest draft and download payload without automatically overwriting remote',async()=>{
  const {session,transport,repo}=await setup()
  await session.edit('XML-A');const flush=session.flush(),failure=assert.rejects(flush,(e:any)=>e.status===409)
  await until(()=>transport.calls.length===1);await session.edit('XML-B');transport.remote.revision=2
  transport.reject(0,new NativeApiError('远端已修改',409,'REVISION_CONFLICT',2));await failure
  assert.equal(session.snapshot().status,'conflict');assert.equal(session.snapshot().latestXML,'XML-B');assert.equal(session.snapshot().baseRevision,1)
  assert.equal((await repo.list())[0].latestXML,'XML-B')
  assert.equal(JSON.parse(session.downloadRecovery().contents).draft.latestXML,'XML-B')
  await session.edit('XML-C');await assert.rejects(session.retry(),(e:any)=>e.code==='REVISION_CONFLICT')
  assert.equal(transport.calls.length,1);assert.equal(transport.remote.revision,2)
})

test('conflict retains a reverted local XML even when it equals the earlier acknowledged XML',async()=>{
  const {session,transport,repo}=await setup()
  await session.edit('XML-A');const running=session.flush(),failure=assert.rejects(running)
  await until(()=>transport.calls.length===1);await session.edit('XML-0');transport.remote.revision=2
  transport.reject(0,new NativeApiError('远端冲突',409,'REVISION_CONFLICT',2));await failure
  assert.equal(session.snapshot().dirty,false);assert.equal((await repo.list())[0].latestXML,'XML-0')
  await session.close();assert.equal((await repo.list())[0].latestXML,'XML-0')
})

test('404/410 preserve recoverable edits and cannot recreate the deleted original identity',async()=>{
  for(const status of [404,410]){
    const {session,transport,repo,options}=await setup()
    await session.edit('XML-A');const flush=session.flush(),failure=assert.rejects(flush,(e:any)=>e.status===status)
    await until(()=>transport.calls.length===1);transport.getFailure=new NativeApiError('已删除',status,'DELETED');transport.reject(0,transport.getFailure);await failure
    assert.equal(session.snapshot().status,'deleted');await session.edit('XML-copy-only')
    await assert.rejects(session.flush());await assert.rejects(session.retry());assert.equal(transport.calls.length,1)
    const recovered=await recoverNativeSession(options,(await repo.list())[0]);assert.equal(recovered.kind,'deleted')
    assert.ok('download' in recovered);assert.equal((await repo.list())[0].latestXML,'XML-copy-only')
  }
})

test('pilot-disabled 404 remains retryable and is not misreported as a deleted diagram',async()=>{
  const {session,transport}=await setup()
  await session.edit('XML-A');const running=session.flush(),failure=assert.rejects(running,(e:any)=>e.code==='NATIVE_PILOT_DISABLED')
  await until(()=>transport.calls.length===1);transport.reject(0,new NativeApiError('pilot关闭',404,'NATIVE_PILOT_DISABLED'));await failure
  assert.equal(session.snapshot().status,'offline');assert.ok(session.snapshot().inflight)
  const retry=session.retry();await until(()=>transport.calls.length===2);assert.deepEqual(transport.calls[1].request,transport.calls[0].request)
  transport.ack(1);await retry;assert.equal(session.snapshot().status,'ready')
})

test('400 projection failure retains the XML; corrected content uses the unchanged base and a new key',async()=>{
  const {session,transport,repo}=await setup()
  await session.edit('<bad/>');const flush=session.flush(),failure=assert.rejects(flush,(e:any)=>e.status===400)
  await until(()=>transport.calls.length===1);transport.reject(0,new NativeApiError('投影失败',400,'INVALID_BINDING'));await failure
  assert.equal(session.snapshot().status,'invalid');assert.equal((await repo.list())[0].latestXML,'<bad/>');assert.equal((await repo.list())[0].inflight,undefined)
  await session.edit('XML-fixed');const next=session.flush();await until(()=>transport.calls.length===2)
  assert.equal(transport.calls[1].request.expectedRevision,1);assert.notEqual(transport.calls[1].request.requestId,transport.calls[0].request.requestId)
  transport.ack(1);await next;assert.equal(session.snapshot().dirty,false)
})

test('a corrected B already waiting behind rejected A continues without discarding B',async()=>{
  const {session,transport}=await setup()
  await session.edit('XML-invalid-A');const flush=session.flush();await until(()=>transport.calls.length===1)
  await session.edit('XML-fixed-B');transport.reject(0,new NativeApiError('投影失败',400,'INVALID_BINDING'))
  await until(()=>transport.calls.length===2);assert.equal(transport.calls[1].request.xml,'XML-fixed-B');assert.equal(transport.calls[1].request.expectedRevision,1)
  transport.ack(1);await flush;assert.equal(session.snapshot().latestXML,'XML-fixed-B')
})

test('413 is a definite rejection; corrected XML uses a fresh request at the unchanged revision',async()=>{
  for(const queued of [false,true]){
    const {session,transport,repo}=await setup()
    await session.edit('XML-oversized-A');const running=session.flush()
    const rejected=queued?undefined:assert.rejects(running,(e:any)=>e.status===413)
    await until(()=>transport.calls.length===1)
    if(queued)await session.edit('XML-smaller-B')
    transport.reject(0,new NativeApiError('文档超过传输限制，请减少内容后保存',413,'PAYLOAD_TOO_LARGE'))
    if(!queued){await rejected;assert.equal(session.snapshot().status,'invalid');assert.equal((await repo.list())[0].inflight,undefined);assert.equal((await repo.list())[0].latestXML,'XML-oversized-A');await session.edit('XML-smaller-B')}
    const next=queued?running:session.flush()
    await until(()=>transport.calls.length===2)
    assert.equal(transport.calls[1].request.xml,'XML-smaller-B');assert.equal(transport.calls[1].request.expectedRevision,1);assert.notEqual(transport.calls[1].request.requestId,transport.calls[0].request.requestId)
    transport.ack(1);await next;assert.equal(session.snapshot().dirty,false)
  }
})

test('draft failure prevents network send and exposes an unbacked recovery download',async()=>{
  const {session,transport,repo}=await setup()
  await session.edit('XML-A');repo.fail=true
  await assert.rejects(session.flush(),(e:any)=>e.code==='DRAFT_QUOTA')
  assert.equal(transport.calls.length,0);assert.equal(session.snapshot().status,'draft-error');assert.equal(session.snapshot().backedUp,false)
  const download=JSON.parse(session.downloadRecovery().contents);assert.equal(download.draft.latestXML,'XML-A');assert.equal(download.draft.inflight.request.xml,'XML-A')
  repo.fail=false;const retry=session.retry();await until(()=>transport.calls.length===1)
  assert.deepEqual(transport.calls[0].request,download.draft.inflight.request)
  transport.ack(0);await retry;assert.equal(session.snapshot().backedUp,true)
})

test('known ack followed by draft cleanup failure retries storage without resending the committed request',async()=>{
  const {session,transport,repo}=await setup()
  await session.edit('XML-A');const running=session.flush(),failure=assert.rejects(running,(e:any)=>e.code==='DRAFT_QUOTA')
  await until(()=>transport.calls.length===1);repo.fail=true;transport.ack(0);await failure
  assert.equal(session.snapshot().baseRevision,2);assert.equal(session.snapshot().dirty,false);assert.equal(session.snapshot().backedUp,false)
  repo.fail=false;await session.retry()
  assert.equal(transport.calls.length,1);assert.equal((await repo.list()).length,0);assert.equal(session.snapshot().backedUp,true)
})

test('network send waits for persistence; close during that wait never starts the request',async()=>{
  const {session,transport,repo}=await setup()
  await session.edit('XML-A');repo.gate=deferred<void>()
  const flush=session.flush();await until(()=>repo.writes.length>=2);assert.equal(transport.calls.length,0)
  const closing=session.close();repo.gate.resolve();await closing;await flush
  assert.equal(transport.calls.length,0);assert.equal(session.snapshot().status,'closed');assert.ok((await repo.list())[0].inflight)
})

test('closed session late ack cannot clear a new diagram session or change its latest XML',async()=>{
  const repo=new MemoryDraftRepository(),old=await setup('diagram-1',repo)
  await old.session.edit('old-A');const oldFlush=old.session.flush();await until(()=>old.transport.calls.length===1)
  await old.session.edit('old-B');await old.session.close()
  const current=await setup('diagram-2',repo);await current.session.edit('current-C');const currentFlush=current.session.flush();await until(()=>current.transport.calls.length===1)
  old.transport.ack(0);await oldFlush
  assert.equal(old.session.snapshot().status,'closed');assert.equal(old.session.snapshot().baseRevision,1)
  assert.equal(current.session.snapshot().latestXML,'current-C');assert.equal(current.session.snapshot().dirty,true)
  assert.equal((await repo.list({diagramId:'diagram-2'})).length,1)
  current.transport.ack(0);await currentFlush
  assert.equal((await repo.list({diagramId:'diagram-1'}))[0].latestXML,'old-B')
})

test('refresh recovery checks identity/liveness and resolves pending A before sending latest C',async()=>{
  const {session,transport,repo,options}=await setup()
  await session.edit('XML-A');const running=session.flush();await until(()=>transport.calls.length===1)
  transport.commit(0);await session.edit('XML-C');await session.close();transport.reject(0,new NativeApiError('旧页面离线',0,'NETWORK_ERROR'));await running
  const saved=(await repo.list())[0],oldUpdate=clone(repo.writes.at(-1)!)
  const recovered=await recoverNativeSession(options,saved);assert.equal(recovered.kind,'pending-retry');assert.ok('session' in recovered)
  assert.equal(transport.calls.length,1,'recovery must not automatically replay')
  assert.equal(recovered.session.snapshot().latestXML,'XML-C');assert.ok(recovered.session.snapshot().generation>saved.generation)
  const retry=recovered.session.retry();await until(()=>transport.calls.length===2)
  assert.deepEqual(transport.calls[1].request,transport.calls[0].request)
  transport.ack(1);await until(()=>transport.calls.length===3)
  assert.equal(transport.calls[2].request.xml,'XML-C');assert.equal(transport.calls[2].request.expectedRevision,2)
  const forkId=recovered.session.sessionId
  assert.notEqual(forkId,saved.sessionId)
  let forkDrafts=(await repo.list()).filter(d=>d.sessionId===forkId);assert.equal(forkDrafts.length,1);assert.equal(forkDrafts[0].baseRevision,2)
  await repo.write(oldUpdate)
  const oldClear={key:oldUpdate.key,guard:oldUpdate.guard};await repo.write(oldClear)
  forkDrafts=(await repo.list()).filter(d=>d.sessionId===forkId);assert.equal(forkDrafts.length,1,'source session cannot clear its recovery fork')
  transport.ack(2);await retry;assert.equal((await repo.list()).filter(d=>d.sessionId===forkId).length,0)
})

test('concurrent recovery forks keep independent journals while retrying the same uncertain server request',async()=>{
  const {session,transport,repo,options}=await setup()
  await session.edit('XML-A');const original=session.flush();await until(()=>transport.calls.length===1)
  transport.commit(0);await session.edit('XML-C');await session.close();transport.reject(0,new NativeApiError('离线',0,'NETWORK_ERROR'));await original
  const source=(await repo.list())[0]
  const forks=await Promise.all([recoverNativeSession(options,source),recoverNativeSession(options,source)])
  assert.ok('session' in forks[0]&&'session' in forks[1])
  const left=forks[0].session,right=forks[1].session
  assert.notEqual(left.sessionId,right.sessionId);assert.notEqual(left.sessionId,source.sessionId);assert.notEqual(right.sessionId,source.sessionId)
  const leftRetry=left.retry();await until(()=>transport.calls.length===2)
  const rightRetry=right.retry(),rightFailure=assert.rejects(rightRetry,(e:any)=>e.code==='REVISION_CONFLICT');await until(()=>transport.calls.length===3)
  assert.deepEqual(transport.calls[1].request,transport.calls[0].request);assert.deepEqual(transport.calls[2].request,transport.calls[0].request)
  transport.ack(1);await until(()=>transport.calls.length===4);assert.equal(transport.calls[3].request.xml,'XML-C')
  transport.ack(3);await leftRetry
  assert.equal((await repo.list()).filter(d=>d.sessionId===left.sessionId).length,0)
  assert.equal((await repo.list()).filter(d=>d.sessionId===right.sessionId).length,1,'left ack cannot clear right pending journal')
  transport.ack(2);await until(()=>transport.calls.length===5);transport.ack(4);await rightFailure
  assert.equal(right.snapshot().status,'conflict');assert.equal(right.snapshot().latestXML,'XML-C')
  assert.equal((await repo.list()).filter(d=>d.sessionId===right.sessionId).length,1)
  assert.equal((await repo.list()).filter(d=>d.sessionId===source.sessionId).length,1,'recovery source is preserved')
  assert.equal(transport.remote.revision,3)
})

test('wrong workspace and revision mismatch return blocked recovery data without write-back',async()=>{
  const {session,transport,repo,options}=await setup()
  await session.edit('XML-draft');const saved=(await repo.list())[0]
  transport.remote.revision=2
  const conflict=await recoverNativeSession(options,saved);assert.equal(conflict.kind,'conflict');assert.equal(transport.calls.length,0)
  transport.rootId='replaced-workspace';const gets=transport.getCalls
  const wrong=await recoverNativeSession(options,saved);assert.equal(wrong.kind,'workspace-mismatch');assert.equal(transport.getCalls,gets);assert.equal(transport.calls.length,0)
  assert.equal((await repo.list())[0].latestXML,'XML-draft')
  await assert.rejects(NativeSaveSession.open(options),(e:any)=>e.code==='WORKSPACE_MISMATCH')
})

test('exact same XML and confirmed native no-op do not manufacture dirty state or extra saves',async()=>{
  const {session,transport,repo}=await setup()
  await session.edit('XML-0');await session.flush();assert.equal(session.snapshot().latestSeq,0);assert.equal(transport.calls.length,0)
  await session.edit('XML-view-only');const flush=session.flush();await until(()=>transport.calls.length===1);transport.ack(0,true);await flush
  assert.equal(session.snapshot().baseRevision,1);assert.equal(session.snapshot().latestXML,'XML-view-only');assert.equal(session.snapshot().dirty,false)
  await session.edit('XML-view-only');await session.flush();assert.equal(transport.calls.length,1);assert.equal((await repo.list()).length,0)
})

test('native client preserves status/code/currentRevision and treats incomplete responses as uncertain',async()=>{
  let response=()=>Promise.resolve(new Response(JSON.stringify({error:'冲突',code:'REVISION_CONFLICT',currentRevision:7}),{status:409}))
  const requests:any[]=[]
  const client=new NativeClient('http://127.0.0.1:5179',{expectedDataRootId:'workspace-1',fetch:(async(url,options)=>{requests.push({url,options});return response()}) as typeof fetch})
  await assert.rejects(client.saveEditor('diagram-1',{xml:'A',expectedRevision:1,requestId:'key-A'}),(e:any)=>e instanceof NativeApiError&&e.status===409&&e.code==='REVISION_CONFLICT'&&e.currentRevision===7&&!e.uncertain)
  assert.equal(requests[0].url,'http://127.0.0.1:5179/studio-api/native/diagrams/diagram-1/editor-save')
  assert.deepEqual(JSON.parse(requests[0].options.body),{xml:'A',expectedRevision:1,requestId:'key-A'})
  assert.equal(requests[0].options.headers['X-FlyMind-DataRoot-Id'],'workspace-1')
  const unbound=new NativeClient('',{fetch:(async()=>{throw new Error('must not send')}) as typeof fetch})
  await assert.rejects(unbound.saveEditor('diagram-1',{xml:'A',expectedRevision:1,requestId:'unbound'}),(e:any)=>e.code==='WORKSPACE_MISMATCH'&&e.status===409)
  response=()=>Promise.reject(new Error('connection lost'))
  await assert.rejects(client.saveEditor('diagram-1',{xml:'A',expectedRevision:1,requestId:'key-A'}),(e:any)=>e.status===0&&e.uncertain)
  response=()=>Promise.resolve(new Response('partial',{status:200}))
  await assert.rejects(client.get('diagram-1'),(e:any)=>e.code==='INVALID_RESPONSE'&&e.uncertain)
})

test('unavailable IndexedDB rejects explicitly and guard order prevents stale clears',async()=>{
  const repository=new IndexedDbDraftRepository('unavailable',undefined)
  await assert.rejects(repository.list(),(e:any)=>e.code==='DRAFT_UNAVAILABLE')
  assert.equal(acceptsDraftGuard({generation:2,journalVersion:10,latestSeq:3},{generation:1,journalVersion:99,latestSeq:99}),false)
  assert.equal(acceptsDraftGuard({generation:2,journalVersion:10,latestSeq:3},{generation:2,journalVersion:9,latestSeq:3}),false)
  assert.equal(acceptsDraftGuard({generation:2,journalVersion:10,latestSeq:3},{generation:2,journalVersion:11,latestSeq:2}),false)
})

test('canvas-only session binds top-level identity and acknowledges saves without fake business content',async()=>{
 let remote:import('../src/drawing/services/native-types').NativeDrawingRecord={format:3,revision:1,savedAt:100,createdAt:100,workspaceGroupId:null,document:{schemaVersion:3,mode:'canvas-only',id:'canvas-session',title:'仅画布',createdAt:100,updatedAt:100,rendering:{engine:{name:'drawio',version:'31.5.3',adapterVersion:'1',xml:'CANVAS-0',xmlHash:'a'.repeat(64)}}}}
 const transport:NativeTransport={expectedDataRootId:'workspace-1',async health(){return {name:'test',version:'1',storage:'sqlite',dataRootId:'workspace-1',capabilities:{nativePilot:true,nativeDocumentWrites:true,mixedWorkspace:true}}},async get(){return clone(remote)},async saveEditor(id,request){assert.equal(id,'canvas-session');assert.equal(request.expectedRevision,remote.revision);remote={...remote,revision:remote.revision+1,document:{...remote.document,rendering:{engine:{...remote.document.rendering.engine,xml:request.xml}}}};return clone(remote)}}
 const repo=new MemoryDraftRepository(),session=await NativeSaveSession.open({dataRootId:'workspace-1',diagramId:'canvas-session',transport,drafts:repo})
 await session.edit('CANVAS-A');await session.flush();assert.equal(session.snapshot().baseRevision,2);assert.equal(session.snapshot().dirty,false);assert.ok(!('content'in remote.document));assert.equal((await repo.list()).length,0);await session.close()
 await assert.rejects(NativeSaveSession.open({dataRootId:'workspace-1',diagramId:'wrong-id',transport,drafts:repo}),(e:any)=>e.code==='INVALID_RESPONSE')
})


test('explicit content result adopts revision only while clean and next editor save uses that revision',async()=>{
  const {session,transport}=await setup();const applied=clone(transport.remote);applied.revision=2;applied.document.rendering.engine.xml='XML-PROPERTY';transport.remote=applied
  await session.adoptCommitted(applied,1);assert.equal(session.snapshot().latestXML,'XML-PROPERTY');assert.equal(session.snapshot().baseRevision,2);assert.equal(session.snapshot().dirty,false)
  await session.edit('XML-AFTER');await assert.rejects(session.adoptCommitted(applied,2),e=>e instanceof NativeApiError&&e.code==='REVISION_CONFLICT');assert.equal(session.snapshot().latestXML,'XML-AFTER')
  const flush=session.flush();await until(()=>transport.calls.length===1);assert.equal(transport.calls[0].request.expectedRevision,2);transport.ack(0);await flush;assert.equal(session.snapshot().baseRevision,3)
})

test('cloud ACK rebase rechecks input arriving during async hook and saves only the merged latest edit',async()=>{
 const gate=deferred<void>(),calls:Array<{base:string;latest:string}>=[]
 const {session,transport,repo}=await setup('diagram-1',undefined,{reconcileRecord:async(base,remote,latest)=>{calls.push({base,latest});if(calls.length===1)await gate.promise;return remote.document.rendering.engine.xml.includes('|REMOTE')&&!latest.includes('|REMOTE')?latest+'|REMOTE':latest}})
 await session.edit('XML-A');const saving=session.flush();await until(()=>transport.calls.length===1);await session.edit('XML-B')
 const ack=transport.commit(0);ack.document.rendering.engine.xml+='|REMOTE';transport.remote=clone(ack);transport.calls[0].deferred.resolve(ack)
 await until(()=>calls.length===1);await session.edit('XML-C');assert.equal((await repo.list())[0].acknowledgedPending?.request.requestId,transport.calls[0].request.requestId)
 assert.equal(await session.receiveRemote(transport.remote),false,'receive must not interleave with an ACK rebase')
 gate.resolve();await until(()=>transport.calls.length===2)
 assert.deepEqual(calls.slice(0,2),[{base:'XML-A',latest:'XML-B'},{base:'XML-A',latest:'XML-C'}])
 assert.equal(transport.calls[1].request.xml,'XML-C|REMOTE');assert.equal(transport.calls[1].request.expectedRevision,2)
 transport.ack(1);await saving;assert.equal(session.snapshot().dirty,false);assert.equal((await repo.list()).length,0)
})

test('remote record rebases dirty local XML without submitting, and busy inflight remote application is deferred',async()=>{
 const {session,transport}=await setup('diagram-1',undefined,{reconcileRecord:async(_base,remote,latest)=>latest==='XML-0'?remote.document.rendering.engine.xml:latest.includes('|REMOTE')?latest:latest+'|REMOTE'})
 await session.edit('XML-B');transport.remote.revision=2;transport.remote.document.rendering.engine.xml='XML-0|REMOTE'
 assert.equal(await session.receiveRemote(clone(transport.remote)),true);assert.equal(session.snapshot().baseRevision,2);assert.equal(session.snapshot().latestXML,'XML-B|REMOTE');assert.equal(session.snapshot().dirty,true);assert.equal(transport.calls.length,0)
 const flush=session.flush();await until(()=>transport.calls.length===1);assert.equal(await session.receiveRemote(transport.remote),false);assert.equal(transport.calls[0].request.expectedRevision,2);transport.ack(0);await flush
 assert.equal(session.snapshot().dirty,false)
})

test('failed ACK rebase retains known commit evidence across recovery and never retries the acknowledged request',async()=>{
 let blocked=true
 const {session,transport,repo,options}=await setup('diagram-1',undefined,{reconcileRecord:async(_base,remote,latest)=>{if(blocked)throw new NativeApiError('同字段冲突',409,'COLLABORATION_CONFLICT');return latest==='XML-A'?remote.document.rendering.engine.xml:latest.includes('|REMOTE')?latest:latest+'|REMOTE'}})
 await session.edit('XML-A');const flush=session.flush(),failed=assert.rejects(flush,(e:any)=>e.code==='COLLABORATION_CONFLICT');await until(()=>transport.calls.length===1)
 const ack=transport.commit(0);ack.document.rendering.engine.xml='XML-A|REMOTE';transport.remote=clone(ack);transport.calls[0].deferred.resolve(ack);await failed
 assert.equal(session.snapshot().baseRevision,2);assert.equal(session.snapshot().inflight,undefined);assert.equal(session.snapshot().status,'conflict');await session.edit('XML-C')
 const draft=(await repo.list())[0];validateNativeDraft(draft);assert.equal(draft.acknowledgedXML,'XML-A|REMOTE');assert.equal(draft.acknowledgedPending?.request.xml,'XML-A');assert.equal(draft.latestXML,'XML-C');assert.equal(draft.reconcileBlocked,true)
 await assert.rejects(session.retry());await assert.rejects(session.flush());assert.equal(transport.calls.length,1);await session.close()
 const recovered=await recoverNativeSession(options,draft);assert.equal(recovered.kind,'ready');assert.ok('session'in recovered)
 await assert.rejects(recovered.session.flush());assert.equal(transport.calls.length,1)
 blocked=false;await recovered.session.receiveRemote(transport.remote);const resumed=recovered.session.flush();await until(()=>transport.calls.length===2)
 assert.equal(transport.calls[1].request.xml,'XML-C|REMOTE');assert.equal(transport.calls[1].request.expectedRevision,2);assert.notEqual(transport.calls[1].request.requestId,transport.calls[0].request.requestId);transport.ack(1);await resumed
})

test('cloud offline draft without pending request can activate and explicitly rebase an older baseline; local remains strict',async()=>{
 const {session,transport,repo,options}=await setup('diagram-1',undefined,{reconcileRecord:async(_base,_record,latest)=>latest+'|REMOTE'})
 await session.edit('XML-LOCAL');const draft=(await repo.list())[0];transport.remote.revision=2;transport.remote.document.rendering.engine.xml='XML-REMOTE'
 const local=await recoverNativeSession({...options,reconcileRecord:undefined},draft);assert.equal(local.kind,'conflict')
 const cloud=await recoverNativeSession(options,draft);assert.equal(cloud.kind,'ready');assert.ok('session'in cloud);assert.equal(cloud.session.snapshot().baseRevision,1)
 await cloud.session.receiveRemote(transport.remote);assert.equal(cloud.session.snapshot().latestXML,'XML-LOCAL|REMOTE');assert.equal(cloud.session.snapshot().baseRevision,2);assert.equal(transport.calls.length,0)
})

test('cloud no-op compares only native state; viewport/file timestamps do not create a save',async()=>{
 const xml='<mxfile modified="a"><diagram id="p"><mxGraphModel dx="1"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'
 const transport=new ControlledTransport();transport.remote.document.rendering.engine.xml=xml
 const session=await NativeSaveSession.open({dataRootId:'workspace-1',diagramId:'diagram-1',transport,drafts:new MemoryDraftRepository(),reconcileRecord:async(_base,_record,latest)=>latest})
 await session.edit(xml.replace('modified="a"','modified="b"').replace('dx="1"','dx="999"'));assert.equal(session.snapshot().dirty,false);await session.flush();assert.equal(transport.calls.length,0)
 await session.edit(xml.replace('id="p"','id="p" name="changed"'));assert.equal(session.snapshot().dirty,true)
})

test('blocked ACK draft validation rejects ambiguous uncertain and confirmed request states',async()=>{
 const {session,repo}=await setup();await session.edit('XML-A');const draft=(await repo.list())[0]
 const pending={seq:draft.latestSeq,request:{xml:'XML-A',expectedRevision:1,requestId:'known'}}
 assert.throws(()=>validateNativeDraft({...draft,acknowledgedPending:pending}),NativeDraftError)
 assert.throws(()=>validateNativeDraft({...draft,reconcileBlocked:true,inflight:pending}),NativeDraftError)
 assert.throws(()=>validateNativeDraft({...draft,reconcileBlocked:'true'}),NativeDraftError)
})

test('closing during cloud ACK hook retains the confirmed revision and newer input without late submission',async()=>{
 const gate=deferred<void>();let entered=false
 const {session,transport,repo,options}=await setup('diagram-1',undefined,{reconcileRecord:async(_base,_remote,latest)=>{entered=true;await gate.promise;return latest}})
 await session.edit('XML-A');const saving=session.flush();await until(()=>transport.calls.length===1);transport.ack(0);await until(()=>entered)
 await session.edit('XML-B');await session.close();gate.resolve();await saving
 assert.equal(transport.calls.length,1);assert.equal(session.snapshot().status,'closed');assert.equal(session.snapshot().baseRevision,2)
 const saved=(await repo.list())[0];assert.equal(saved.latestXML,'XML-B');assert.equal(saved.acknowledgedPending?.request.xml,'XML-A')
 const local=await recoverNativeSession({...options,reconcileRecord:undefined},saved);assert.equal(local.kind,'conflict')
})

test('draft failure immediately after known cloud ACK blocks new sends until explicit successful rebase',async()=>{
 const {session,transport,repo}=await setup('diagram-1',undefined,{reconcileRecord:async(_base,_remote,latest)=>latest})
 await session.edit('XML-A');const saving=session.flush(),failed=assert.rejects(saving,(e:any)=>e.code==='DRAFT_QUOTA');await until(()=>transport.calls.length===1)
 repo.fail=true;transport.ack(0);await failed;assert.equal(session.snapshot().baseRevision,2);assert.equal(session.snapshot().inflight,undefined)
 repo.fail=false;await session.edit('XML-B');await assert.rejects(session.flush());await assert.rejects(session.retry());assert.equal(transport.calls.length,1)
 const download=JSON.parse(session.downloadRecovery().contents).draft;assert.equal(download.acknowledgedPending.request.xml,'XML-A');assert.equal(download.reconcileBlocked,true)
 await session.receiveRemote(transport.remote);const resumed=session.flush();await until(()=>transport.calls.length===2);assert.equal(transport.calls[1].request.expectedRevision,2);assert.equal(transport.calls[1].request.xml,'XML-B');transport.ack(1);await resumed
})

test('flush requested during remote rebase waits for that boundary then submits the preserved local delta',async()=>{
 const gate=deferred<void>();let entered=false
 const {session,transport}=await setup('diagram-1',undefined,{reconcileRecord:async(_base,_record,latest)=>{entered=true;await gate.promise;return latest}})
 await session.edit('XML-LOCAL');transport.remote.revision=2;transport.remote.document.rendering.engine.xml='XML-REMOTE'
 const receive=session.receiveRemote(transport.remote);await until(()=>entered);const saving=session.flush();assert.equal(transport.calls.length,0)
 gate.resolve();assert.equal(await receive,true);await until(()=>transport.calls.length===1);assert.equal(transport.calls[0].request.xml,'XML-LOCAL');assert.equal(transport.calls[0].request.expectedRevision,2);transport.ack(0);await saving
 assert.equal(session.snapshot().dirty,false)
})
