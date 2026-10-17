import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {compileDrawio,projectDrawio,patchDrawio,DRAWIO_VERSION,DRAWIO_ADAPTER_VERSION,DEFAULT_SWIMLANE_PROFILE} from '../src/drawing/engine/drawio/index'
import {attr,element,parseNative,serialize,children,MAX_DRAWIO_BYTES,type NativeDocument} from '../src/drawing/engine/drawio/xml'
import {validateContent} from '../src/drawing/core/layers'
import {contentHash} from '../src/drawing/engine/content-hash'
import type {DiagramContent} from '../src/drawing/core/model'
import type {DrawingProjectV3} from '../src/drawing/engine/types'
const fixture=async(name='pbs-main')=>validateContent(JSON.parse(await readFile(new URL(`./fixtures/drawio-baseline/${name}.content.json`,import.meta.url),'utf8')))
async function compiled(name='pbs-main'){const content=await fixture(name);return {content,engine:await compileDrawio(content)}}
function mutate(xml:string,fn:(native:NativeDocument)=>void){const native=parseNative(xml);fn(native);return serialize(native.document)}
const bound=(native:NativeDocument,type:string,id:string)=>[...native.cells.values()].find(e=>attr(e.object,'fmType')===type&&attr(e.object,'fmId')===id)!
const snapshot=(xml:string)=>{const native=parseNative(xml);return Object.fromEntries([...native.cells].map(([id,e])=>[id,{cellAttributes:[...Array(e.cell.attributes.length)].map((_,i)=>{const a=e.cell.attributes.item(i)!;return [a.name,a.value]}),geometry:children(e.cell,'mxGeometry').map(serialize)}]))}
function project(content:DiagramContent,engine:DrawingProjectV3['rendering']['engine']):DrawingProjectV3{return {schemaVersion:3,content,rendering:{profile:DEFAULT_SWIMLANE_PROFILE,preferences:{theme:'indigo',orientation:'vertical'},engine},createdAt:1,updatedAt:1}}

