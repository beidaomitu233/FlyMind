import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createPinia,setActivePinia} from 'pinia'
import {useStudio} from '../src/drawing/state/studio'
import {sampleFor} from '../src/drawing/core/samples'
import {layoutDocument} from '../src/drawing/core/layout'
import {copy,validateDocument,type Point} from '../src/drawing/core/model'
import {moveOrthogonalSegment,orthogonalPoints} from '../src/drawing/core/edge-editing'
import {renderScene,renderDrawio} from '../src/drawing/core/render'
import {intersectsBox} from '../src/drawing/core/routing'
import {resizeSwimlanePhase,phaseMinimum} from '../src/drawing/core/phase-editing'
import {pinScene} from '../src/drawing/core/editor'
import {extractContent,replaceRendering} from '../src/drawing/core/layers'
function studio(){const storage=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>storage.get(k)||null,setItem:(k:string,v:string)=>storage.set(k,v)}});setActivePinia(createPinia());const s=useStudio();s.open('sample-flowchart');return s}
const rectilinear=(p:Point[])=>p.slice(1).every((b,i)=>b.x===p[i].x||b.y===p[i].y)

for(const orientation of ['vertical','horizontal'] as const)test(`阶段 ${orientation}：增减尺寸同步后续节点/手动路径/标签，内容与节点大小不变`,()=>{
  const d=sampleFor('swimlane');d.presentation.orientation=orientation;d.presentation.ranks={}
  const s=layoutDocument(d),phase=s.containers.find(c=>c.kind==='phase'&&c.id==='intake')!,axis=orientation==='vertical'?'y':'x',extent=orientation==='vertical'?'height':'width',content=extractContent(d)
  pinScene(d,s)
  const edge=s.edges.find(e=>e.edge.source==='solution')!;(d.presentation.edges??={})[edge.edge.id]??={};d.presentation.edges[edge.edge.id].points=edge.points!.slice(1,-1)
  const oldStyle=copy(d.presentation.edges![edge.edge.id])
  const actual=resizeSwimlanePhase(d,s,'intake',phase[extent]+120),after=layoutDocument(validateDocument(d)),nextPhase=after.containers.find(c=>c.kind==='phase'&&c.id==='intake')!
  assert.equal(actual,phase[extent]+120);assert.equal(nextPhase[extent],actual);assert.deepEqual(extractContent(d),content)
  for(const n of s.nodes){const next=after.nodes.find(m=>m.node.id===n.node.id)!;assert.equal(next[axis],n[axis]+(n.node.phaseId==='intake'?0:120));assert.equal(next.width,n.width);assert.equal(next.height,n.height)}
  assert.deepEqual(d.presentation.edges![edge.edge.id].points,oldStyle.points!.map(p=>({...p,[axis]:p[axis]+120})))
  const movedStyle=d.presentation.edges![edge.edge.id];if(oldStyle.labelPosition)assert.equal(movedStyle.labelPosition![axis],oldStyle.labelPosition[axis]+120)
  const minimum=phaseMinimum(d,after,nextPhase),shrunk=resizeSwimlanePhase(d,after,'intake',0)
  assert.equal(shrunk,minimum);const compact=layoutDocument(d)
  for(const n of compact.nodes){const p=compact.containers.find(c=>c.kind==='phase'&&c.id===n.node.phaseId)!;assert.ok(n[axis]>=p[axis]&&n[axis]+n[extent]<=p[axis]+p[extent])}
})

test('阶段调整保存为渲染配置，支持撤销/重做/重载；锁定后续节点时原子拒绝',()=>{
  const s=studio();s.open('sample-swimlane');const phase=s.scene.containers.find(c=>c.kind==='phase')!,height=phase.height,content=extractContent(s.current)
  s.resizePhase(phase.id,height+80);assert.equal(s.scene.containers.find(c=>c.id===phase.id&&c.kind==='phase')!.height,height+80);assert.deepEqual(extractContent(s.current),content)
  s.undo();assert.equal(s.scene.containers.find(c=>c.id===phase.id&&c.kind==='phase')!.height,height)
  s.redo();assert.equal(s.current.presentation.phases![phase.id].size,height+80)
  const stored=JSON.parse(localStorage.getItem('flymind-drawing-studio-v1')!);assert.equal(stored.documents.find(d=>d.content.id===s.current.id).rendering.phases[phase.id].size,height+80)
  const d=copy(s.current),node=d.nodes.find(n=>n.phaseId!==phase.id)!;d.presentation.objects={locked:[node.id]};const before=JSON.stringify(d)
  assert.throws(()=>resizeSwimlanePhase(d,layoutDocument(d),phase.id,height+160),/锁定/);assert.equal(JSON.stringify(d),before)
})

test('MCP 渲染层调整阶段尺寸同步人工布局，空配置可清除覆盖，纯内容不包含尺寸',()=>{
  const d=sampleFor('swimlane'),scene=layoutDocument(d);pinScene(d,scene)
  const phase=scene.containers.find(c=>c.kind==='phase')!,config=copy(d.presentation);config.phases={[phase.id]:{size:phase.height+100}}
  const next=replaceRendering(d,config);assert.deepEqual(extractContent(next),extractContent(d));assert.equal(layoutDocument(next).containers.find(c=>c.id===phase.id&&c.kind==='phase')!.height,phase.height+100)
  const downstream=scene.nodes.find(n=>n.node.phaseId!==phase.id)!;assert.equal(next.presentation.positions[downstream.node.id].y,downstream.y+100)
  const cleared=replaceRendering(next,{...next.presentation,phases:{}});assert.deepEqual(cleared.presentation.phases,{})
  assert.throws(()=>replaceRendering(d,{...config,phases:{[phase.id]:{size:-1}}}),/阶段尺寸/)
})

