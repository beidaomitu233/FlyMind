import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sampleFor,samples} from '../src/drawing/core/samples'
import {copy} from '../src/drawing/core/model'
import {inspectDrawing,requireDrawingQuality,DrawingQualityError} from '../src/drawing/core/drawing-quality'

test('五类标准示例满足内容标准；检查完全不依赖渲染层',()=>{
  for(const source of samples){const d=copy(source),before=JSON.stringify(d);assert.equal(inspectDrawing(d).passed,true);assert.equal(inspectDrawing(d).score,100);d.presentation.positions={};d.presentation.nodeDefaults={task:{width:900,height:500}};assert.deepEqual(inspectDrawing(d),inspectDrawing(source));assert.equal(JSON.stringify(source),before)}
})
test('流程和泳道：拒绝段落标题、孤立片段、判断缺失出口和重复条件',()=>{
  const only=sampleFor('flowchart');only.nodes=[{id:'judge',kind:'decision',label:'是否通过'}];only.edges=[];assert.ok(inspectDrawing(only).issues.some(i=>i.code==='decision_exits'));only.nodes=[{id:'note',kind:'note',label:'只有解释'}];assert.equal(inspectDrawing(only).passed,false)
  for(const kind of ['flowchart','swimlane'] as const){const d=sampleFor(kind);d.nodes[0].label='这是一个很长的步骤解释说明，不能把整段操作手册直接放进流程节点当作标题。'.repeat(3);assert.throws(()=>requireDrawingQuality(d),DrawingQualityError)
    const broken=sampleFor(kind),decision=broken.nodes.find(n=>n.kind==='decision')!;broken.edges=broken.edges.filter(e=>e.source!==decision.id);assert.ok(inspectDrawing(broken).issues.some(i=>i.code==='decision_exits'));assert.throws(()=>requireDrawingQuality(broken))
    const labels=sampleFor(kind),choice=labels.nodes.find(n=>n.kind==='decision')!;labels.edges.filter(e=>e.source===choice.id).forEach(e=>e.label='条件');assert.ok(inspectDrawing(labels).issues.some(i=>i.code==='decision_conditions'))
  }
})
test('架构/思维/数据流按各自语义检查，架构不强加流程箭头',()=>{
  const arch=sampleFor('architecture');arch.edges=[];assert.equal(inspectDrawing(arch).passed,true);arch.nodes[0].items=Array.from({length:13},(_,i)=>'能力'+i);assert.ok(inspectDrawing(arch).issues.some(i=>i.code==='too_many_items'))
  const mind=sampleFor('mindmap');mind.nodes[1].kind='task';assert.ok(inspectDrawing(mind).issues.some(i=>i.code==='node_type'))
  const data=sampleFor('dataflow');data.nodes[0].description='长正文'.repeat(100);assert.ok(inspectDrawing(data).issues.some(i=>i.code==='long_description'));data.edges=[];assert.ok(inspectDrawing(data).issues.some(i=>i.code==='disconnected_process'))
})
test('改流程不能只加注释；明确批注可通过；真实节点文字修改仍支持',()=>{
  const before=sampleFor('flowchart'),next=copy(before);next.nodes.push({id:'explanation',label:'应该先审核后归档',kind:'note'})
  assert.throws(()=>requireDrawingQuality(next,before),/只修改了说明文字/);assert.throws(()=>requireDrawingQuality(next,before,'wording'),/只修改了说明文字/);assert.doesNotThrow(()=>requireDrawingQuality(next,before,'annotation'))
  next.nodes[1].label='核验申请材料';assert.throws(()=>requireDrawingQuality(next,before),/只修改了说明文字/);next.nodes=next.nodes.filter(n=>n.id!=='explanation');assert.doesNotThrow(()=>requireDrawingQuality(next,before))
  const description=copy(before);description.nodes[1].description='这里应当先补充审核逻辑';assert.throws(()=>requireDrawingQuality(description,before),/只修改了说明文字/)
})
test('历史问题允许逐步改善，新增或加重不合格项仍阻止',()=>{
  const before=sampleFor('flowchart');before.nodes[0].label='旧图长标题'.repeat(12);const next=copy(before);next.nodes[1].label='核验申请';assert.doesNotThrow(()=>requireDrawingQuality(next,before));next.nodes[0].label+='更多内容';assert.throws(()=>requireDrawingQuality(next,before));next.nodes[0].label='旧图长标题'.repeat(10);assert.doesNotThrow(()=>requireDrawingQuality(next,before))
})

