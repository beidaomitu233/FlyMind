import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import Database from 'better-sqlite3'
import {DiagramStore} from '../server/store'
import {NativeDiagramService} from '../server/application/native-diagrams'
import {NativeImportService} from '../server/application/native-imports'
import {withActivityActor,currentActivityActor,type ActivityActor} from '../server/activity/context'
import {patchDrawio} from '../src/drawing/engine/drawio'
import type {DiagramContent} from '../src/drawing/core/model'
const basic:DiagramContent={schemaVersion:1,id:'activity-source',kind:'swimlane',title:'申请办理',nodes:[{id:'a',kind:'start',label:'开始',laneId:'l',phaseId:'p'},{id:'b',kind:'task',label:'办理申请',laneId:'l',phaseId:'p'},{id:'c',kind:'end',label:'完成',laneId:'l',phaseId:'p'}],edges:[{id:'ab',source:'a',target:'b'},{id:'bc',source:'b',target:'c'}],lanes:[{id:'l',label:'办理人'}],phases:[{id:'p',label:'办理'}],groups:[]}
async function setup(){const root=await mkdtemp(join(tmpdir(),'flymind-activity-')),store=new DiagramStore(root);await store.init({seedExamples:false});const service=new NativeDiagramService(store,true);return {root,store,service,identity:service.dataRootId!}}
async function cleanup(root:string){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-activity-'));await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:100})}
function actor(userId:string,root:string,channel:'web'|'mcp'='web'):ActivityActor{return {userId,userDisplayName:userId==='alice'?'Alice':'Bob',teamId:'team1',channel,dataRootId:root,...(channel==='mcp'?{clientId:'codex'}:{})}}

test('actor scopes remain isolated across async work and events omit request secrets and document text',async()=>{
 let resume!:()=>void
 const a=withActivityActor({userId:'alice',teamId:'t',channel:'web'},async()=>{await new Promise<void>(r=>{resume=r});return currentActivityActor().userId})
 assert.equal(await withActivityActor({userId:'bob',teamId:'t',channel:'mcp'},async()=>{await Promise.resolve();return currentActivityActor().userId}),'bob');resume();assert.equal(await a,'alice');assert.equal(currentActivityActor().channel,'system')
 const s=await setup();try{await withActivityActor({...actor('alice',s.identity),'requestId':'opaque-request-id'},()=>s.service.create({content:basic,requestId:'create'},s.identity));const event=(await s.store.listActivity({},s.identity)).items[0]
 assert.equal(event.actor.userId,'alice');assert.equal(event.actor.teamId,'team1');assert.equal(event.dataRootId,s.identity);assert.equal(event.toRevision,1);assert.equal(event.summary.nodes!.added,3)
 const json=JSON.stringify(event);assert.ok(!json.includes('opaque-request-id'));assert.ok(!json.includes('办理申请'));assert.ok(!json.includes('mxGraphModel'));assert.match(event.requestIdDigest!,/^[a-f0-9]{64}$/)
 }finally{await cleanup(s.root)}
})

test('AI acceptance, no-op, receipt replay and failed quality/CAS produce exactly the committed activity',async()=>{
 const s=await setup();try{const scope=actor('alice',s.identity,'mcp'),first=await withActivityActor(scope,()=>s.service.createAI({taskName:'回归测试任务',content:basic,requestId:'create'},s.identity))
 const input={expectedRevision:1,requestId:'ai-patch',editIntent:'wording',operations:[{op:'update_node',id:'b',changes:{label:'审核申请'}}]}
 const second=await withActivityActor(scope,()=>s.service.patchAI(basic.id,input,s.identity));assert.equal(second.revision,2)
 await withActivityActor(scope,()=>s.service.patchAI(basic.id,input,s.identity))
 await withActivityActor(scope,()=>s.service.saveEditor(basic.id,{expectedRevision:2,requestId:'no-op',xml:second.document.rendering.engine.xml},s.identity))
 await assert.rejects(withActivityActor(scope,()=>s.service.patchAI(basic.id,{...input,requestId:'bad-quality',expectedRevision:2,operations:[{op:'update_node',id:'b',changes:{label:'长'.repeat(100)}}]},s.identity)))
 await assert.rejects(withActivityActor(scope,()=>s.service.patchContent(basic.id,{expectedRevision:1,requestId:'stale',operations:[]},s.identity)))
 const events=(await s.store.listActivity({diagramId:basic.id},s.identity)).items;assert.equal(events.length,2);assert.equal(events[0].action,'ai-content-patch');assert.equal(events[0].fromRevision,first.revision);assert.equal(events[0].summary.nodes!.updated,1);assert.equal(events[0].actor.clientId,'codex')
 }finally{await cleanup(s.root)}
})

test('collaborative actor delta excludes retained remote changes from the stale sending snapshot',async()=>{
 const s=await setup();try{const first=await s.service.create({content:basic,requestId:'create'},s.identity)
 const remote=await patchDrawio(first.document,[{op:'update_node',id:'b',changes:{label:'审核申请'}}]),local=await patchDrawio(first.document,[{op:'update_node',id:'a',changes:{label:'收到申请'}}])
 await withActivityActor(actor('bob',s.identity),()=>s.service.saveCollaborativeEditor(basic.id,{expectedRevision:1,requestId:'remote',xml:remote.xml},s.identity))
 const merged=await withActivityActor(actor('alice',s.identity),()=>s.service.saveCollaborativeEditor(basic.id,{expectedRevision:1,requestId:'local',xml:local.xml},s.identity));assert.equal(merged.revision,3)
 const events=(await s.store.listActivity({diagramId:basic.id},s.identity)).items,latest=events[0]
 assert.equal(latest.actor.userId,'alice');assert.equal(latest.fromRevision,2);assert.equal(latest.toRevision,3);assert.deepEqual(latest.summary.nodes!.changed.map(c=>c.id),['a']);assert.equal(events[1].actor.userId,'bob');assert.deepEqual(events[1].summary.nodes!.changed.map(c=>c.id),['b'])
 }finally{await cleanup(s.root)}
})

test('group/move/trash/restore actions are durable, no-op move and duplicate import add no activity',async()=>{
 const s=await setup();try{await withActivityActor(actor('alice',s.identity),async()=>{await s.service.create({content:basic,requestId:'create'},s.identity);const group=await s.store.createGroup('工作组',s.identity);await s.store.moveStoredToGroup(basic.id,group.id,null,s.identity);await s.store.moveStoredToGroup(basic.id,group.id,group.id,s.identity);await s.store.updateGroup(group.id,1,'新名称',s.identity);await s.store.delete(basic.id,1,s.identity);await s.store.delete(basic.id,1,s.identity);const deleted=(await s.store.listTrash())[0];await s.store.restoreStored(basic.id,deleted.revision,deleted.deletedAt,s.identity);await s.store.deleteGroup(group.id,2,s.identity)})
 const actions=(await s.store.listActivity({},s.identity)).items.map(e=>e.action);assert.deepEqual(actions,['group-delete','restore','delete','group-rename','move','group-create','create'])
 const imports=new NativeImportService(s.service),input={batchId:'import-batch',itemId:'one',requestId:'one',target:{newGroupName:'导入分组'},source:{format:'content',data:Buffer.from(JSON.stringify({...basic,id:'import-origin'})).toString('base64')}}
 await withActivityActor(actor('bob',s.identity),()=>imports.commitItem(input,s.identity));const size=(await s.store.listActivity({},s.identity)).items.length
 await withActivityActor(actor('bob',s.identity),()=>imports.commitItem({...input,itemId:'two',requestId:'two'},s.identity));assert.equal((await s.store.listActivity({},s.identity)).items.length,size)
 const event=(await s.store.listActivity({},s.identity)).items.find(e=>e.action==='import')!;assert.equal(event.batchId,'import-batch');assert.equal(event.itemId,'one');assert.equal(event.source!.format,'content-json')
 }finally{await cleanup(s.root)}
})

test('activity insert failure and mismatched actor workspace roll back graph/history/receipts in the same transaction',async()=>{
 const s=await setup();try{await s.service.create({content:basic,requestId:'create'},s.identity)
 const db=new Database(s.store.databasePath);try{db.exec("CREATE TRIGGER activity_fail BEFORE INSERT ON workspace_activity BEGIN SELECT RAISE(ABORT,'injected activity failure'); END;")}finally{db.close()}
 await assert.rejects(withActivityActor(actor('alice',s.identity),()=>s.service.patchContent(basic.id,{expectedRevision:1,requestId:'fail',operations:[{op:'update_node',id:'b',changes:{label:'处理申请'}}]},s.identity)))
 assert.equal((await s.store.getNative(basic.id)).revision,1);assert.equal((await s.store.listActivity({},s.identity)).items.length,1)
 const check=new Database(s.store.databasePath);try{assert.equal(check.prepare("SELECT 1 FROM native_mutation_requests WHERE request_id='fail'").get(),undefined);check.exec('DROP TRIGGER activity_fail')}finally{check.close()}
 await assert.rejects(withActivityActor(actor('alice','wrong-root'),()=>s.store.createGroup('不应存在',s.identity)),(e:any)=>e.code==='WORKSPACE_MISMATCH');assert.equal((await s.store.listGroups()).length,0)
 }finally{await cleanup(s.root)}
})

test('cursor pages remain stable when new commits arrive, filters are bound and data survives a new Store instance',async()=>{
 const s=await setup();try{for(let n=0;n<5;n++)await withActivityActor(actor('alice',s.identity),()=>s.store.createGroup('组'+n,s.identity))
 const first=await s.store.listActivity({limit:2},s.identity);assert.equal(first.items.length,2);assert.ok(first.nextCursor)
 await s.store.createGroup('新到组',s.identity)
 const second=await new DiagramStore(s.root).listActivity({limit:2,cursor:first.nextCursor},s.identity);assert.equal(second.items.length,2);assert.ok(second.items.every(e=>e.commitSequence<first.items[1].commitSequence));assert.equal(new Set([...first.items,...second.items].map(e=>e.eventId)).size,4)
 await assert.rejects(s.store.listActivity({diagramId:'other',cursor:first.nextCursor},s.identity),(e:any)=>e.code==='ACTIVITY_QUERY_INVALID');await assert.rejects(s.store.listActivity({},'wrong-root'),(e:any)=>e.code==='WORKSPACE_MISMATCH')
 }finally{await cleanup(s.root)}
})

test('collection order changes and actor/channel/action filters remain explicit without copying content values',async()=>{
 const {activitySummary}=await import('../server/activity/records')
 const before={lanes:[{id:'a',label:'甲'},{id:'b',label:'乙'}]},after={lanes:[before.lanes[1],before.lanes[0]]};const delta=activitySummary(before,after)
 assert.equal(delta.lanes!.orderChanged,true);assert.equal(delta.lanes!.updated,0);assert.ok(!JSON.stringify(delta).includes('甲'))
 const s=await setup();try{await withActivityActor(actor('alice',s.identity,'web'),()=>s.store.createGroup('甲组',s.identity));await withActivityActor(actor('bob',s.identity,'mcp'),()=>s.store.createGroup('乙组',s.identity));const filtered=await s.store.listActivity({actorUserId:'bob',channel:'mcp',action:'group-create'},s.identity)
 assert.equal(filtered.items.length,1);assert.equal(filtered.items[0].actor.userId,'bob')
 }finally{await cleanup(s.root)}
})
