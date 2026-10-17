import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {DiagramStore} from '../server/store'
import {NativeDiagramService} from '../server/application/native-diagrams'
import {drawioCapabilities,defaultProfileForKind} from '../src/drawing/engine/profiles'
import {nativeContentSchema} from '../server/mcp-native/contracts'
import {nativeDocumentCapabilities} from '../src/drawing/services/native-capabilities'
import {runtimeCapabilities} from '../server/runtime-instance/config'
import {guideData} from '../server/mcp-native/guide'
import {inspectDrawing} from '../src/drawing/core/drawing-quality'
import {nativeSnapshot,assertCellsPreserved} from '../scripts/probes/helpers/native-editor.mjs'
import {businessContent} from './fixtures/native-business'
async function workspace(){const root=await mkdtemp(join(tmpdir(),'flymind-business-service-')),store=new DiagramStore(root);await store.init();const service=new NativeDiagramService(store,true);return {root,store,service,identity:service.dataRootId!}}
async function cleanup(root:string){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-business-service-'));await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:100})}
test('health, MCP schema and guide expose exactly the implemented kind/profile matrix',()=>{
 const c=drawioCapabilities();assert.deepEqual(runtimeCapabilities().supportedKinds,c.supportedKinds);assert.deepEqual(guideData.capabilities,nativeDocumentCapabilities());assert.deepEqual(runtimeCapabilities().profiles,c.profiles)
 for(const profile of c.profiles){const input=businessContent(profile.kind);assert.equal(nativeContentSchema.safeParse(input).success,c.supportedKinds.includes(profile.kind));assert.equal(inspectDrawing(input).passed,true,profile.kind)}
})
test('each advertised kind uses shared AI create/read/patch/update/CAS and preserves unrelated native cells',async()=>{
 const s=await workspace();try{for(const kind of drawioCapabilities().supportedKinds){const input=businessContent(kind),first=await s.service.createAI({content:input,requestId:kind+'-create'},s.identity);assert.deepEqual(first.document.rendering.profile,defaultProfileForKind(kind));assert.equal((await s.service.readContent(input.id)).content.kind,kind)
  const before=nativeSnapshot(first),patched=await s.service.patchAI(input.id,{expectedRevision:1,requestId:kind+'-patch',editIntent:'wording',operations:[{op:'update_node',id:'task',changes:{label:'复核资料'}}]},s.identity);assert.equal(patched.revision,2);assert.deepEqual(await s.service.patchAI(input.id,{expectedRevision:1,requestId:kind+'-patch',editIntent:'wording',operations:[{op:'update_node',id:'task',changes:{label:'复核资料'}}]},s.identity),patched);assertCellsPreserved(before,nativeSnapshot(patched),before.cells.filter(c=>c.businessId!=='task').map(c=>c.cellId))
  const content=structuredClone(patched.document.content);content.nodes.find(n=>n.id==='task')!.label='确认资料';const updated=await s.service.updateAI(input.id,{expectedRevision:2,requestId:kind+'-update',editIntent:'wording',content},s.identity);assert.equal(updated.revision,3);assert.equal(updated.document.content.nodes.find(n=>n.id==='task')!.label,'确认资料');await assert.rejects(s.service.patchAI(input.id,{expectedRevision:1,requestId:kind+'-stale',editIntent:'wording',operations:[{op:'set_title',title:'不得覆盖'}]},s.identity),(e:any)=>e.code==='REVISION_CONFLICT')
 }}finally{await cleanup(s.root)}
})
test('configure writes actual XML with unchanged content and uses independent idempotence/CAS',async()=>{
 const s=await workspace();try{for(const cap of drawioCapabilities().profiles.filter(p=>p.compile)){
  const first=await s.service.createAI({content:businessContent(cap.kind,'configure-'+cap.kind),requestId:cap.kind+'-source'},s.identity),input={expectedRevision:1,requestId:cap.kind+'-configure',rendering:{relayout:true,orientation:'horizontal'}}
  if(!cap.configureRendering){await assert.rejects(s.service.configureRendering(first.document.content.id,input,s.identity),(e:any)=>e.code==='NATIVE_RENDERING_EDIT_UNSUPPORTED');continue}
  const changed=await s.service.configureRendering(first.document.content.id,input,s.identity);assert.equal(changed.revision,2);assert.deepEqual(changed.document.content,first.document.content);assert.equal(changed.document.rendering.engine.contentHash,first.document.rendering.engine.contentHash);assert.notEqual(changed.document.rendering.engine.xml,first.document.rendering.engine.xml);assert.equal(changed.document.rendering.preferences.orientation,'horizontal');assert.deepEqual(await s.service.configureRendering(first.document.content.id,input,s.identity),changed)
  await assert.rejects(s.service.configureRendering(first.document.content.id,{...input,requestId:cap.kind+'-stale'},s.identity),(e:any)=>e.code==='REVISION_CONFLICT');await assert.rejects(s.service.configureRendering(first.document.content.id,{...input,rendering:{relayout:true,orientation:'vertical'}},s.identity),(e:any)=>e.code==='IDEMPOTENCY_KEY_REUSED')
  await assert.rejects(s.service.configureRendering(first.document.content.id,{expectedRevision:2,requestId:cap.kind+'-unsupported',rendering:{theme:'forest'}},s.identity),/UNSUPPORTED_RENDERING_OPTION/);assert.equal((await s.service.get(first.document.content.id)).revision,2)
 }}finally{await cleanup(s.root)}
})
