import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { copy, validateDocument } from '../src/drawing/core/model'
import { samples, sampleFor } from '../src/drawing/core/samples'
import { layoutDocument } from '../src/drawing/core/layout'
import { renderScene, renderDrawio } from '../src/drawing/core/render'
import { parseDocument, toMindTree, fromMarkdown } from '../src/drawing/core/adapters'
import { useStudio } from '../src/drawing/state/studio'
import { cardMetrics } from '../src/drawing/core/dataflow'

for(const example of samples)test(`${example.kind}：纯数据布局和渲染不修改节点层`,()=>{
  const d=validateDocument(example),before=JSON.stringify(d),scene=layoutDocument(d),svg=renderScene(scene,d),xml=renderDrawio(scene,d)
  assert.equal(scene.nodes.length,d.nodes.length)
  assert.equal(JSON.stringify(d),before)
  assert.ok(scene.nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)&&n.x+n.width<=scene.width&&n.y+n.height<=scene.height))
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'))
  assert.ok(!svg.includes('foreignObject'))
  assert.ok(xml.includes('<mxfile'))
  for(const n of d.nodes)assert.ok(svg.includes(`data-node-id="${n.id}"`))
})
test('泳道图保留角色、阶段、判断、回流和 N/Y 分支',()=>{
  const d=sampleFor('swimlane'),scene=layoutDocument(d)
  assert.equal(scene.containers.filter(c=>c.kind==='lane').length,4)
  assert.equal(scene.containers.filter(c=>c.kind==='phase').length,5)
  assert.equal(scene.edges.length,d.edges.length)
  const direct=scene.edges.find(e=>e.edge.source==='goal'&&e.edge.target==='match')!
  assert.ok(direct.path.includes(' H '),'跳过咨询节点的 Y 分支应从侧面绕行')
  assert.equal(direct.edge.label,'Y')
})
test('横向泳道布局保留节点归属且同泳道步骤不重叠',()=>{
  const d=sampleFor('swimlane');d.presentation.orientation='horizontal';const scene=layoutDocument(d),goal=scene.nodes.find(n=>n.node.id==='goal')!,consult=scene.nodes.find(n=>n.node.id==='consulting')!
  assert.equal(goal.node.laneId,consult.node.laneId)
  assert.ok(consult.x>=goal.x+goal.width)
})
test('一般循环流程不丢节点或边',()=>{
  const d=sampleFor('flowchart');d.nodes.forEach(n=>delete n.order);const scene=layoutDocument(d)
  assert.equal(scene.nodes.length,d.nodes.length);assert.equal(scene.edges.length,d.edges.length)
})
test('JSON 校验拒绝不存在的端点、泳道和循环父子关系',()=>{
  const d=sampleFor('swimlane');d.edges[0].target='missing';assert.throws(()=>validateDocument(d),/端点/)
  const missing=sampleFor('swimlane');missing.nodes[0].laneId='missing';assert.throws(()=>validateDocument(missing),/泳道/)
  const mind=sampleFor('mindmap');mind.nodes.find(n=>n.id==='m0')!.parentId='m0_0';assert.throws(()=>validateDocument(mind),/循环/)
})
test('SVG 与 XML 转义不执行节点中 HTML',()=>{
  const d=sampleFor('flowchart');d.nodes[0].label='<script>alert("x")</script>';const scene=layoutDocument(d)
  assert.ok(!renderScene(scene,d).includes('<script>'));assert.ok(!renderDrawio(scene,d).includes('<script>'))
})
test('原 FMD 文件和 Markdown 思维导图可导入新节点层',()=>{
  const mind=sampleFor('mindmap'),fmd={type:'flymind',metadata:{name:mind.title},data:{root:toMindTree(mind)}}
  assert.equal(parseDocument(JSON.stringify(fmd)).nodes.length,mind.nodes.length)
  assert.equal(fromMarkdown('- 根主题\n  - 子主题').nodes.length,2)
})
test('角色拖动、编辑、撤销、重做与本地持久化使用同一份数据',()=>{
  const storage=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>storage.get(k)||null,setItem:(k:string,v:string)=>storage.set(k,v)}})
  setActivePinia(createPinia());const s=useStudio();s.open('sample-swimlane')
  const box=s.scene.nodes.find(n=>n.node.id==='request')!,lane=s.scene.containers.find(c=>c.id==='bd')!
  s.moveNode('request',lane.x+40,box.y)
  assert.equal(s.current.nodes.find(n=>n.id==='request')!.laneId,'bd')
  assert.ok(s.current.presentation.positions.request)
  s.undo();assert.equal(s.current.nodes.find(n=>n.id==='request')!.laneId,'customer')
  s.redo();assert.equal(s.current.nodes.find(n=>n.id==='request')!.laneId,'bd')
  assert.equal(JSON.parse(storage.get('flymind-drawing-studio-v1')!).documents[0].nodes[0].laneId,'bd')
  s.selection={type:'lane',id:'bd'};const length=s.current.lanes.length;s.removeSelection();assert.equal(s.current.lanes.length,length)
})