test('PBS content compiles into native table and returns exact semantics without repairing source anomalies',async()=>{
  const {content,engine}=await compiled(),native=parseNative(engine.xml),result=await projectDrawio(engine.xml)
  assert.equal(engine.version,DRAWIO_VERSION);assert.equal(engine.adapterVersion,DRAWIO_ADAPTER_VERSION)
  assert.deepEqual(result.content,content);assert.equal(result.contentHash,await contentHash(content))
  assert.equal(result.content.nodes.length,23);assert.equal(result.content.edges.length,26)
  assert.equal(native.model.getAttribute('fmDocumentId'),content.id)
  assert.ok([...native.cells.values()].some(e=>e.cell.getAttribute('style').includes('childLayout=tableLayout')))
  assert.notEqual(bound(native,'node','p02').id,bound(native,'phase','p02').id)
  assert.equal(result.content.edges.find(e=>e.id==='e21')!.kind,undefined,'An unmarked backward edge remains unmarked')
  assert.ok(!native.model.hasAttribute('content'),'No hidden full content copy')
})
test('ordinary swimlane and optional business properties round-trip with explicit literal XML escaping',async()=>{
  const content=await fixture('swimlane');Object.assign(content.nodes[0],{label:'中文 <流程> & "审批"\n下一行',description:'保留说明 < > &',items:['甲','乙 & 丙'],badge:'待办',color:'#aabbcc'})
  const e=await compileDrawio(content),result=await projectDrawio(e.xml)
  assert.deepEqual(result.content,validateContent(content));assert.ok(e.xml.includes('&amp;'));assert.ok(e.xml.includes('&lt;'))
})
test('visible title, role/phase titles, node labels, edge conditions and endpoints are projected from their native cells',async()=>{
  const {content,engine}=await compiled()
  const xml=mutate(engine.xml,n=>{
    [...n.cells.values()].find(e=>attr(e.object,'fmRole')==='title')!.object.setAttribute('label','原生修改图标题')
    bound(n,'lane','r01').object.setAttribute('label','管理员（已编辑）');[...n.cells.values()].find(e=>attr(e.object,'fmType')==='phase'&&attr(e.object,'fmRole')==='title'&&attr(e.object,'fmId')==='p01')!.object.setAttribute('label','准备及分派')
    const main=bound(n,'node','n02'),node=[...n.cells.values()].find(e=>attr(e.cell,'parent')===main.id&&attr(e.object,'fmRole')==='title')??main;node.object.setAttribute('label','人工编辑 & 审批');node.cell.setAttribute('style',node.cell.getAttribute('style').replace('html=0','html=1'));node.object.setAttribute('label','<b>人工编辑</b><br>审批 &amp; 复核')
    const edge=bound(n,'edge','e01');edge.object.setAttribute('label','新条件');edge.cell.setAttribute('target',bound(n,'node','n03').id)
  })
  const result=await projectDrawio(xml,content)
  assert.equal(result.content.title,'原生修改图标题');assert.equal(result.content.lanes[0].label,'管理员（已编辑）');assert.equal(result.content.phases[0].label,'准备及分派')
  assert.equal(result.content.nodes.find(n=>n.id==='n02')!.label,'人工编辑\n审批 & 复核')
  assert.equal(result.content.nodes.find(n=>n.id==='n02')!.description,content.nodes.find(n=>n.id==='n02')!.description)
  assert.equal(result.content.edges[0].target,'n03');assert.equal(result.content.edges[0].label,'新条件')
})
test('explicit role/phase reassignment requires matching native intersection and unknown decorations stay out of content',async()=>{
  const {content,engine}=await compiled()
  const xml=mutate(engine.xml,n=>{
    const node=bound(n,'node','n02'),intersection=[...n.cells.values()].find(e=>attr(e.object,'fmRole')==='intersection'&&attr(e.object,'fmLaneId')==='r04'&&attr(e.object,'fmPhaseId')==='p02')!
    node.object.setAttribute('fmLaneId','r04');node.object.setAttribute('fmPhaseId','p02');node.cell.setAttribute('parent',intersection.id)
    n.root.appendChild(element(n.document,'mxCell',{id:'manual-decoration',value:'人工装饰',vertex:1,parent:'1',style:'text;'}))
  })
  const projected=await projectDrawio(xml,content);assert.equal(projected.content.nodes.length,23);assert.equal(projected.content.nodes.find(n=>n.id==='n02')!.laneId,'r04');assert.ok(projected.xml.includes('manual-decoration'));assert.ok(projected.diagnostics.some(d=>d.code==='DECORATION_PRESERVED'))
  await assert.rejects(()=>projectDrawio(mutate(engine.xml,n=>bound(n,'node','n02').object.setAttribute('fmLaneId','r04')),content),/OWNERSHIP_MISMATCH/)
  await assert.rejects(()=>projectDrawio(mutate(engine.xml,n=>{const node=bound(n,'node','n02'),parent=n.cells.get(node.cell.getAttribute('parent'))!;parent.object.setAttribute('fmPhaseId','p02');node.object.setAttribute('fmPhaseId','p02')}),content),/OWNERSHIP_MISMATCH/)
})
test('strict content input rejects AI coordinates, visual options and unsupported diagram kinds',async()=>{
  const c=await fixture();await assert.rejects(()=>compileDrawio({...c,nodes:[{...c.nodes[0],x:42} as any,...c.nodes.slice(1)]}),/不属于内容层/)
  await assert.rejects(()=>compileDrawio({...c,kind:'flowchart'}),/UNSUPPORTED_CONTAINER_KIND/)
  assert.deepEqual((await projectDrawio((await compileDrawio(c,{preferences:{orientation:'horizontal'}})).xml)).content,c)
})
test('malicious, malformed, overlarge, compressed and multipage XML are rejected before projection',async()=>{
  const {engine}=await compiled()
  for(const xml of ['<!DOCTYPE mxfile [<!ENTITY x SYSTEM "file:///C:/secret">]>'+engine.xml,'<!ENTITY x "oops">'+engine.xml,'<?evil test?>'+engine.xml,engine.xml.replace('<root>','<root><script/>')])await assert.rejects(()=>projectDrawio(xml),/UNSAFE_XML/)
  await assert.rejects(()=>projectDrawio('<mxfile><diagram>compressedbase64</diagram></mxfile>'),/UNSUPPORTED_COMPRESSED_XML/)
  await assert.rejects(()=>projectDrawio('<mxfile><diagram/><diagram/></mxfile>'),/UNSUPPORTED_MULTIPAGE/)
  await assert.rejects(()=>projectDrawio(engine.xml+' '.repeat(MAX_DRAWIO_BYTES)),/XML_TOO_LARGE/)
  await assert.rejects(()=>projectDrawio(engine.xml.replace('</mxfile>','')),/INVALID_XML/)
  await assert.rejects(()=>projectDrawio(engine.xml.replace('UserObject','UserObject\u0000')),/INVALID_XML/)
})
test('duplicate cell IDs, copied business IDs, missing references and cyclic parents are rejected',async()=>{
  const {engine}=await compiled()
  await assert.rejects(()=>projectDrawio(mutate(engine.xml,n=>{const node=bound(n,'node','n01');n.root.appendChild(node.object.cloneNode(true))})),/DUPLICATE_CELL_ID/)
  await assert.rejects(()=>projectDrawio(mutate(engine.xml,n=>{const node=bound(n,'node','n01').object.cloneNode(true) as Element;node.setAttribute('id','copied-cell');n.root.appendChild(node)})),/DUPLICATE_BINDING/)
  await assert.rejects(()=>projectDrawio(mutate(engine.xml,n=>bound(n,'edge','e01').cell.setAttribute('target','absent'))),/BROKEN_REFERENCE/)
  await assert.rejects(()=>projectDrawio(mutate(engine.xml,n=>{const a=bound(n,'node','n01'),b=bound(n,'node','n02');a.cell.setAttribute('parent',b.id);b.cell.setAttribute('parent',a.id)})),/CYCLIC_PARENT/)
})
test('local text patch keeps every native cell style, geometry, manual waypoint and decoration unchanged',async()=>{
  const {content,engine}=await compiled()
  engine.xml=mutate(engine.xml,n=>{
    const node=bound(n,'node','n01');children(node.cell,'mxGeometry')[0].setAttribute('x','137');node.cell.setAttribute('style',node.cell.getAttribute('style')+'rotation=5;')
    const edge=bound(n,'edge','e01'),geo=children(edge.cell,'mxGeometry')[0],points=element(n.document,'Array',{as:'points'});points.appendChild(element(n.document,'mxPoint',{x:123,y:456}));geo.appendChild(points)
    n.root.appendChild(element(n.document,'mxCell',{id:'keep-me',vertex:1,parent:'1',value:'手工装饰',style:'ellipse;'}))
  })
  const before=snapshot(engine.xml),patched=await patchDrawio(project(content,engine),[{op:'update_node',id:'n02',changes:{label:'AI 局部改文案',description:'说明更新'}},{op:'update_edge',id:'e01',changes:{label:'更新条件'}},{op:'set_title',title:'局部改标题'},{op:'update_container',collection:'lanes',id:'r01',changes:{label:'管理员更新'}},{op:'update_container',collection:'phases',id:'p01',changes:{label:'登记分派更新'}}])
  assert.deepEqual(snapshot(patched.xml),before)
  const result=await projectDrawio(patched.xml,content);assert.equal(result.content.nodes.find(n=>n.id==='n02')!.label,'AI 局部改文案');assert.equal(result.content.phases[0].label,'登记分派更新');assert.ok(result.xml.includes('keep-me'))
  await assert.rejects(()=>patchDrawio(project(content,engine),[{op:'add_container',collection:'groups',item:{id:'extra',label:'未支持分层'}}]),/UNSUPPORTED_PATCH/)
  await assert.rejects(()=>patchDrawio(project(content,engine),[{op:'set_node_presentation',id:'n01',position:{x:1}}]),/UNSUPPORTED_PATCH/)
})
test('stale content/hash and locked native nodes reject AI modifications',async()=>{
  const {content,engine}=await compiled()
  await assert.rejects(()=>patchDrawio(project({...content,title:'stale'},engine),[{op:'set_title',title:'override'}]),/CONTENT_XML_MISMATCH/)
  engine.xml=mutate(engine.xml,n=>{const e=bound(n,'node','n01');e.cell.setAttribute('style',e.cell.getAttribute('style')+'locked=1;')})
  await assert.rejects(()=>patchDrawio(project(content,engine),[{op:'update_node',id:'n01',changes:{label:'override'}}]),/LOCKED_OBJECT/)
  await assert.rejects(()=>patchDrawio(project(content,engine),[{op:'update_node',id:'n01',changes:{description:'metadata only'}}]),/LOCKED_OBJECT/)
  engine.xml=mutate(engine.xml,n=>{const e=bound(n,'node','n01');e.cell.setAttribute('style',e.cell.getAttribute('style').replace('locked=1;',''));const parent=n.cells.get(e.cell.getAttribute('parent'))!;parent.cell.setAttribute('style',parent.cell.getAttribute('style')+'editable=0;')})
  await assert.rejects(()=>patchDrawio(project(content,engine),[{op:'update_node',id:'n01',changes:{badge:'metadata only'}}]),/LOCKED_OBJECT/)
})
test('long titles and floating notes stay native, and note additions do not extend phase geometry',async()=>{
  const c=await fixture('swimlane'),normal=await compileDrawio(c)
  const long=copyContent(c);long.title='跨部门申请审核与交付'.repeat(8);long.nodes[0].label='需要在规定时间内核验申请资料与服务目标，并由负责人确认后移交下一环节'.repeat(5)
  const e=await compileDrawio(long);assert.deepEqual((await projectDrawio(e.xml)).content,long)
  c.nodes.push({id:'float',kind:'note',label:'只作浮动说明',laneId:'r01',phaseId:'p01'})
  const noted=parseNative((await compileDrawio(c)).xml),plain=parseNative(normal.xml)
  assert.deepEqual(children(bound(noted,'phase','p01').cell,'mxGeometry').map(serialize),children(bound(plain,'phase','p01').cell,'mxGeometry').map(serialize))
  assert.equal(bound(noted,'annotation','float').cell.getAttribute('parent'),'1')
})
function copyContent(c:DiagramContent):DiagramContent{return JSON.parse(JSON.stringify(c))}

