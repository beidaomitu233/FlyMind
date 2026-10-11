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
import { applyOperations } from '../src/drawing/core/operations'
import { duplicateNodes, placeNodes, alignNodes } from '../src/drawing/core/editor'
import { portPoint } from '../src/drawing/core/geometry'
import { computed, ref } from 'vue'
import { sharedWorkspace } from '../src/drawing/services/shared'
import { extractContent,validateContent,composeDocument,replaceContent,replaceRendering,projectDocument,applyContentOperations } from '../src/drawing/core/layers'

test('内容工具拒绝视觉字段；五类纯内容无需坐标、布局行或样式即可渲染',()=>{
  for(const source of samples){const content=extractContent(source),before=JSON.stringify(content),d=composeDocument(content),scene=layoutDocument(d)
    assert.equal(scene.nodes.length,content.nodes.length);assert.equal(JSON.stringify(content),before)
    assert.ok(!Object.hasOwn(content,'presentation'));assert.ok(content.nodes.every(n=>!Object.hasOwn(n,'order')))
    assert.deepEqual(d.presentation.positions,{})
    for(let i=0;i<scene.nodes.length;i++)for(let j=i+1;j<scene.nodes.length;j++){const a=scene.nodes[i],b=scene.nodes[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,`${source.kind}: ${a.node.id} / ${b.node.id} 重叠`)}
  }
  const c=extractContent(sampleFor('flowchart'))
  for(const field of ['order','x','y','width','height','shape','fontSize','icon']){const invalid=copy(c);(invalid.nodes[0] as any)[field]=1;assert.throws(()=>validateContent(invalid),/内容层/)}
  assert.throws(()=>validateContent({...c,presentation:{}}),/内容层/)
  const badEdge=copy(c);(badEdge.edges[0] as any).dashed=true;assert.throws(()=>validateContent(badEdge),/内容层/)
  assert.throws(()=>applyContentOperations(composeDocument(c),[{op:'set_node_presentation',id:c.nodes[0].id,position:{x:100}}]),/configure_rendering/)
})

test('旧图形迁移到两层，内容修改保留渲染，渲染标准修改保持业务关系不变',()=>{
  const old=sampleFor('flowchart') as any;old.nodes[0].order=3;old.edges[0].dashed=true;old.presentation.positions.f2={x:700,y:300}
  const migrated=validateDocument(old);assert.equal(migrated.presentation.ranks!.f1,3);assert.equal(migrated.presentation.edges![old.edges[0].id].dashed,true)
  assert.ok(!Object.hasOwn(migrated.nodes[0],'order'));assert.ok(!Object.hasOwn(migrated.edges[0],'dashed'))
  const content=extractContent(migrated);content.nodes[1].label='修改后的步骤'
  const changed=replaceContent(migrated,content);assert.deepEqual(changed.presentation,migrated.presentation)
  const configured=replaceRendering(changed,{...changed.presentation,nodeDefaults:{task:{width:260,height:110,shape:'ellipse',fontSize:22}},edgeDefaults:{route:'straight',dashed:true}})
  assert.deepEqual(extractContent(configured),extractContent(changed));assert.deepEqual(configured.presentation.positions.f2,{x:700,y:300})
  const scene=layoutDocument(configured),box=scene.nodes.find(n=>n.node.id==='f2')!
  assert.equal(box.width,260);assert.equal(box.height,110)
  const svg=renderScene(scene,configured);assert.ok(svg.includes('<ellipse'));assert.ok(svg.includes('stroke-dasharray="7 5"'));assert.ok(!scene.edges[0].path.includes(' H '))
  const project=projectDocument(configured);assert.equal(project.schemaVersion,2);assert.deepEqual(validateDocument(project),configured)
  assert.ok(!Object.hasOwn(project.content,'updatedAt'));assert.throws(()=>replaceRendering(changed,{nodes:[]}),/渲染层/)
  const invalid=copy(changed.presentation);invalid.styles={f1:{shape:'triangle' as any}};assert.throws(()=>replaceRendering(changed,invalid),/形状/)
  const arch=sampleFor('architecture') as any;arch.groups[0].tone='amber';const a=validateDocument(arch);assert.equal(a.presentation.groups!.app.tone,'amber');assert.ok(!Object.hasOwn(a.groups[0],'tone'))
})

