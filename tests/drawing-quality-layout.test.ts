import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {compileDrawio,projectDrawio,patchDrawio,configureDrawio,normalizeDrawioEdits} from '../src/drawing/engine/drawio'
import {createDrawingProject} from '../src/drawing/engine/project'
import {parseNative,attr,serialize,children,element} from '../src/drawing/engine/drawio/xml'
import {box,mainEntry,setBox,setStyle,styleValue,cellSignature,geometry} from '../src/drawing/engine/drawio/state'
import {controlledChildren} from '../src/drawing/engine/drawio/controlled'
import {inspectNativeLayout,absoluteRouteBox} from '../src/drawing/engine/drawio/routing'
import {layerHeaders,componentCollaboration,wideMindmap,compactFlow} from './fixtures/drawing-quality/scenarios'

for(const factory of [layerHeaders,componentCollaboration,wideMindmap,compactFlow])test(factory.name+': original semantic fields survive, native shapes/labels/header zones are clear',async()=>{
 const content=factory(),engine=await compileDrawio(content),n=parseNative(engine.xml)
 assert.deepEqual((await projectDrawio(engine.xml)).content,content)
 if(content.kind==='architecture'){const source=absoluteRouteBox(n,mainEntry(n,'node','model')),target=absoluteRouteBox(n,mainEntry(n,'node','cache'));assert.ok(target.x-source.x-source.w>=72+16,'same-row labelled dependencies need a real label corridor');assert.equal(styleValue(mainEntry(n,'edge','admit'),'entryY'),'0');assert.equal(styleValue(mainEntry(n,'edge','write'),'exitX'),'1')}
 assert.deepEqual(inspectNativeLayout(n).filter(i=>i.code!=='UNREADABLE_ASPECT_RATIO'),[])
})
test('flow descriptions stay complete in business attributes without inflating cards; patch preserves unrelated manual geometry',async()=>{
 const content=compactFlow();content.nodes.find(n=>n.id==='accept')!.description='这段业务详情完整保留在属性中，不参与流程步骤排版。'.repeat(4)
 const engine=await compileDrawio(content),n=parseNative(engine.xml),node=mainEntry(n,'node','accept')
 assert.ok(box(node).height<=100);assert.equal(attr(node.object,'fmDescriptionMode'),'property');assert.equal(attr(node.object,'fmDescription'),content.nodes.find(n=>n.id==='accept')!.description)
 assert.ok(!controlledChildren(n,node).some(e=>attr(e.object,'fmRole')==='body'))
 const anchor=mainEntry(n,'node','reject');setBox(anchor,{x:box(anchor).x+31});const signature=cellSignature(anchor)
 const p=await createDrawingProject(content,{...engine,xml:serialize(n.document)},{createdAt:1,updatedAt:1}),changed=await patchDrawio(p,[{op:'update_node',id:'accept',changes:{description:'修改后的完整属性正文'}}])
 assert.equal((await projectDrawio(changed.xml)).content.nodes.find(n=>n.id==='accept')!.description,'修改后的完整属性正文');assert.equal(cellSignature(mainEntry(parseNative(changed.xml),'node','reject')),signature)
})
test('automatic mindmap stores chosen compact orientation, centers parent, preserves child order; explicit V remains V',async()=>{
 const content=wideMindmap(),engine=await compileDrawio(content),n=parseNative(engine.xml),p=await createDrawingProject(content,engine,{createdAt:1,updatedAt:1})
 assert.equal(p.rendering.preferences.orientation,'horizontal')
 const b=content.nodes.map(node=>absoluteRouteBox(n,mainEntry(n,'node',node.id))),width=Math.max(...b.map(n=>n.x+n.w))-Math.min(...b.map(n=>n.x)),height=Math.max(...b.map(n=>n.y+n.h))-Math.min(...b.map(n=>n.y))
 assert.ok(width/height<2);const children=content.nodes.filter(node=>node.parentId==='root').map(node=>absoluteRouteBox(n,mainEntry(n,'node',node.id)));assert.deepEqual(children.map(c=>c.y),children.map(c=>c.y).sort((a,b)=>a-b))
 const root=absoluteRouteBox(n,mainEntry(n,'node','root'));assert.ok(Math.abs(root.y+root.h/2-(children[0].y+children[0].h/2+children.at(-1)!.y+children.at(-1)!.h/2)/2)<1)
 const vertical=await configureDrawio(p,{orientation:'vertical',relayout:true});assert.equal(vertical.preferences.orientation,'vertical');assert.equal(vertical.engine.contentHash,engine.contentHash);assert.deepEqual((await projectDrawio(vertical.engine.xml)).content,content)
})
test('flow property marker is strict without base; acknowledged marker restores without overwriting a new description',async()=>{
 const content=compactFlow(),engine=await compileDrawio(content),p=await createDrawingProject(content,engine,{createdAt:1,updatedAt:1}),n=parseNative(engine.xml),node=mainEntry(n,'node','accept')
 node.object.removeAttribute('fmDescriptionMode');node.object.setAttribute('fmDescription','用户已修改的属性正文')
 await assert.rejects(()=>projectDrawio(serialize(n.document)),/DUPLICATE_CONTROLLED_METADATA/)
 const normalized=await normalizeDrawioEdits(serialize(n.document),p)
 assert.equal(normalized.content.nodes.find(n=>n.id==='accept')!.description,'用户已修改的属性正文');assert.equal(attr(mainEntry(parseNative(normalized.xml),'node','accept').object,'fmDescriptionMode'),'property')
 assert.deepEqual((await projectDrawio(normalized.xml)).content,normalized.content)
})
test('machine gate diagnoses actual node/header/label collision without changing manual XML',async()=>{
 const engine=await compileDrawio(layerHeaders()),n=parseNative(engine.xml),node=mainEntry(n,'node','model');setBox(node,{x:0});const before=serialize(n.document)
 assert.ok(inspectNativeLayout(n).some(i=>i.code==='NODE_HEADER_OVERLAP'));assert.equal(serialize(n.document),before)
 const duplicate=mainEntry(n,'node','cache');setBox(duplicate,box(node));assert.ok(inspectNativeLayout(n).some(i=>i.code==='NODE_OVERLAP'))
})
test('existing PBS remains 23 nodes / 26 edges and compiles without semantic repair',async()=>{
 const c=JSON.parse(await readFile('tests/fixtures/drawio-baseline/pbs-main.content.json','utf8')),engine=await compileDrawio(c)
 assert.equal(c.nodes.length,23);assert.equal(c.edges.length,26);assert.deepEqual((await projectDrawio(engine.xml)).content,c)
})
test('forward flow ports follow direction; opposite shared route cannot visually bypass a task',async()=>{
 const content=compactFlow()
 for(const orientation of ['vertical','horizontal'] as const){const n=parseNative((await compileDrawio(content,{preferences:{orientation}})).xml);for(const edge of content.edges){const e=mainEntry(n,'edge',edge.id);assert.equal(styleValue(e,orientation==='vertical'?'exitY':'exitX'),'1');assert.equal(styleValue(e,orientation==='vertical'?'entryY':'entryX'),'0')}assert.ok(!inspectNativeLayout(n).some(i=>i.code==='OPPOSITE_ROUTE_OVERLAP'))}
 const n=parseNative((await compileDrawio(content)).xml);setBox(mainEntry(n,'node','auth'),{x:200,y:0,width:100,height:50});setBox(mainEntry(n,'node','reject'),{x:0,y:200,width:100,height:50});setBox(mainEntry(n,'node','end'),{x:200,y:400,width:100,height:50})
 for(const [id,ports]of [['no',{exitX:.5,exitY:1,entryX:1,entryY:.5}],['not-authorized',{exitX:1,exitY:.5,entryX:.5,entryY:0}]] as const){const e=mainEntry(n,'edge',id);setStyle(e,ports);const g=geometry(e);for(const p of children(g))g.removeChild(p);const points=element(n.document,'Array',{as:'points'});points.appendChild(element(n.document,'mxPoint',{x:250,y:225}));g.appendChild(points)}
 assert.ok(inspectNativeLayout(n).some(i=>i.code==='OPPOSITE_ROUTE_OVERLAP'&&i.cellIds.includes(mainEntry(n,'edge','no').id)&&i.cellIds.includes(mainEntry(n,'edge','not-authorized').id)))
})
