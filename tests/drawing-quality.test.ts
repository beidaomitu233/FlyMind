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
  next.nodes[1].label='核验申请材料';assert.doesNotThrow(()=>requireDrawingQuality(next,before))
  const description=copy(before);description.nodes[1].description='这里应当先补充审核逻辑';assert.throws(()=>requireDrawingQuality(description,before),/只修改了说明文字/)
})
test('历史问题允许逐步改善，新增或加重不合格项仍阻止',()=>{
  const before=sampleFor('flowchart');before.nodes[0].label='旧图长标题'.repeat(12);const next=copy(before);next.nodes[1].label='核验申请';assert.doesNotThrow(()=>requireDrawingQuality(next,before));next.nodes[0].label+='更多内容';assert.throws(()=>requireDrawingQuality(next,before));next.nodes[0].label='旧图长标题'.repeat(10);assert.doesNotThrow(()=>requireDrawingQuality(next,before))
})