test('渲染标准尺寸和长文字布局覆盖五类图形；自动布局清除手动排布而保留标准',()=>{
  for(const kind of ['flowchart','swimlane','mindmap','architecture','dataflow'] as const){const d=composeDocument(extractContent(sampleFor(kind))),type=d.nodes[0].kind;d.presentation.nodeDefaults={[type]:{width:420,height:180}};const scene=layoutDocument(d);assert.ok(scene.nodes[0].width>=420);assert.ok(scene.nodes[0].height>=180)}
  const d=composeDocument(extractContent(sampleFor('flowchart')));d.nodes[1].label='很长的任务内容，需要由渲染器自动换行和撑开节点。'.repeat(6);const s=layoutDocument(d),a=s.nodes.find(n=>n.node.id==='f2')!,b=s.nodes.find(n=>n.node.id==='f3')!;assert.ok(a.height>70);assert.ok(b.y>=a.y+a.height)
  d.presentation.nodeDefaults={task:{shape:'ellipse'}};d.presentation.positions.f2={x:900,y:20};d.presentation.ranks={f2:20};d.presentation.edges={fe0:{points:[{x:800,y:50}],dashed:true}}
  const reset=applyOperations(d,[{op:'reset_layout'}]);assert.deepEqual(reset.presentation.positions,{});assert.deepEqual(reset.presentation.ranks,{});assert.equal(reset.presentation.edges!.fe0.points,undefined);assert.equal(reset.presentation.edges!.fe0.dashed,true);assert.equal(reset.presentation.nodeDefaults!.task!.shape,'ellipse')
})

test('节点多选复制保留内部连线、样式和路径，调整尺寸后连线仍附着端口',()=>{
  const d=sampleFor('flowchart'),first=d.nodes[0],second=d.nodes[1]
  d.presentation.styles={[first.id]:{fill:'#eeeeff',fontSize:22}}
  d.presentation.edges={[d.edges[0].id]:{sourcePort:'right',targetPort:'left',points:[{x:400,y:220}],arrow:'both'}}
  const oldNodes=d.nodes.length,oldEdges=d.edges.length,scene=layoutDocument(d)
  const duplicated=duplicateNodes(d,scene,[first.id,second.id])
  assert.equal(d.nodes.length,oldNodes+2);assert.equal(d.edges.length,oldEdges+1)
  assert.deepEqual(d.presentation.styles[duplicated[0]],d.presentation.styles[first.id])
  assert.ok(d.edges.some(e=>e.source===duplicated[0]&&e.target===duplicated[1]))
  placeNodes(d,layoutDocument(d),{[first.id]:{x:80,y:90,width:280,height:120}})
  const resized=layoutDocument(d),node=resized.nodes.find(n=>n.node.id===first.id)!,edge=resized.edges.find(e=>e.edge.id===d.edges[0].id)!
  assert.equal(node.width,280);assert.deepEqual(edge.points![0],portPoint(node,'right'))
  alignNodes(d,resized,duplicated,'left');const aligned=layoutDocument(d).nodes.filter(n=>duplicated.includes(n.node.id))
  assert.equal(aligned[0].x,aligned[1].x);validateDocument(d)
})

test('分组删除必须迁移节点，重排保持业务归属，路径和配色校验独立于节点层',()=>{
  const d=sampleFor('swimlane'),before=JSON.stringify(d)
  assert.throws(()=>applyOperations(d,[{op:'remove_container',collection:'lanes',id:'customer'}]),/moveTo/)
  assert.equal(JSON.stringify(d),before)
  const migrated=applyOperations(d,[{op:'remove_container',collection:'lanes',id:'customer',moveTo:'bd'},{op:'reorder_container',collection:'lanes',id:'project',index:0}])
  assert.equal(migrated.nodes.find(n=>n.id==='request')!.laneId,'bd')
  assert.equal(migrated.lanes[0].id,'project');assert.equal(migrated.edges.length,d.edges.length)
  assert.throws(()=>applyOperations(d,[{op:'set_node_presentation',id:'request',style:{fill:'red'}}]),/#RRGGBB/)
  assert.throws(()=>applyOperations(d,[{op:'set_edge_presentation',id:d.edges[0].id,style:{points:[{x:NaN,y:4}]}}]),/路径点/)
  const styled=applyOperations(d,[{op:'set_node_presentation',id:'request',style:{fill:'#eeeeff',fontSize:24},position:{width:260}},{op:'set_edge_presentation',id:d.edges[0].id,style:{color:'#ff3366',arrow:'both',width:3}}])
  const svg=renderScene(layoutDocument(styled),styled)
  assert.ok(svg.includes('#ff3366'));assert.ok(svg.includes('marker-start'));assert.ok(svg.includes('font-size="24"'))
  assert.deepEqual(styled.nodes,d.nodes)
})

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
  const d=sampleFor('flowchart');d.presentation.ranks={};const scene=layoutDocument(d)
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
  assert.equal(JSON.parse(storage.get('flymind-drawing-studio-v1')!).documents[0].content.nodes[0].laneId,'bd')
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
  const d=sampleFor('dataflow');d.presentation.ranks={};d.nodes=d.nodes.filter(n=>n.kind!=='note')
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
  assert.equal(JSON.parse(storage.get(key)!).documents.find((d:any)=>d.content.kind==='dataflow').content.edges.find((e:any)=>e.id==='confirm').kind,'feedback')
  s.deleteDocument('sample-dataflow');setActivePinia(createPinia());assert.equal(useStudio().documents.length,1)
})

