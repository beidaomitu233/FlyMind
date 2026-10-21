import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {DiagramStore} from '../server/store'
import {NativeDiagramService} from '../server/application/native-diagrams'
import {NativeImportService} from '../server/application/native-imports'
import {businessContent} from './fixtures/native-business'

async function setup(){const root=await mkdtemp(join(tmpdir(),'flymind-task-groups-')),store=new DiagramStore(root);await store.init();const service=new NativeDiagramService(store,true);return {root,store,service,identity:service.dataRootId!}}
async function cleanup(root:string){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-task-groups-'));await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:100})}

test('AI creation requires task context and atomically reuses one task group across retries and concurrent diagrams',async()=>{
 const s=await setup();try{
  const content=businessContent('flowchart','task-first'),before=(await s.store.listGroups()).length
  await assert.rejects(s.service.createAI({content,requestId:'missing-context'},s.identity),(e:any)=>e.code==='TASK_GROUP_REQUIRED')
  assert.equal((await s.store.listGroups()).length,before)
  const input={content,requestId:'first',taskName:'客户反馈处理'}
  const [first,replay]=await Promise.all([s.service.createAI(input,s.identity),s.service.createAI(input,s.identity)])
  assert.deepEqual(first,replay);assert.ok(first.workspaceGroupId)
  const other=await Promise.all(['second','third'].map(id=>s.service.createAI({content:businessContent('flowchart',id),requestId:id,taskName:' 客户反馈处理 '},s.identity)))
  assert.ok(other.every(r=>r.workspaceGroupId===first.workspaceGroupId));assert.equal((await s.store.listGroups()).length,before+1)
  await assert.rejects(s.service.createAI({...input,taskName:'另一任务'},s.identity),(e:any)=>e.code==='IDEMPOTENCY_KEY_REUSED')
  const manual=await s.service.create({content:businessContent('flowchart','manual-task'),requestId:'manual',taskName:'客户反馈处理'},s.identity)
  assert.equal(manual.workspaceGroupId,first.workspaceGroupId)
  // A duplicate diagram fails after group selection; the transaction must undo its new group too.
  await assert.rejects(s.service.createAI({...input,requestId:'duplicate-id',taskName:'失败不得留空组'},s.identity))
  assert.equal((await s.store.listGroups()).length,before+1)
  const original=(await s.store.listGroups()).find(g=>g.id===first.workspaceGroupId)!
  await s.store.updateGroup(original.id,original.revision,'已改为另一任务',s.identity)
  const fresh=await s.service.createAI({content:businessContent('flowchart','original-name-again'),requestId:'original-name-again',taskName:'客户反馈处理'},s.identity)
  assert.notEqual(fresh.workspaceGroupId,original.id)
  const subsequent=await s.service.createAI({content:businessContent('flowchart','same-task-again'),requestId:'same-task-again',taskName:'客户反馈处理'},s.identity)
  assert.equal(subsequent.workspaceGroupId,fresh.workspaceGroupId)
  await assert.rejects(s.service.createAI({content:businessContent('flowchart','expanded-name'),requestId:'expanded-name',taskName:'㍿'.repeat(21)},s.identity),/1–80/)
 }finally{await cleanup(s.root)}
})

test('existing task groups, group tools and clone/import targets remain explicit; old ungrouped diagrams are untouched',async()=>{
 const s=await setup();try{
  const group=await s.store.createGroup('发布任务',s.identity),again=await s.service.organize('create-group',undefined,{name:'发布任务',reuseExisting:true},s.identity)
  assert.equal(again.group.id,group.id)
  const old=await s.service.create({content:businessContent('flowchart','old-ungrouped'),requestId:'old'},s.identity)
  assert.equal(old.workspaceGroupId,null)
  const first=await s.service.createAI({content:businessContent('flowchart','existing-task'),requestId:'existing',taskName:'发布任务'},s.identity)
  assert.equal(first.workspaceGroupId,group.id)
  const explicit=await s.service.createAI({content:businessContent('flowchart','explicit-task'),requestId:'explicit',workspaceGroupId:group.id},s.identity)
  assert.equal(explicit.workspaceGroupId,group.id)
  const imports=new NativeImportService(s.service),copy=await imports.import({format:'project',data:Buffer.from(JSON.stringify(first.document)).toString('base64'),requestId:'copy',workspaceGroupId:group.id},s.identity)
  assert.equal(copy.workspaceGroupId,group.id);assert.equal((await s.service.get(old.document.content.id)).workspaceGroupId,null)
  assert.deepEqual(first.document.content.groups,[])
 }finally{await cleanup(s.root)}
})
