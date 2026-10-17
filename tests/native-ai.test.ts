import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import Database from 'better-sqlite3'
import {DOMParser,XMLSerializer} from '@xmldom/xmldom'
import {DiagramStore} from '../server/store'
import {NativeDiagramService} from '../server/application/native-diagrams'
import {NativeExportService} from '../server/application/native-exports'
import {requireNativeAIQuality,NativeQualityError} from '../server/application/native-quality'
import {inspectDrawing} from '../src/drawing/core/drawing-quality'
import type {DiagramContent} from '../src/drawing/core/model'
import {contentSchema} from '../server/contracts'
import {drawioCapabilities} from '../src/drawing/engine/profiles'
const basic:DiagramContent={schemaVersion:1,id:'ai-basic',title:'合格申请流程',kind:'swimlane',nodes:[{id:'a',kind:'start',label:'开始',laneId:'owner',phaseId:'work'},{id:'b',kind:'task',label:'办理申请',laneId:'owner',phaseId:'work'},{id:'c',kind:'end',label:'完成',laneId:'owner',phaseId:'work'}],edges:[{id:'ab',source:'a',target:'b'},{id:'bc',source:'b',target:'c'}],lanes:[{id:'owner',label:'办理人员'}],phases:[{id:'work',label:'办理'}],groups:[]}
const clone=<T>(value:T):T=>structuredClone(value)
async function setup(){const root=await mkdtemp(join(tmpdir(),'flymind-ai-')),store=new DiagramStore(root);await store.init();const service=new NativeDiagramService(store,true);return {root,store,service,identity:service.dataRootId!}}
async function cleanup(root:string){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-ai-'));await rm(root,{recursive:true,force:true})}
function counts(store:DiagramStore){const db=new Database(store.databasePath);try{return {history:(db.prepare('SELECT count(*) n FROM diagram_versions').get() as any).n,receipts:(db.prepare('SELECT count(*) n FROM native_mutation_requests').get() as any).n}}finally{db.close()}}
function issue(fn:()=>unknown,code:string,nodeId?:string){assert.throws(fn,(e:any)=>e instanceof NativeQualityError&&e.quality.issues.some((i:any)=>i.code===code&&(!nodeId||i.nodeId===nodeId)))}

test('mixed organization remains one database and transaction root guards preserve native XML',async()=>{
 const s=await setup()
 try{
  const first=await s.service.create({content:basic,requestId:'org-native'},s.identity),group=await s.service.organize('create-group',undefined,{name:'工作组'},s.identity)
  await s.service.organize('move',basic.id,{workspaceGroupId:group.group.id,expectedWorkspaceGroupId:null},s.identity)
  await s.service.organize('move','sample-swimlane',{workspaceGroupId:group.group.id,expectedWorkspaceGroupId:null},s.identity)
  assert.equal((await s.service.get(basic.id)).document.rendering.engine.xml,first.document.rendering.engine.xml)
  await assert.rejects(s.store.delete(basic.id,1,'wrong-root'),(e:any)=>e.code==='WORKSPACE_MISMATCH')
  await assert.rejects(s.store.updateGroup(group.group.id,1,'破坏','wrong-root'),(e:any)=>e.code==='WORKSPACE_MISMATCH')
  await assert.rejects(s.store.moveStoredToGroup(basic.id,null,group.group.id,'wrong-root'),(e:any)=>e.code==='WORKSPACE_MISMATCH')
  await s.service.organize('delete',basic.id,{expectedRevision:1},s.identity)
  const trashed=(await s.service.trash()).find(r=>r.id===basic.id)!;assert.ok(trashed)
  await s.service.organize('restore',basic.id,{expectedRevision:trashed.revision,deletedAt:trashed.deletedAt},s.identity)
  const restored=await s.service.get(basic.id);assert.equal(restored.document.rendering.engine.xml,first.document.rendering.engine.xml);assert.equal(restored.workspaceGroupId,group.group.id)
 }finally{await cleanup(s.root)}
})

test('AI create requires passed quality; manual receipt cannot bypass the independent AI scope',async()=>{
  const s=await setup()
  try{
    const poor=clone(basic);poor.nodes[1].kind='decision'
    await assert.rejects(s.service.createAI({content:poor,requestId:'bad-ai'},s.identity),(e:any)=>e.code==='QUALITY_FAILED')
    await assert.rejects(s.store.getNative(poor.id),(e:any)=>e.status===404)
    await s.service.create({content:poor,requestId:'manual-poor'},s.identity)
    await assert.rejects(s.service.createAI({content:poor,requestId:'manual-poor'},s.identity),(e:any)=>e.code==='IDEMPOTENCY_KEY_REUSED')
    const good={...basic,id:'good-create'},first=await s.service.createAI({content:good,requestId:'good-ai'},s.identity)
    assert.equal(inspectDrawing(first.document.content).passed,true);assert.deepEqual(await s.service.createAI({content:good,requestId:'good-ai'},s.identity),first)
    await assert.rejects(s.service.createAI({content:{...good,title:'改payload'},requestId:'good-ai'},s.identity),(e:any)=>e.code==='IDEMPOTENCY_KEY_REUSED')
    const unsupported=drawioCapabilities().profiles.find(p=>!p.compile)
    if(unsupported)await assert.rejects(s.service.createAI({content:{...basic,id:'unsupported',kind:unsupported.kind},requestId:'other-kind'},s.identity),(e:any)=>e.code==='NATIVE_KIND_UNSUPPORTED')
  }finally{await cleanup(s.root)}
})

test('native AI rejects new warnings and note-only changes, preserves historical problems without worsening',async()=>{
  const s=await setup()
  try{
    const first=await s.service.createAI({content:basic,requestId:'create'},s.identity),before=counts(s.store)
    await assert.rejects(s.service.patchAI(basic.id,{expectedRevision:1,requestId:'warn',operations:[{op:'update_node',id:'b',changes:{label:'甲'.repeat(20)}}]},s.identity),(e:any)=>e.quality.issues.some((i:any)=>i.code==='wordy_label'))
    await assert.rejects(s.service.patchAI(basic.id,{expectedRevision:1,requestId:'note',operations:[{op:'add_node',node:{id:'n',kind:'note',label:'仅补说明'}}]},s.identity),(e:any)=>e.quality.issues.some((i:any)=>i.code==='annotation_only_change'))
    assert.deepEqual(counts(s.store),before);assert.deepEqual(await s.service.get(basic.id),first)
    const annotation=await s.service.patchAI(basic.id,{expectedRevision:1,requestId:'annotation',editIntent:'annotation',operations:[{op:'add_node',node:{id:'n',kind:'note',label:'明确用户批注'}}]},s.identity);assert.equal(annotation.revision,2)
    await assert.rejects(s.service.patchAI(basic.id,{expectedRevision:1,requestId:'annotation',editIntent:'structure',operations:[{op:'add_node',node:{id:'n',kind:'note',label:'明确用户批注'}}]},s.identity),(e:any)=>e.code==='IDEMPOTENCY_KEY_REUSED')
    const pbs=JSON.parse(await readFile(new URL('./fixtures/drawio-baseline/pbs-main.content.json',import.meta.url),'utf8'));pbs.id='historical-pbs'
    const draft=await s.service.create({content:pbs,requestId:'manual-pbs'},s.identity),oldQuality=inspectDrawing(draft.document.content)
    const fixed=await s.service.patchAI(pbs.id,{expectedRevision:1,requestId:'actual-pbs-edit',editIntent:'wording',operations:[{op:'update_node',id:'n02',changes:{label:'指定统筹负责人'}}]},s.identity)
    assert.equal(fixed.revision,2);assert.equal(fixed.document.content.edges.length,pbs.edges.length);assert.ok(inspectDrawing(fixed.document.content).score>=oldQuality.score)
  }finally{await cleanup(s.root)}
})

test('all measurable quality scales include warning growth, improved families and per-issue context',()=>{
  const old=clone(basic);old.nodes[1].label='甲'.repeat(20)
  const worse=clone(old);worse.nodes[1].label='甲'.repeat(22);issue(()=>requireNativeAIQuality(worse,old),'wordy_label','b')
  const long=clone(basic);long.nodes[1].label='甲'.repeat(35);const improved=clone(long);improved.nodes[1].label='甲'.repeat(20);assert.doesNotThrow(()=>requireNativeAIQuality(improved,long))
  const desc=clone(basic);desc.nodes[1].description='甲'.repeat(200);const moreDesc=clone(desc);moreDesc.nodes[1].description='甲'.repeat(220);issue(()=>requireNativeAIQuality(moreDesc,desc),'wordy_description','b')
  const paragraph=clone(basic);paragraph.nodes[1].label='甲\n乙\n丙\n丁';const extra=clone(paragraph);extra.nodes[1].label+='\n戊';issue(()=>requireNativeAIQuality(extra,paragraph),'paragraph_label','b')
  const continued=clone(basic);continued.edges.push({id:'ca',source:'c',target:'a',kind:'feedback'});const twice=clone(continued);twice.edges.push({id:'cb',source:'c',target:'b',kind:'feedback'});issue(()=>requireNativeAIQuality(twice,continued),'end_continues','c')
  const decision=clone(basic);decision.nodes[1].kind='decision';decision.edges.push({id:'ba',source:'b',target:'a',kind:'feedback',label:'退回'});const missing=clone(decision);missing.edges.push({id:'self',source:'b',target:'b',kind:'feedback'});issue(()=>requireNativeAIQuality(missing,decision),'decision_conditions','b')
  const arch:DiagramContent={...clone(basic),kind:'architecture',nodes:[{id:'m',kind:'module',label:'业务模块',items:['A'.repeat(150)]}],edges:[],lanes:[],phases:[]};const moreItems=clone(arch);moreItems.nodes[0].items=['A'.repeat(101),'B'.repeat(101)];issue(()=>requireNativeAIQuality(moreItems,arch),'long_item','m')
  const mind:DiagramContent={...clone(basic),kind:'mindmap',nodes:[{id:'root',kind:'topic',label:'根主题'},{id:'one',kind:'topic',label:'相同',parentId:'root'},{id:'two',kind:'topic',label:'相同',parentId:'root'},{id:'three',kind:'topic',label:'不同',parentId:'root'}],edges:[],lanes:[],phases:[]};const duplicates=clone(mind);duplicates.nodes[3].label='相同';issue(()=>requireNativeAIQuality(duplicates,mind),'duplicate_topic','one')
})

test('full update computes local semantic operations and preserves unrelated manual native geometry',async()=>{
  const s=await setup()
  try{
    const first=await s.service.createAI({content:basic,requestId:'create'},s.identity),xml=new DOMParser().parseFromString(first.document.rendering.engine.xml,'text/xml')
    const main=Array.from(xml.getElementsByTagName('*')).find(e=>e.getAttribute('fmType')==='node'&&e.getAttribute('fmId')==='c'&&e.getAttribute('fmRole')==='main')!;main.getElementsByTagName('mxGeometry')[0].setAttribute('x','111')
    const manual=await s.service.saveEditor(basic.id,{expectedRevision:1,requestId:'human-geometry',xml:new XMLSerializer().serializeToString(xml)},s.identity)
    const next=clone(manual.document.content);next.nodes.find(n=>n.id==='b')!.label='核对申请'
    const updated=await s.service.updateAI(basic.id,{expectedRevision:2,requestId:'full-update',content:next,editIntent:'wording'},s.identity)
    const native=new DOMParser().parseFromString(updated.document.rendering.engine.xml,'text/xml'),unrelated=Array.from(native.getElementsByTagName('*')).find(e=>e.getAttribute('fmType')==='node'&&e.getAttribute('fmId')==='c'&&e.getAttribute('fmRole')==='main')!
    assert.equal(unrelated.getElementsByTagName('mxGeometry')[0].getAttribute('x'),'111');assert.equal(updated.document.content.nodes.find(n=>n.id==='b')!.label,'核对申请')
    const noop=await s.service.updateAI(basic.id,{expectedRevision:3,requestId:'no-op',content:{...updated.document.content,nodes:[...updated.document.content.nodes].reverse()}},s.identity);assert.equal(noop.revision,3);assert.equal(noop.document.updatedAt,updated.document.updatedAt)
    await assert.rejects(s.service.patchAI(basic.id,{expectedRevision:2,requestId:'stale',operations:[{op:'set_title',title:'过期'}]},s.identity),(e:any)=>e.code==='REVISION_CONFLICT'&&e.currentRevision===3)
  }finally{await cleanup(s.root)}
})

test('full update adds dependencies and reconnects retained edges before removing their old endpoint',async()=>{
  const s=await setup()
  try{
    await s.service.createAI({content:basic,requestId:'create'},s.identity)
    const next=clone(basic);next.nodes=next.nodes.filter(n=>n.id!=='b');next.nodes.push({id:'new-task',kind:'task',label:'复核申请',laneId:'new-owner',phaseId:'new-phase'});next.edges[0].target='new-task';next.edges[1].source='new-task';next.lanes.push({id:'new-owner',label:'复核人员'});next.phases.push({id:'new-phase',label:'复核'});next.lanes.reverse();next.phases.reverse()
    const result=await s.service.updateAI(basic.id,{expectedRevision:1,requestId:'replace-endpoint',content:next},s.identity);assert.equal(result.revision,2);assert.deepEqual(result.document.content.edges,next.edges);assert.equal(result.document.content.nodes.find(n=>n.id==='new-task')!.laneId,'new-owner');assert.deepEqual(result.document.content.lanes,next.lanes)
    await s.service.organize('delete',basic.id,{expectedRevision:2},s.identity);await assert.rejects(s.service.updateAI(basic.id,{expectedRevision:2,requestId:'late-update',content:next},s.identity),(e:any)=>e.status===410)
  }finally{await cleanup(s.root)}
})

test('historical export can be enqueued after an idempotent old receipt replay without using current content',async()=>{
  const s=await setup()
  try{
    const input={content:basic,requestId:'create-r1'},first=await s.service.createAI(input,s.identity)
    await s.service.patchAI(basic.id,{expectedRevision:1,requestId:'advance-r2',editIntent:'wording',operations:[{op:'update_node',id:'b',changes:{label:'核对申请'}}]},s.identity)
    const receipt=await s.service.createAI(input,s.identity);assert.deepEqual(receipt,first)
    const exports=new NativeExportService(s.store,true),job=await exports.createSnapshot(basic.id,{revision:receipt.revision,requestId:'snapshot-r1'},s.identity)
    assert.equal(job.revision,1);assert.equal(job.isCurrentRevision,false);assert.deepEqual((await s.store.getNativeExport(job.id)).job.snapshot,first.document)
    await assert.rejects(exports.create(basic.id,{expectedRevision:1,requestId:'ordinary-old'},s.identity),(e:any)=>e.code==='REVISION_CONFLICT')
    await assert.rejects(exports.createSnapshot(basic.id,{revision:1,requestId:'caller-snapshot',snapshot:first.document},s.identity))
    assert.equal((await exports.createSnapshot(basic.id,{revision:1,requestId:'snapshot-r1'},s.identity)).id,job.id)
  }finally{await cleanup(s.root)}
})

test('mixed reads expose strict pure content and only declare v3 synced after XML projection validation',async()=>{
  const s=await setup()
  try{
    const legacy=await s.service.readContent('sample-swimlane');assert.equal(legacy.format,2);assert.equal(legacy.readOnly,true);assert.equal(legacy.syncStatus,'legacy-readonly');assert.equal(contentSchema.safeParse(legacy.content).success,true)
    for(const key of ['presentation','rendering','updatedAt','createdAt','positions'])assert.equal(Object.hasOwn(legacy.content,key),false)
    const created=await s.service.createAI({content:basic,requestId:'create'},s.identity);assert.equal((await s.service.readContent(basic.id)).syncStatus,'synced')
    const db=new Database(s.store.databasePath);try{const wrong=clone(created.document);wrong.rendering.engine.xml=wrong.rendering.engine.xml.replace('办理申请','偷偷更换正文');db.prepare('UPDATE diagrams SET document=? WHERE id=?').run(JSON.stringify(wrong),basic.id)}finally{db.close()}
    await assert.rejects(s.service.readContent(basic.id))
  }finally{await cleanup(s.root)}
})
