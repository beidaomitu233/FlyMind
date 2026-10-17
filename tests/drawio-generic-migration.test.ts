import {test} from 'node:test'
import assert from 'node:assert/strict'
import {previewLegacyGeneric,convertLegacyGeneric,legacyNativeRoute} from '../src/drawing/engine/migration/legacy-generic'
import {validateDocument,type DiagramKind} from '../src/drawing/core/model'
import {layoutDocument} from '../src/drawing/core/layout'
import {projectDrawio} from '../src/drawing/engine/drawio'
import {parseNative,attr,children,cellText} from '../src/drawing/engine/drawio/xml'
import {mainEntry,geometry,styleValue} from '../src/drawing/engine/drawio/state'
import {absoluteRouteBox} from '../src/drawing/engine/drawio/routing'
// @ts-expect-error Deterministic synthetic fixture shared with real native probe.
import {genericMigrationFixture} from '../scripts/probes/helpers/generic-migration-fixtures.mjs'

for(const kind of ['flowchart','architecture','mindmap','dataflow'] as DiagramKind[])for(const manual of [false,true])test(`${kind} ${manual?'manual':'basic'} migration preserves content/time/absolute boxes and every old path`,async()=>{
 const source=genericMigrationFixture(kind,manual),before=JSON.stringify(source),scene=layoutDocument(validateDocument(source)),preview=await previewLegacyGeneric(source)
 assert.equal(preview.status,'ready',JSON.stringify(preview.diagnostics));const project=preview.project!,n=parseNative(project.rendering.engine.xml)
 assert.deepEqual(project.content,source.content);assert.equal(project.createdAt,source.createdAt);assert.equal(project.updatedAt,source.updatedAt);assert.equal(JSON.stringify(source),before)
 assert.deepEqual((await projectDrawio(project.rendering.engine.xml)).content,source.content)
 for(const box of scene.nodes){const actual=absoluteRouteBox(n,mainEntry(n,'node',box.node.id));assert.deepEqual({x:actual.x,y:actual.y,width:actual.w,height:actual.h},{x:box.x,y:box.y,width:box.width,height:box.height})}
 for(const edge of scene.edges){const implicit=kind==='mindmap'&&!source.content.edges.some((e:any)=>e.id===edge.edge.id),native=implicit?[...n.cells.values()].find(e=>attr(e.object,'fmRole')==='parent-edge'&&attr(e.object,'fmChildId')===edge.edge.target)!:mainEntry(n,'edge',edge.edge.id),route=legacyNativeRoute(edge.path),g=geometry(native),array=children(g,'Array')[0],points=array?children(array,'mxPoint').map(e=>({x:Number(attr(e,'x')),y:Number(attr(e,'y'))})):[];assert.deepEqual(points,route.points.slice(1,-1));assert.equal(styleValue(native,'bezier'),route.bezier?'1':'0');assert.equal(styleValue(native,'noEdgeStyle'),'1');assert.equal(styleValue(native,'ignoreEdge'),implicit?'0':'1')}
 assert.ok(!project.rendering.engine.xml.includes('tableLayout'));assert.ok(preview.geometryDigest);assert.equal(preview.counts.unmapped,0)
 if(manual&&kind==='architecture'){assert.equal(styleValue(mainEntry(n,'node','task'),'locked'),'1');assert.equal(attr(mainEntry(n,'node','entry').cell,'parent'),'fm:object-group:pair');assert.equal(attr(mainEntry(n,'node','peer').cell,'parent'),'fm:object-group:pair')}
 if(manual&&kind==='dataflow')assert.equal([...n.cells.values()].filter(e=>attr(e.object,'fmRole')==='legacy-card-icon').length,3)
})
test('rich legacy module fields and composite floating text are visible native editable slots, not hidden metadata',async()=>{
 const source=genericMigrationFixture('architecture',true),p=await previewLegacyGeneric(source),n=parseNative(p.project!.rendering.engine.xml),owner=mainEntry(n,'node','entry')
 assert.equal(cellText(owner),'');for(const key of ['fmDescription','fmItems','fmBadge'])assert.equal(attr(owner.object,key),undefined)
 assert.deepEqual([...n.cells.values()].filter(e=>attr(e.cell,'parent')===owner.id&&attr(e.object,'fmRole')==='item').map(cellText),source.content.nodes[0].items)
 const note=mainEntry(n,'node','note');assert.deepEqual([...n.cells.values()].filter(e=>attr(e.cell,'parent')===note.id).map(cellText),['演练说明','保留原稿'])
 const module=sceneNode(source,'entry');const first=n.cells.get(owner.id+':field:item:0')!;assert.equal(Number(attr(geometry(first),'y')),44);assert.equal(Number(attr(geometry(owner),'height')),module.height)
})
function sceneNode(source:any,id:string){return layoutDocument(validateDocument(source)).nodes.find(n=>n.node.id===id)!}
test('default mindmap cubic retains exact endpoints and two cubic controls; implicit edges never enter content.edges',async()=>{
 const source=genericMigrationFixture('mindmap'),scene=layoutDocument(validateDocument(source)),p=await previewLegacyGeneric(source),n=parseNative(p.project!.rendering.engine.xml)
 assert.equal(p.project!.content.edges.length,0);assert.equal([...n.cells.values()].filter(e=>attr(e.object,'fmRole')==='parent-edge').length,4)
 for(const e of scene.edges){assert.ok(e.path.includes(' C '));const r=legacyNativeRoute(e.path);assert.equal(r.bezier,true);assert.equal(r.points.length,4)}
 assert.throws(()=>legacyNativeRoute('M0 0 Q1 2 3 4'),/UNSUPPORTED_EDGE_PATH/)
})
test('source hash binds unknown fields/rendering/time, rejects stale conversion, and is deterministic',async()=>{
 const source=genericMigrationFixture('flowchart'),a=await previewLegacyGeneric(source);assert.deepEqual(await previewLegacyGeneric(source),a);assert.deepEqual(await convertLegacyGeneric(source,{expectedSourceHash:a.sourceHash}),a)
 source.rendering.positions.task={x:700};const b=await previewLegacyGeneric(source);assert.notEqual(b.sourceHash,a.sourceHash);await assert.rejects(()=>convertLegacyGeneric(source,{expectedSourceHash:a.sourceHash}),/LEGACY_SOURCE_CHANGED/)
 source.rendering.secretOverlay={data:1};const c=await previewLegacyGeneric(source);assert.equal(c.status,'blocked');assert.equal(c.project,undefined);assert.ok(c.diagnostics.some(d=>d.path==='rendering.secretOverlay'))
})
test('stale references, hidden unsupported text, cross-layer and interleaved groups block with exact source paths',async()=>{
 for(const [kind,change,path]of [
  ['flowchart',(s:any)=>{s.rendering.positions.ghost={x:1}},'rendering.positions.ghost'],
  ['flowchart',(s:any)=>{s.content.nodes[1].description='未曾显示正文'},'content.nodes.task.description'],
  ['architecture',(s:any)=>{s.rendering.objects={groups:{cross:['entry','task']}}},'rendering.objects.groups.cross'],
  ['architecture',(s:any)=>{s.content.nodes.splice(1,0,{id:'middle',kind:'module',label:'中间',groupId:'app'},{id:'last',kind:'module',label:'末尾',groupId:'app'});s.rendering.objects={groups:{cross:['entry','last']}}},'rendering.objects.groups.cross'],
  ['flowchart',(s:any)=>{s.content.edges[0].label='重叠标签';s.rendering.edges={a:{labelPosition:{x:440,y:80}}};s.rendering.positions.task={x:400,y:60,width:240,height:80}},'scene.edges.a.labelBox'],
 ]as const){const source=genericMigrationFixture(kind);change(source);const p=await previewLegacyGeneric(source);assert.equal(p.status,'blocked');assert.equal(p.project,undefined);assert.ok(p.diagnostics.some(d=>d.path===path),JSON.stringify(p.diagnostics))}
})