test('standalone projection keeps deliberately shuffled collection orders without a base content copy',async()=>{
 const c=await fixture();for(const key of ['nodes','edges','lanes','phases'] as const){const values=c[key] as any[];c[key]=[...values.filter((_,i)=>i%2),...values.filter((_,i)=>!(i%2))].reverse() as never}
 const engine=await compileDrawio(c);assert.deepEqual((await projectDrawio(engine.xml)).content,c)
})
test('explicit rendering fill wins over semantic color without changing semantic content, and arrow presets map to native styles',async()=>{
 const c=await fixture();c.nodes[0].color='#aabbcc'
 for(const arrow of ['end','both','none'] as const){const e=await compileDrawio(c,{preferences:{nodeDefaults:{start:{fill:'#112233'}},edgeDefaults:{arrow,dashed:false}}}),n=parseNative(e.xml),style=bound(n,'edge','e01').cell.getAttribute('style');assert.ok(style.includes(`startArrow=${arrow==='both'?'block':'none'};`));assert.ok(style.includes(`endArrow=${arrow==='none'?'none':'block'};`));assert.ok(bound(n,'node','n01').cell.getAttribute('style').includes('fillColor=#112233;'));assert.equal((await projectDrawio(e.xml)).content.nodes[0].color,'#aabbcc');assert.ok(bound(n,'edge','e08').cell.getAttribute('style').includes('dashed=0;'))}
 await assert.rejects(()=>compileDrawio(c,{preferences:{nodeDefaults:{task:{width:32}}}}),/UNSUPPORTED_RENDERING_OPTION/)
 await assert.rejects(()=>compileDrawio(c,{preferences:{edgeDefaults:{route:'curved'}}}),/UNSUPPORTED_RENDERING_OPTION/)
})
test('unassigned long notes compile without extending native phase rows, and phase headers have upright controlled text',async()=>{
 const c=await fixture(),baseline=await compileDrawio(c);c.nodes.push({id:'unassigned',kind:'note',label:'浮动说明'.repeat(125)})
 const engine=await compileDrawio(c),n=parseNative(engine.xml),note=bound(n,'annotation','unassigned'),g=children(note.cell,'mxGeometry')[0]
 assert.ok(Number(g.getAttribute('height'))>72);assert.deepEqual((await projectDrawio(engine.xml)).content,c)
 const phaseTitle=[...n.cells.values()].find(e=>attr(e.object,'fmType')==='phase'&&attr(e.object,'fmRole')==='title')!
 assert.ok(phaseTitle.cell.getAttribute('style').includes('fontSize=24;'));assert.ok(phaseTitle.object.getAttribute('label').includes('line-height:32.8px'));assert.ok(!phaseTitle.object.getAttribute('label').includes('<br>'))
 assert.deepEqual(children(bound(n,'phase','p01').cell,'mxGeometry').map(serialize),children(bound(parseNative(baseline.xml),'phase','p01').cell,'mxGeometry').map(serialize))
})
test('floating note standards apply to native text dimensions and colors; unsupported note shapes reject explicitly',async()=>{
 const c=await fixture();c.nodes.push({id:'note-preset',kind:'note',label:'短说明',phaseId:'p01'})
 const e=await compileDrawio(c,{preferences:{nodeDefaults:{note:{width:400,height:100,fontSize:20,fill:'#eeeeee',stroke:'#cccccc',textColor:'#112233'}}}}),n=parseNative(e.xml),note=bound(n,'annotation','note-preset'),geo=children(note.cell,'mxGeometry')[0]
 assert.equal(geo.getAttribute('width'),'400');assert.equal(geo.getAttribute('height'),'100');assert.ok(note.cell.getAttribute('style').includes('fontSize=20;'));assert.ok(note.cell.getAttribute('style').includes('fontColor=#112233;'))
 await assert.rejects(()=>compileDrawio(c,{preferences:{nodeDefaults:{note:{shape:'ellipse'}}}}),/UNSUPPORTED_RENDERING_OPTION/)
})