test('1.1 各类型字段和所有可见字段都受预算约束，不能借items/badge/note藏长说明',()=>{
  const flow=sampleFor('flowchart'),node=flow.nodes.find(n=>n.kind==='task')!
  node.items=['把整个方案塞进条目'];node.badge='说明';node.description='甲'.repeat(121)
  const codes=inspectDrawing(flow).issues.map(i=>i.code)
  assert.ok(codes.includes('node_field_items'));assert.ok(codes.includes('node_field_badge'));assert.ok(codes.includes('long_description'))
  const note=sampleFor('flowchart');note.nodes.push({id:'long-note',kind:'note',label:'甲'.repeat(81)})
  assert.ok(inspectDrawing(note).issues.some(i=>i.code==='long_annotation'&&i.nodeId==='long-note'))
  note.nodes=note.nodes.filter(n=>n.kind!=='note');for(let i=0;i<5;i++)note.nodes.push({id:'note-'+i,kind:'note',label:'短说明'})
  assert.ok(inspectDrawing(note).issues.some(i=>i.code==='excessive_annotations'&&i.severity==='error'))
  const arch=sampleFor('architecture');arch.nodes[0].badge='甲'.repeat(13);assert.ok(inspectDrawing(arch).issues.some(i=>i.code==='long_badge'))
})

test('1.1 流程入口、结果和方向可达；正确任务入口泳道无需强造start/end',()=>{
  const flow=sampleFor('flowchart');flow.nodes.find(n=>n.kind==='start')!.kind='task'
  assert.ok(inspectDrawing(flow).issues.some(i=>i.code==='process_entry_missing'))
  const dead=sampleFor('flowchart');dead.nodes.push({id:'dead',kind:'task',label:'核对订单'});dead.edges.push({id:'dead-in',source:'f2',target:'dead'})
  assert.ok(inspectDrawing(dead).issues.some(i=>i.code==='no_result_path'&&i.nodeId==='dead'))
  const wrong=sampleFor('flowchart');wrong.nodes.push({id:'orphan-input',kind:'task',label:'核对订单'});wrong.edges.push({id:'wrong-direction',source:'orphan-input',target:'f2'})
  assert.ok(inspectDrawing(wrong).issues.some(i=>i.code==='unreachable_step'&&i.nodeId==='orphan-input'))
  const swim=sampleFor('swimlane');assert.equal(swim.nodes[0].kind,'task');assert.equal(inspectDrawing(swim).passed,true)
  const noEnd=sampleFor('swimlane');for(const n of noEnd.nodes)if(n.kind==='end'){n.kind='task';n.label='完成交付'}assert.equal(inspectDrawing(noEnd).passed,true)
})

test('1.1 组件不是动作，但真实技术动作和架构依赖箭头不会误伤',()=>{
  const flow=sampleFor('flowchart'),node=flow.nodes.find(n=>n.kind==='task')!
  node.label='Redis 7.0';assert.ok(inspectDrawing(flow).issues.some(i=>i.code==='component_as_task'&&i.nodeId===node.id))
  for(const label of ['检查 Redis 缓存','用户登录','等待30秒','重试3次']){node.label=label;assert.equal(inspectDrawing(flow).issues.some(i=>i.code==='component_as_task'||i.code==='specification_as_step'),false)}
  node.label='QPS >= 1000';assert.ok(inspectDrawing(flow).issues.some(i=>i.code==='specification_as_step'));node.label='性能预算：QPS 1000';assert.ok(inspectDrawing(flow).issues.some(i=>i.code==='specification_as_step'))
  const arch=sampleFor('architecture');assert.ok(arch.edges.length);assert.equal(inspectDrawing(arch).passed,true);arch.edges=[];assert.equal(inspectDrawing(arch).passed,true)
})

test('1.1 脑图单链分类合法，明确顺序步骤不能伪装主题树；数据流不套流程起终点',()=>{
  const mind=sampleFor('mindmap');mind.nodes=[{id:'r',kind:'topic',label:'生物分类'},{id:'a',kind:'topic',label:'哺乳动物',parentId:'r'},{id:'b',kind:'topic',label:'灵长目',parentId:'a'}]
  assert.equal(inspectDrawing(mind).passed,true)
  mind.nodes[1].label='步骤1：提交申请';mind.nodes[2].label='步骤2：审核申请'
  assert.ok(inspectDrawing(mind).issues.some(i=>i.code==='process_as_mindmap'))
  assert.equal(inspectDrawing(sampleFor('dataflow')).passed,true)
})

test('1.1 legacy与native共享warning非回退；微改容器名也不能掩盖新批注',()=>{
  const before=sampleFor('swimlane'),next=copy(before);next.nodes.push({id:'explanation',kind:'note',label:'新增处理规则'});next.lanes[0].label+='方'
  assert.throws(()=>requireDrawingQuality(next,before),/只修改了说明文字/)
  const edgeWording=copy(before);edgeWording.nodes.push({id:'annotation',kind:'note',label:'新增规则说明'});edgeWording.edges[0].label='继续处理';assert.throws(()=>requireDrawingQuality(edgeWording,before),/只修改了说明文字/);assert.doesNotThrow(()=>requireDrawingQuality(edgeWording,before,'annotation'))
  const long=copy(before);long.nodes[0].label='甲'.repeat(20);assert.throws(()=>requireDrawingQuality(long,before),DrawingQualityError)
  const worse=copy(long);worse.nodes[0].label='甲'.repeat(22);assert.throws(()=>requireDrawingQuality(worse,long),DrawingQualityError)
  const preserved=copy(long);preserved.nodes[1].label='核验需求';assert.doesNotThrow(()=>requireDrawingQuality(preserved,long))
})