test('数据流多源汇聚使用各自入口，反馈连线绕过卡片且位于注释上方',()=>{
  const d=sampleFor('dataflow'),scene=layoutDocument(d),platform=scene.nodes.find(n=>n.node.id==='integration')!
  const inputs=scene.edges.filter(e=>e.edge.target==='integration')
  assert.equal(inputs.length,5);assert.equal(new Set(inputs.map(e=>e.path)).size,5)
  for(const edge of inputs){const source=scene.nodes.find(n=>n.node.id===edge.edge.source)!;const x=source.x+source.width/2;assert.equal(edge.path,`M ${x} ${source.y+source.height} V ${platform.y}`)}
  const loop=scene.edges.find(e=>e.edge.kind==='feedback')!,lane=Number(loop.path.split(' V ')[1].split(' H ')[0]),note=scene.nodes.find(n=>n.node.kind==='note')!
  assert.ok(lane>Math.max(...scene.nodes.filter(n=>n.node.kind==='card').map(n=>n.y+n.height)))
  assert.ok(lane<note.y);assert.equal(loop.edge.label,'可追溯证据链')
  const drawio=renderDrawio(scene,d);assert.ok(drawio.includes('<Array as="points">'));assert.ok(drawio.includes('质控后进入业务与 AI 服务'))
})

test('数据流自动排序忽略反馈边且长说明撑开卡片，纯节点不受样式污染',()=>{
  const d=sampleFor('dataflow');d.nodes.forEach(n=>delete n.order);d.nodes=d.nodes.filter(n=>n.kind!=='note')
  const scene=layoutDocument(d),source=scene.nodes.find(n=>n.node.id==='his')!,integration=scene.nodes.find(n=>n.node.id==='integration')!,analysis=scene.nodes.find(n=>n.node.id==='analysis')!,review=scene.nodes.find(n=>n.node.id==='review')!
  assert.ok(integration.y>source.y+source.height);assert.ok(analysis.y>integration.y+integration.height);assert.ok(review.y>analysis.y+analysis.height)
  const tall=sampleFor('dataflow');tall.nodes[0].description='非常长的系统说明'.repeat(45);const box=layoutDocument(tall).nodes[0]
  assert.ok(box.height>=cardMetrics(tall,tall.nodes[0],box.width).height)
  tall.nodes[0].description='<script>alert("x")</script>';assert.ok(!renderScene(layoutDocument(tall),tall).includes('<script>'))
  const invalid=copy(tall);invalid.presentation.cards!.his.icon='unsafe' as any;assert.throws(()=>validateDocument(invalid),/图标/)
  const mixed=copy(tall);(mixed.nodes[0] as any).icon='database';assert.throws(()=>validateDocument(mixed),/节点层/)
})

test('旧存档只补一次数据流示例，卡片编辑、删除、撤销与回流设置可持久化',()=>{
  const storage=new Map<string,string>(),key='flymind-drawing-studio-v1'
  storage.set(key,JSON.stringify({documents:[sampleFor('mindmap')],activeId:'sample-mindmap'}))
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>storage.get(k)||null,setItem:(k:string,v:string)=>storage.set(k,v)}})
  setActivePinia(createPinia());const s=useStudio();assert.equal(s.current.kind,'mindmap');assert.equal(s.documents.length,2);s.open('sample-dataflow')
  s.selection={type:'node',id:'his'};s.commit(d=>{d.nodes[0].description='新说明';d.presentation.cards!.his={icon:'check',tone:'teal'}})
  assert.equal(s.current.nodes[0].description,'新说明');s.undo();assert.equal(s.current.nodes[0].description,'患者  医嘱');s.redo()
  s.selection={type:'node',id:'his'};s.removeSelection();assert.equal(s.current.nodes.some(n=>n.id==='his'),false);assert.equal(s.current.presentation.cards!.his,undefined);assert.ok(!s.current.edges.some(e=>e.source==='his'))
  s.undo();assert.equal(s.current.presentation.cards!.his.icon,'check')
  s.commit(d=>{d.edges.find(e=>e.id==='confirm')!.kind='feedback'})
  assert.equal(JSON.parse(storage.get(key)!).documents.find((d:any)=>d.kind==='dataflow').edges.find((e:any)=>e.id==='confirm').kind,'feedback')
  s.deleteDocument('sample-dataflow');setActivePinia(createPinia());assert.equal(useStudio().documents.length,1)
})