const routingContent=():DiagramContent=>({schemaVersion:1,id:'routing-regression',title:'路由回归',kind:'swimlane',nodes:[{id:'a',label:'复核',kind:'task',laneId:'r',phaseId:'p'},{id:'b',label:'交付',kind:'task',laneId:'r',phaseId:'p'}],edges:[{id:'ab',source:'a',target:'b',label:'核验完成'}],lanes:[{id:'r',label:'责任人'}],phases:[{id:'p',label:'阶段'}],groups:[]})
test('the existing 2000-edge content budget includes native self loops without manual waypoint routing',async()=>{
 const c=routingContent();c.edges=Array.from({length:2000},(_,i)=>({id:`loop-${i}`,source:'a',target:'a'}))
 const engine=await compileDrawio(c),n=parseNative(engine.xml),loop=bound(n,'edge','loop-1999')
 assert.equal((await projectDrawio(engine.xml)).content.edges.length,2000)
 assert.ok(loop.cell.getAttribute('style').includes('loopStyle=loopEdgeStyle;'));assert.ok(loop.cell.getAttribute('style').includes('orthogonal=1;'));assert.equal(children(children(loop.cell,'mxGeometry')[0],'Array').length,0)
})
test('endpoint changes discard stale ports/points/offset while preserving paint and every unrelated native cell',async()=>{
 const c=routingContent(),e=await compileDrawio(c);e.xml=mutate(e.xml,n=>{const edge=bound(n,'edge','ab');edge.cell.setAttribute('style',edge.cell.getAttribute('style')+'strokeColor=#123456;strokeWidth=3;exitX=0;entryY=0;');const g=children(edge.cell,'mxGeometry')[0],points=element(n.document,'Array',{as:'points'});points.appendChild(element(n.document,'mxPoint',{x:900,y:900}));g.appendChild(points)})
 const before=parseNative(e.xml),patched=await patchDrawio(project(c,e),[{op:'update_edge',id:'ab',changes:{target:'a'}}]),n=parseNative(patched.xml),loop=bound(n,'edge','ab')
 for(const[id,cell]of before.cells)if(id!==loop.id)assert.equal(serialize(n.cells.get(id)!.object),serialize(cell.object))
 assert.ok(loop.cell.getAttribute('style').includes('strokeColor=#123456;'));assert.ok(loop.cell.getAttribute('style').includes('strokeWidth=3;'));assert.ok(!loop.cell.getAttribute('style').includes('exitX='));assert.equal(children(children(loop.cell,'mxGeometry')[0],'Array').length,0)
})
test('a new label reserves the unrelated native label and route without rewriting either',async()=>{
 const c=routingContent(),e=await compileDrawio(c),before=parseNative(e.xml),old=serialize(bound(before,'edge','ab').object)
 const patched=await patchDrawio(project(c,e),[{op:'add_edge',edge:{id:'parallel',source:'a',target:'b',label:'另行复核'}}]),n=parseNative(patched.xml)
 assert.equal(serialize(bound(n,'edge','ab').object),old)
 const offset=(id:string)=>children(children(bound(n,'edge',id).cell,'mxGeometry')[0],'mxPoint').find(p=>attr(p,'as')==='offset')!
 assert.notEqual(serialize(offset('parallel')),serialize(offset('ab')))
})
