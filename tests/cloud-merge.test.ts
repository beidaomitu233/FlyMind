import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {mergeNativeSnapshots,CollaborationMergeError} from '../src/drawing/engine/collaboration/merge'
import {parseNative,serialize,setCellText,attr,children} from '../src/drawing/engine/drawio/xml'
import {compileDrawio,projectDrawio} from '../src/drawing/engine/drawio'
import {businessContent} from './fixtures/native-business'
import {DiagramStore} from '../server/store'
import {NativeDiagramService} from '../server/application/native-diagrams'
import {nativeProtocolPatch} from '../src/drawing/engine/collaboration/protocol-patch'

const content=businessContent('flowchart','concurrent-rendering')
const base=(await compileDrawio(content)).xml
const nodeIds=content.nodes.map(n=>n.id)
function edit(xml:string,action:(n:ReturnType<typeof parseNative>)=>void){const n=parseNative(xml);action(n);return serialize(n.document)}
const business=(n:ReturnType<typeof parseNative>,id:string)=>[...n.cells.values()].find(e=>attr(e.object,'fmType')==='node'&&attr(e.object,'fmId')===id)!
function label(xml:string,id:string,value:string){return edit(xml,n=>setCellText(business(n,id),value))}
async function labels(xml:string){return (await projectDrawio(xml,content)).content.nodes.map(n=>n.label)}

test('independent nodes merge, identical edits commute and the two source snapshots are unchanged',async()=>{
  const local=label(base,nodeIds[0],'本地校验'),remote=label(base,nodeIds[1],'远端交付')
  const merged=await labels(mergeNativeSnapshots(base,local,remote))
  assert.equal(merged[0],'本地校验');assert.equal(merged[1],'远端交付')
  assert.deepEqual(await labels(mergeNativeSnapshots(base,remote,local)),merged)
  assert.equal((await labels(local))[1],content.nodes[1].label)
  assert.deepEqual(await labels(mergeNativeSnapshots(base,local,local)),await labels(local))
})
test('same label and delete versus edit produce explicit conflicts, not silent overwrite',()=>{
  assert.throws(()=>mergeNativeSnapshots(base,label(base,nodeIds[0],'甲'),label(base,nodeIds[0],'乙')),error=>error instanceof CollaborationMergeError&&error.conflicts.some(c=>c.field==='metadata:label'))
  const deleted=edit(base,n=>{const item=business(n,nodeIds[0]);n.root.removeChild(item.object);for(const e of n.cells.values())if(attr(e.cell,'source')===item.id||attr(e.cell,'target')===item.id)n.root.removeChild(e.object)})
  assert.throws(()=>mergeNativeSnapshots(base,deleted,label(base,nodeIds[0],'保留修改')),CollaborationMergeError)
})
test('label, geometry axes and style properties merge in separate conflict domains',async()=>{
  const local=edit(label(base,nodeIds[0],'本地文本'),n=>{const item=business(n,nodeIds[0]);children(item.cell,'mxGeometry')[0].setAttribute('x','321');item.cell.setAttribute('style',attr(item.cell,'style')+'fontSize=21;')})
  const remote=edit(base,n=>{const item=business(n,nodeIds[0]);children(item.cell,'mxGeometry')[0].setAttribute('y','654');item.cell.setAttribute('style',attr(item.cell,'style')+'fillColor=#123456;')})
  const merged=mergeNativeSnapshots(base,local,remote),item=business(parseNative(merged),nodeIds[0]),geo=children(item.cell,'mxGeometry')[0]
  assert.equal(geo.getAttribute('x'),'321');assert.equal(geo.getAttribute('y'),'654')
  assert.match(attr(item.cell,'style')!,/fontSize=21;/);assert.match(attr(item.cell,'style')!,/fillColor=#123456;/)
  assert.equal((await labels(merged))[0],'本地文本')
  const conflict=edit(base,n=>children(business(n,nodeIds[0]).cell,'mxGeometry')[0].setAttribute('x','999'))
  assert.throws(()=>mergeNativeSnapshots(base,local,conflict),CollaborationMergeError)
})
test('page identity and malformed references are rejected',()=>{
  const changed=edit(base,n=>n.diagram.setAttribute('id','another-page'))
  assert.throws(()=>mergeNativeSnapshots(base,changed,base),CollaborationMergeError)
  assert.throws(()=>mergeNativeSnapshots(base,base.replace('parent="1"','parent="absent"'),base))
})
test('public patch uses native identities and transmits label, route, insertion, deletion and sibling order',()=>{
  const local=label(base,nodeIds[0],'发布后的文案'),patch=nativeProtocolPatch(base,local) as any
  const n=parseNative(base),page=attr(n.diagram,'id')!,first=business(n,nodeIds[0])
  assert.match(patch.u[page].cells.u[first.id].xmlValue,/发布后的文案/)
  assert.deepEqual(nativeProtocolPatch(base,base),{})
  const inserted=edit(base,n=>{const copy=business(n,nodeIds[0]).object.cloneNode(true) as Element;copy.setAttribute('id','copy-native');n.root.appendChild(copy)})
  const addition=(nativeProtocolPatch(base,inserted) as any).u[page].cells.i[0]
  assert.equal(addition.id,'copy-native');assert.equal(addition.parent,'1');assert.equal(typeof addition.geometry,'string')
  assert.deepEqual((nativeProtocolPatch(inserted,base) as any).u[page].cells.r,['copy-native'])
})
test('actual SQLite concurrent saves retain both edits, durable replay survives restart and local CAS remains strict',async()=>{
  const root=await mkdtemp(join(tmpdir(),'flymind-cloud-merge-'))
  try{
    const store=new DiagramStore(root);await store.init({seedExamples:false});const service=new NativeDiagramService(store,true)
    const created=await service.create({content,requestId:'create'})
    const first=created.document.rendering.engine.xml
    const a={xml:label(first,nodeIds[0],'并发甲'),expectedRevision:1,requestId:'alice-1'}
    const b={xml:label(first,nodeIds[1],'并发乙'),expectedRevision:1,requestId:'bob-1'}
    const results=await Promise.all([service.saveCollaborativeEditor(content.id,a,service.dataRootId),service.saveCollaborativeEditor(content.id,b,service.dataRootId)])
    assert.deepEqual(results.map(r=>r.revision).sort(),[2,3])
    const current=await service.get(content.id);assert.deepEqual((await labels(current.document.rendering.engine.xml)).slice(0,2),['并发甲','并发乙'])
    const restarted=new NativeDiagramService(new DiagramStore(root),true)
    const replay=await restarted.saveCollaborativeEditor(content.id,a,restarted.dataRootId)
    assert.equal(replay.revision,results[0].revision)
    assert.equal((await restarted.get(content.id)).revision,3)
    await assert.rejects(restarted.saveEditor(content.id,{...a,requestId:'local-cas'},restarted.dataRootId),{code:'REVISION_CONFLICT'})
    await assert.rejects(restarted.saveCollaborativeEditor(content.id,{...a,xml:label(first,nodeIds[0],'冲突甲'),requestId:'conflict'},restarted.dataRootId),{code:'COLLABORATION_CONFLICT'})
    assert.equal((await restarted.get(content.id)).revision,3)
    await assert.rejects(restarted.saveCollaborativeEditor(content.id,{...a,xml:label(first,nodeIds[0],'异体重放')},restarted.dataRootId),{code:'IDEMPOTENCY_KEY_REUSED'})
  }finally{assert.ok(root.startsWith(join(tmpdir(),'flymind-cloud-merge-')));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
})
