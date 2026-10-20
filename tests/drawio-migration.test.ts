import {test} from 'node:test'
import assert from 'node:assert/strict'
import {previewLegacySwimlane,convertLegacySwimlane} from '../src/drawing/engine/migration'
import {projectDrawio,compileDrawio,drawioRenderSignature} from '../src/drawing/engine/drawio'
import {validateDrawingProject} from '../src/drawing/engine/project'
import {parseNative,attr,children,serialize} from '../src/drawing/engine/drawio/xml'
import {mainEntry,geometry,styleValue} from '../src/drawing/engine/drawio/state'
import {absoluteRouteBox} from '../src/drawing/engine/drawio/routing'
import {validateDocument} from '../src/drawing/core/model'
import {layoutDocument} from '../src/drawing/core/layout'
import {inspectDrawing} from '../src/drawing/core/drawing-quality'
// Probe fixture helper is deliberately reusable; importing it runs no tests/server.
// @ts-expect-error Plain JS deterministic fixture shared with the native probe.
import {migrationFixture} from '../scripts/probes/helpers/migration-fixtures.mjs'

test('PBS v2 migration keeps 23/26, current quality issues and exact source content/times without mutating its source',async()=>{
 const source=await migrationFixture(),before=JSON.stringify(source),preview=await previewLegacySwimlane(source)
 const sourceQuality=inspectDrawing(source.content)
 // The archived standard-1.0 score was 38; compare the complete current result,
 // retaining the known business defects instead of pinning that obsolete score.
 assert.equal(sourceQuality.passed,false);assert.ok(sourceQuality.issues.some(i=>i.code==='decision_conditions'&&i.nodeId==='n12'));assert.ok(sourceQuality.issues.some(i=>i.code==='isolated_node'&&i.nodeId==='n23'))
 assert.equal(preview.status,'ready',JSON.stringify(preview.diagnostics));assert.ok(preview.project);assert.equal(preview.counts.nodes,23);assert.equal(preview.counts.edges,26);assert.deepEqual(inspectDrawing(preview.project.content),sourceQuality)
 assert.deepEqual(preview.project.content,source.content);assert.deepEqual(inspectDrawing(preview.project.content),inspectDrawing(source.content));assert.equal(preview.project.createdAt,source.createdAt);assert.equal(preview.project.updatedAt,source.updatedAt)
 assert.equal(JSON.stringify(source),before);assert.deepEqual(await previewLegacySwimlane(source),preview);assert.deepEqual(await convertLegacySwimlane(source,{expectedSourceHash:preview.sourceHash}),preview)
 assert.deepEqual((await projectDrawio(preview.project.rendering.engine.xml)).content,source.content);await validateDrawingProject(preview.project)
})
test('manual positions, dimensions, phase extents, native fixed routes, label styles, group, lock and order come from the real old scene',async()=>{
 const source=await migrationFixture(true),before=JSON.stringify(source),scene=layoutDocument(validateDocument(source)),preview=await previewLegacySwimlane(source);assert.equal(preview.status,'ready',JSON.stringify(preview.diagnostics));const n=parseNative(preview.project!.rendering.engine.xml)
 for(const node of scene.nodes){const b=absoluteRouteBox(n,mainEntry(n,'node',node.node.id));assert.deepEqual({x:b.x,y:b.y,width:b.w,height:b.h},{x:node.x,y:node.y,width:node.width,height:node.height})}
 for(const phase of scene.containers.filter(c=>c.kind==='phase'))assert.equal(Number(attr(geometry(mainEntry(n,'phase',phase.id)),'height')),phase.height)
 const edge=mainEntry(n,'edge','e02'),g=geometry(edge),points=children(children(g,'Array')[0],'mxPoint').map(p=>({x:Number(attr(p,'x')),y:Number(attr(p,'y'))}));assert.deepEqual(points,scene.edges.find(e=>e.edge.id==='e02')!.points!.slice(1,-1));assert.equal(styleValue(edge,'fontColor'),'#8050aa');assert.equal(styleValue(edge,'fontSize'),'18');assert.equal(styleValue(edge,'startArrow'),'block');assert.equal(styleValue(edge,'dashed'),'1')
 assert.equal(styleValue(mainEntry(n,'node','n02'),'locked'),'1');const group=n.cells.get('fm:object-group:manual-group')!;assert.ok(group);assert.equal(attr(mainEntry(n,'node','n01').cell,'parent'),group.id);assert.equal(attr(mainEntry(n,'node','n02').cell,'parent'),group.id)
 assert.ok(!preview.project!.rendering.engine.xml.includes('childLayout=tableLayout'));assert.equal(JSON.stringify(source),before)
})
test('source hash binds all rendering and source timestamps; stale preview conversion rejects',async()=>{
 const source=await migrationFixture(),a=await previewLegacySwimlane(source);source.rendering.positions.n02={x:260,y:300};const b=await previewLegacySwimlane(source);assert.notEqual(b.sourceHash,a.sourceHash);await assert.rejects(()=>convertLegacySwimlane(source,{expectedSourceHash:a.sourceHash}),/LEGACY_SOURCE_CHANGED/)
 source.rendering.unknownOverlay={data:1};const c=await previewLegacySwimlane(source);assert.equal(c.status,'blocked');assert.equal(c.project,undefined);assert.notEqual(c.sourceHash,b.sourceHash);assert.ok(c.diagnostics.some(d=>d.path==='rendering.unknownOverlay'))
 delete source.rendering.unknownOverlay;source.updatedAt++;assert.notEqual((await previewLegacySwimlane(source)).sourceHash,b.sourceHash)
})
test('missing source createdAt requires an explicit record timestamp and never synthesizes one',async()=>{
 const source=await migrationFixture();delete source.createdAt;assert.equal((await previewLegacySwimlane(source)).project,undefined);const p=await previewLegacySwimlane(source,{sourceCreatedAt:1700000000000});assert.equal(p.status,'ready');assert.equal(p.project!.createdAt,1700000000000)
})
test('supported old default policies remain preferences; an unrepresentable default policy blocks rather than silently resets',async()=>{
 const source=await migrationFixture();source.rendering.nodeDefaults={task:{width:240,fontSize:19,fill:'#eeeeee'}};source.rendering.edgeDefaults={route:'orthogonal',arrow:'both',color:'#123456'};const p=await previewLegacySwimlane(source);assert.equal(p.status,'ready');assert.deepEqual(p.project!.rendering.preferences.nodeDefaults,source.rendering.nodeDefaults);assert.deepEqual(p.project!.rendering.preferences.edgeDefaults,source.rendering.edgeDefaults)
 source.rendering.nodeDefaults.note={shape:'rectangle'};const blocked=await previewLegacySwimlane(source);assert.equal(blocked.status,'blocked');assert.equal(blocked.project,undefined);assert.ok(blocked.diagnostics.some(d=>d.code==='UNMAPPED_DEFAULT_POLICY'))
})
for(const [name,change,path]of [
 ['horizontal',(s:any)=>{s.rendering.orientation='horizontal'},'rendering.orientation'],
 ['other kind',(s:any)=>{s.content.kind='flowchart'},'content.kind'],
 ['cross-container group',(s:any)=>{s.rendering.objects={groups:{cross:['n02','n03']}}},'rendering.objects.groups.cross'],
 ['unknown override',(s:any)=>{s.rendering.styles={n02:{opacity:.4}}},'rendering.styles.n02.opacity'],
 ['stale override',(s:any)=>{s.rendering.positions.ghost={x:20}},'rendering.positions.ghost'],
 ['defaulted orientation',(s:any)=>{s.rendering.orientation='unexpected'},'rendering.orientation'],
 ['stale lock',(s:any)=>{s.rendering.objects={locked:['ghost']}},'rendering.objects'],
 ['interleaved group',(s:any)=>{s.rendering.objects={groups:{cross:['n01','n16']}}},'rendering.objects.groups.cross'],
 ['unknown point field',(s:any)=>{s.rendering.edges={e02:{points:[{x:200,y:500,opacity:.3}]}}},'rendering.edges.e02.points.0.opacity'],
 ['note composite',(s:any)=>{s.content.nodes.find((n:any)=>n.id==='n21').description='旧可见正文'},'content.nodes.n21.description'],
 ['curve',(s:any)=>{s.rendering.edges={e02:{route:'curved'}}},'scene.edges.e02'],
]as const)test(`unmapped ${name} is blocked with its source path and no committable project`,async()=>{const source=await migrationFixture();change(source);const p=await previewLegacySwimlane(source);assert.equal(p.status,'blocked',JSON.stringify(p));assert.equal(p.project,undefined);assert.ok(p.diagnostics.some(d=>d.severity==='blocking'&&d.path===path),JSON.stringify(p.diagnostics))})
test('legacy preview cannot reinterpret an existing v3 project or change its XML',async()=>{
 const source=await migrationFixture(),engine=await compileDrawio(source.content),signature=drawioRenderSignature(engine.xml),p=await previewLegacySwimlane({schemaVersion:3,content:source.content,rendering:{engine}});assert.equal(p.status,'blocked');assert.equal(p.project,undefined);assert.equal(drawioRenderSignature(engine.xml),signature)
})
