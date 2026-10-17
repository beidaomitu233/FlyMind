import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {compileDrawio,projectDrawio} from '../src/drawing/engine/drawio'
import {createDrawingProject} from '../src/drawing/engine/project'
import {rebindDrawingProject} from '../src/drawing/engine/rebind'
import {defaultProfileForKind,drawioCapabilities} from '../src/drawing/engine/profiles'
import {parseNative,attr,element,serialize} from '../src/drawing/engine/drawio/xml'
import {cellSignature} from '../src/drawing/engine/drawio/state'

test('default profiles have stable identities while capability claims contain only verified implementations',()=>{
 assert.deepEqual(defaultProfileForKind('swimlane'),{id:'swimlane-standard',version:'1'})
 for(const kind of ['flowchart','architecture','mindmap','dataflow'] as const)assert.deepEqual(defaultProfileForKind(kind),{id:kind+'-standard',version:'1'})
 const capabilities=drawioCapabilities();assert.ok(capabilities.supportedKinds.includes('swimlane'));assert.ok(capabilities.profiles.every(p=>p.configureRendering&&p.orientations.includes('vertical')&&p.orientations.includes('horizontal')));assert.throws(()=>defaultProfileForKind('__proto__' as any),/UNSUPPORTED_DIAGRAM_KIND/)
 defaultProfileForKind('swimlane').id='tampered';capabilities.profiles[0].profile.id='tampered';assert.equal(defaultProfileForKind('swimlane').id,'swimlane-standard')
})
test('full business project import rebinds only document identity and hash, preserving every internal cell and original times',async()=>{
 const content=JSON.parse(await readFile(new URL('./fixtures/drawio-baseline/pbs-main.content.json',import.meta.url),'utf8')),engine=await compileDrawio(content),native=parseNative(engine.xml),decoration=element(native.document,'mxCell',{id:'hand-decoration',parent:'1',vertex:1,value:'手工保留',style:'rounded=1;fillColor=#eeeeee;rotation=3;locked=1;'});decoration.appendChild(element(native.document,'mxGeometry',{x:2000,y:330,width:180,height:72,as:'geometry'}));native.root.appendChild(decoration);engine.xml=serialize(native.document)
 const base=await createDrawingProject(content,engine,{createdAt:1700000000000,updatedAt:1700000001000}),before=JSON.stringify(base),rebound=await rebindDrawingProject(base,'imported-copy'),old=parseNative(base.rendering.engine.xml),next=parseNative(rebound.rendering.engine.xml)
 assert.equal(base.content.id,content.id);assert.equal(JSON.stringify(base),before);assert.equal(rebound.content.id,'imported-copy');assert.deepEqual({...rebound.content,id:content.id},content);assert.equal(rebound.createdAt,base.createdAt);assert.equal(rebound.updatedAt,base.updatedAt);assert.notEqual(rebound.rendering.engine.contentHash,base.rendering.engine.contentHash)
 assert.deepEqual([...next.cells.keys()],[...old.cells.keys()]);for(const [id,e]of old.cells){const updated=next.cells.get(id)!;if(attr(e.object,'fmType')==='decoration'&&attr(e.object,'fmRole')==='title'){assert.equal(attr(updated.object,'fmDocumentId'),'imported-copy');updated.object.setAttribute('fmDocumentId',attr(e.object,'fmDocumentId')!);updated.object.setAttribute('fmId',attr(e.object,'fmId')!)}assert.equal(cellSignature(updated),cellSignature(e),id)}
 assert.deepEqual((await projectDrawio(rebound.rendering.engine.xml)).content,rebound.content)
 for(const id of ['', '../unsafe', 'a'.repeat(101)])await assert.rejects(()=>rebindDrawingProject(base,id),/INVALID_DOCUMENT_ID/)
})