test('共享保存断网后不被轮询覆盖，重新加载保留未同步内容为副本',async()=>{
  const key='flymind-drawing-studio-v1',storage=new Map<string,string>(),originalFetch=globalThis.fetch
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>storage.get(k)||null,setItem:(k:string,v:string)=>storage.set(k,v)}})
  Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{hash:'#/',search:''}}})
  Object.defineProperty(globalThis,'document',{configurable:true,value:{activeElement:null}})
  const d=sampleFor('flowchart'),records=[{document:copy(d),revision:1,savedAt:Date.now()}];let offline=false
  globalThis.fetch=(async(_url:string,options:any)=>{
    if(offline)throw new Error('offline')
    if(options.method==='POST'){const doc=JSON.parse(options.body).document,r={document:doc,revision:1,savedAt:Date.now()};records.push(r);return Response.json(r,{status:201})}
    if(options.method==='GET')return Response.json(records)
    throw new Error('unexpected request')
  }) as any
  const context=()=>{const documents=ref([copy(d)]),activeId=ref(d.id);return {documents,activeId,current:computed(()=>documents.value.find(x=>x.id===activeId.value)!),storageError:ref(''),notify:()=>{},reset:()=>{}}}
  try {
    storage.set(key,JSON.stringify({documents:[d],activeId:d.id}));storage.set(key+'-shared-migrated','1')
    const ctx=context(),shared=sharedWorkspace(ctx);await shared.initialize()
    ctx.current.value.nodes[0].label='断网时的人工修改';offline=true;shared.save(ctx.current.value);await shared.retrySync()
    storage.set(key,JSON.stringify({documents:ctx.documents.value,activeId:ctx.activeId.value}))
    records[0].revision=2;records[0].document.nodes[0].label='AI 的另一个修改';offline=false
    await shared.refreshRemote();assert.equal(ctx.current.value.nodes[0].label,'断网时的人工修改')
    const recovered=context(),reloaded=sharedWorkspace(recovered);await reloaded.initialize()
    assert.equal(records.length,2)
    assert.equal(records[0].document.nodes[0].label,'AI 的另一个修改')
    assert.equal(records[1].document.nodes[0].label,'断网时的人工修改')
    assert.equal(recovered.current.value.nodes[0].label,'断网时的人工修改')
    assert.ok(recovered.current.value.title.endsWith('本地存档'))
  }finally{globalThis.fetch=originalFetch}
})

test('显式编辑链接加载未知图形，输入焦点不阻止导航且保留已有人工内容',async()=>{
  const originalFetch=globalThis.fetch,storage=new Map<string,string>()
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>storage.get(k)||null,setItem:(k:string,v:string)=>storage.set(k,v)}})
  Object.defineProperty(globalThis,'document',{configurable:true,value:{activeElement:{closest:()=>true}}})
  const local=sampleFor('flowchart'),incoming=sampleFor('mindmap');local.nodes[0].label='尚未保存的人工文字'
  const documents=ref([local]),activeId=ref(local.id),calls:string[]=[]
  globalThis.fetch=(async(url:string)=>{calls.push(url);return Response.json({document:incoming,revision:7,savedAt:1})}) as any
  try{
    const shared=sharedWorkspace({documents,activeId,current:computed(()=>documents.value.find(d=>d.id===activeId.value)!),storageError:ref(''),notify:()=>{},reset:()=>{}})
    assert.equal(await shared.ensureDocument(incoming.id),true);assert.equal(shared.revisions.value[incoming.id],7)
    assert.equal(documents.value[0].nodes[0].label,'尚未保存的人工文字');assert.equal(activeId.value,local.id)
    assert.equal(await shared.ensureDocument(incoming.id),true);assert.equal(calls.length,1)
  }finally{globalThis.fetch=originalFetch;Object.defineProperty(globalThis,'document',{configurable:true,value:{activeElement:null}})}
})
