import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {ref,computed} from 'vue'
import {createPinia,setActivePinia} from 'pinia'
import {DiagramStore,StoreError} from '../server/store'
import {sampleFor} from '../src/drawing/core/samples'
import {copy,type DiagramDocument} from '../src/drawing/core/model'
import {extractContent} from '../src/drawing/core/layers'
import {sharedWorkspace} from '../src/drawing/services/shared'
import {useStudio} from '../src/drawing/state/studio'
import {byModifiedNewest,byCreationNewest} from '../src/drawing/core/metadata'
const KEY='flymind-drawing-studio-v1'
function environment(storage=new Map<string,string>()){
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>storage.get(k)||null,setItem:(k:string,v:string)=>storage.set(k,v)}})
  Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{hash:'#/',search:''}}})
  Object.defineProperty(globalThis,'document',{configurable:true,value:{activeElement:null}})
  return storage
}
function context(docs:DiagramDocument[]){const documents=ref(copy(docs)),activeId=ref(docs[0]?.id||'');return {documents,activeId,current:computed(()=>documents.value.find(d=>d.id===activeId.value)!),storageError:ref(''),notify:()=>{},reset:()=>{}}}
async function fixture(fn:(store:DiagramStore,storage:Map<string,string>,network:{offline:boolean;posts:number})=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'flymind-workspace-')),originalFetch=globalThis.fetch,storage=environment(),network={offline:false,posts:0},store=new DiagramStore(root)
  await store.init()
  globalThis.fetch=(async(url:string,options:any)=>{if(network.offline)throw new Error('offline');const path=url.replace('/studio-api',''),body=options.body?JSON.parse(options.body):{}
    try{if(path==='/workspace')return Response.json(await store.snapshot());if(path==='/trash')return Response.json(await store.listTrash());if(path.startsWith('/trash/')&&path.endsWith('/restore'))return Response.json(await store.restore(path.split('/')[2],body.expectedRevision,body.deletedAt));if(path==='/diagrams'&&options.method==='POST'){network.posts++;return Response.json(await store.create(body.document),{status:201})}
      const id=path.split('/')[2]?.split('?')[0];if(options.method==='DELETE'){await store.delete(id,Number(path.split('revision=')[1]));return new Response(null,{status:204})}
      if(options.method==='PUT')return Response.json(await store.update(id,body.expectedRevision,body.document))
      return Response.json(await store.get(id))
    }catch(e){return Response.json({error:(e as Error).message},{status:e instanceof StoreError?e.status:400})}
  }) as any
  try{await fn(store,storage,network)}finally{globalThis.fetch=originalFetch;await rm(root,{recursive:true,force:true})}
}
test('删除留档优先于活动文件：过期创建/修改及服务重启都不能复活，重复删除幂等',async()=>{
  await fixture(async store=>{
    const d=sampleFor('flowchart');d.id='delete-regression';const first=await store.create(d),bytes=JSON.stringify(first)
    await store.delete(d.id,1);await store.delete(d.id,1)
    assert.ok((await store.snapshot()).deletedIds.includes(d.id))
    // Simulate a crash after tombstone commit but before unlink, or an old client writing its file.
    await mkdir(join(store.root,'diagrams'),{recursive:true});await writeFile(store.path(d.id),bytes);const reboot=new DiagramStore(store.root);await reboot.init()
    await assert.rejects(reboot.get(d.id),(e:any)=>e.status===410)
    await assert.rejects(reboot.create(first.document),(e:any)=>e.status===410)
    await assert.rejects(reboot.update(d.id,1,d),(e:any)=>e.status===410)
    assert.ok(!(await reboot.list()).some(r=>r.document.id===d.id));assert.ok((await reboot.snapshot()).deletedIds.includes(d.id))
  })
})
test('其他标签删除后，旧标签保存只隔离修改；旧浏览器备份不上传，新建副本需主动恢复',async()=>{
  await fixture(async(store,storage,network)=>{
    const d=sampleFor('flowchart'),ctx=context([d]),client=sharedWorkspace(ctx);await client.initialize();assert.equal(client.shared.value,true)
    const record=await store.get(d.id);await store.delete(d.id,record.revision)
    ctx.current.value.nodes[0].label='旧页面仍在编辑';client.save(ctx.current.value);await client.retrySync()
    assert.ok(!ctx.documents.value.some(x=>x.id===d.id));assert.equal(client.recoveries.value.length,1);assert.equal(network.posts,0)
    storage.set(KEY,JSON.stringify({documents:[d],activeId:d.id}));storage.delete(KEY+'-shared-migrated')
    const reload=sharedWorkspace(context([d]));await reload.initialize();assert.equal(network.posts,0);assert.ok(!(await store.list()).some(x=>x.document.id===d.id))
    await reload.restoreRecovery(0);assert.equal(network.posts,1);assert.equal((await store.list()).filter(x=>x.document.title.endsWith('恢复副本')).length,1)
  })
})
test('断网删除跨刷新重试；全部删除后网页和服务重启均保持空工作区',async()=>{
  await fixture(async(store,storage,network)=>{
    const ctx=context([]),client=sharedWorkspace(ctx);await client.initialize();const docs=copy(ctx.documents.value)
    network.offline=true;for(const d of docs){client.remove(d.id);ctx.documents.value=ctx.documents.value.filter(x=>x.id!==d.id)}ctx.activeId.value='';storage.set(KEY,JSON.stringify({documents:[],activeId:''}));await client.retrySync()
    assert.ok(Object.keys(JSON.parse(storage.get(KEY+'-deletions')!)).length)
    network.offline=false;const reloadCtx=context([]),reload=sharedWorkspace(reloadCtx);await reload.initialize();assert.equal(reload.shared.value,true);assert.equal(reloadCtx.documents.value.length,0);assert.equal((await store.list()).length,0)
    await new DiagramStore(store.root).init();assert.equal((await store.list()).length,0)
    setActivePinia(createPinia());const studio=useStudio();assert.equal(studio.documents.length,0);assert.equal(studio.current,undefined);assert.equal(studio.canUndo,false)
    assert.equal(network.posts,0)
  })
})
test('修改时间/创建时间可切换，分组创建改名迁移删除不影响图形内容或渲染版本',async()=>{
  await fixture(async store=>{
    const d=sampleFor('flowchart');d.id='workspace';const r=await store.create(d),group=await store.createGroup('项目 A'),other=await store.createGroup('项目 B')
    await assert.rejects(store.createGroup('项目 A'),/已存在/)
    const assigned=await store.moveToGroup(d.id,group.id,null);assert.equal(assigned.revision,r.revision);assert.deepEqual(extractContent(assigned.document),extractContent(r.document));assert.deepEqual(assigned.document.presentation,r.document.presentation)
    assert.equal((await store.update(d.id,1,assigned.document)).workspaceGroupId,group.id)
    await assert.rejects(store.moveToGroup(d.id,other.id,null),/分组已改变/)
    const renamed=await store.updateGroup(group.id,1,'项目 C');await assert.rejects(store.deleteGroup(group.id,1),/已被修改/)
    await store.deleteGroup(group.id,renamed.revision);const after=await store.get(d.id);assert.equal(after.workspaceGroupId,null);assert.equal(after.revision,2)
    const into=sampleFor('mindmap');into.id='into';await store.create(into,other.id);assert.equal((await store.get('into')).workspaceGroupId,other.id)
    const a={id:'old',createdAt:100,updatedAt:300},b={id:'new',createdAt:200,updatedAt:200};assert.deepEqual([a,b].sort(byModifiedNewest).map(x=>x.id),['old','new']);assert.deepEqual([a,b].sort(byCreationNewest).map(x=>x.id),['new','old'])
  })
})
test('发起轮询后发生编辑，迟到的快照不能覆盖本地内容',async()=>{
  await fixture(async(store)=>{
    const ctx=context([]),client=sharedWorkspace(ctx);await client.initialize();const snapshot=await store.snapshot(),original=globalThis.fetch
    let release!:(r:Response)=>void;globalThis.fetch=(()=>new Promise<Response>(r=>release=r)) as any
    const polling=client.refreshRemote();ctx.current.value.title='轮询期间修改';client.markDirty(ctx.current.value.id);release(Response.json(snapshot));await polling
    assert.equal(ctx.current.value.title,'轮询期间修改');globalThis.fetch=original
  })
})
test('恢复回收站仅合入指定图形，不覆盖另一个未同步的人工编辑',async()=>{
  await fixture(async store=>{
    const d=sampleFor('flowchart');d.id='restore-only';await store.create(d);await store.delete(d.id,1)
    const ctx=context([]),client=sharedWorkspace(ctx);await client.initialize();const item=client.trash.value.find(t=>t.id===d.id)!;assert.ok(item)
    const other=ctx.current.value;other.title='尚未同步的修改';client.markDirty(other.id)
    assert.equal(await client.restoreDeleted(item),true);assert.equal(ctx.documents.value.find(d=>d.id===other.id)!.title,'尚未同步的修改');assert.equal(ctx.activeId.value,d.id);assert.equal(client.revisions.value[d.id],2);assert.ok(!client.trash.value.some(t=>t.id===d.id))
    await client.retrySync();assert.equal((await store.get(other.id)).document.title,'尚未同步的修改')
  })
})