test('左侧阶段名称每行一个字并放大，SVG 不旋转文字，draw.io 同步文字与阶段尺寸',()=>{
  const d=sampleFor('swimlane'),scene=layoutDocument(d),svg=renderScene(scene,d)
  const group=svg.match(/<g data-container-id="intake">([\s\S]*?)<\/g>/)![1]
  assert.ok(!group.includes('rotate('));assert.match(group,/font-size="24"/)
  const characters=[...group.matchAll(/<tspan [^>]*>(.*?)<\/tspan>/g)].map(m=>m[1]);assert.deepEqual(characters,['需','求','导','入'])
  const xml=renderDrawio(scene,d),phase=scene.containers.find(c=>c.kind==='phase'&&c.id==='intake')!
  assert.ok(xml.includes('value="需\n求\n导\n入"'));assert.match(xml,/id="c-intake"[^>]*fontSize=24/);assert.ok(xml.includes('height="'+phase.height+'"'))
})
test('手工新建并多次增加步骤不重叠，连线与改字不挪动已有节点，撤销恢复',()=>{
  const s=studio();s.create('flowchart');const first=copy(s.scene.nodes)
  for(let i=0;i<7;i++){const before=copy(s.scene.nodes);s.select('node',before.at(-1)!.node.id);s.addNode();for(const b of before){const after=s.scene.nodes.find(n=>n.node.id===b.node.id)!;assert.deepEqual([after.x,after.y,after.width,after.height],[b.x,b.y,b.width,b.height])}}
  const boxes=s.scene.nodes;for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)assert.ok(!intersectsBox(boxes[i],boxes[j]),'新增节点重叠')
  const before=copy(s.scene.nodes);s.updateNode(before[0].node.id,{label:'人工修改文字'});for(const b of before){const after=s.scene.nodes.find(n=>n.node.id===b.node.id)!;assert.equal(after.x,b.x);assert.equal(after.y,b.y)}
  s.undo();assert.equal(s.current.nodes[0].label,first[0].node.label)
})
test('拖动任意水平/垂直线段仅做正交移动，固定端点，旧斜线数据可恢复正交',()=>{
  for(const original of [[{x:100,y:100},{x:100,y:300}],[{x:100,y:100},{x:300,y:100}],[{x:100,y:100},{x:200,y:100},{x:200,y:250},{x:400,y:250}]])for(let index=0;index<original.length-1;index++){
    const points=moveOrthogonalSegment(original,index,{x:37,y:53});assert.ok(rectilinear(points));assert.deepEqual(points[0],original[0]);assert.deepEqual(points.at(-1),original.at(-1));assert.notDeepEqual(points,original)
  }
  assert.ok(rectilinear(orthogonalPoints([{x:10,y:20},{x:70,y:95},{x:200,y:160}],'bottom','top')))
})
test('手动线路保存/移动节点后仍正交，端点贴合节点，独立拖动文字不更改线路',()=>{
  const d=sampleFor('flowchart'),scene=layoutDocument(d),e=scene.edges[0],points=moveOrthogonalSegment(e.points!,0,{x:60,y:40})
  d.presentation.edges={[e.edge.id]:{route:'orthogonal',points:points.slice(1,-1),labelPosition:{x:350,y:280}}};d.edges[0].label='独立条件'
  const before=layoutDocument(d).edges.find(x=>x.edge.id===e.edge.id)!.path;d.presentation.edges[e.edge.id].labelPosition={x:800,y:600};const after=layoutDocument(d).edges.find(x=>x.edge.id===e.edge.id)!;assert.equal(after.path,before);assert.equal(after.labelX,800)
  const node=scene.nodes.find(n=>n.node.id===e.edge.source)!;d.presentation.positions[node.node.id]={x:node.x+53,y:node.y+27};assert.ok(rectilinear(layoutDocument(d).edges.find(x=>x.edge.id===e.edge.id)!.points!))
})
test('文字单独选择和删除保留连线，独立说明文字不自动创建连线',()=>{
  const s=studio();const id=s.current.edges[0].id;s.commit(d=>{d.edges[0].label='条件说明'});const count=s.current.edges.length;s.select('label',id);s.removeSelection();assert.equal(s.current.edges.length,count);assert.equal(s.current.edges[0].label,undefined);s.undo();assert.equal(s.current.edges[0].label,'条件说明')
  const rendered=renderScene(s.scene,s.current,'label:'+id),label=rendered.match(/<g data-label-id="[^>]+>/)![0];assert.ok(!label.includes('data-edge-id'))
  assert.match(renderDrawio(s.scene,s.current),new RegExp('id="label-'+id+'"[^>]*vertex="1"'));assert.match(renderDrawio(s.scene,s.current),new RegExp('id="e-'+id+'" value=""'))
  s.addText({x:500,y:400});assert.equal(s.current.edges.length,count);assert.equal(s.current.nodes.at(-1)!.kind,'note');assert.ok(s.current.presentation.positions[s.current.nodes.at(-1)!.id]);s.removeSelection();assert.equal(s.current.edges.length,count)
})
