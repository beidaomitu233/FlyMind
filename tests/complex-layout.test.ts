import {test} from 'node:test'
import assert from 'node:assert/strict'
import {copy,validateDocument,type DiagramDocument} from '../src/drawing/core/model'
import {layoutDocument} from '../src/drawing/core/layout'
import {extractContent,composeDocument} from '../src/drawing/core/layers'
import {intersectsBox,segmentHitsBox} from '../src/drawing/core/routing'
import {renderScene,renderDrawio} from '../src/drawing/core/render'
import {byCreationNewest} from '../src/drawing/core/metadata'
import {wrapText} from '../src/drawing/core/text'

function complex():DiagramDocument{
  return composeDocument({id:'complex',title:'多部门协作与异常回流',kind:'swimlane',
    lanes:['client','pm','writer','review','delivery'].map(id=>({id,label:id})),phases:['intake','review','delivery'].map(id=>({id,label:id})),
    nodes:[
      {id:'assign',label:'根据已确认的服务范围分配处理任务\n【项目管理】',kind:'start',laneId:'pm',phaseId:'intake'},
      {id:'accept',label:'是否签收资料处理任务？',kind:'decision',laneId:'writer',phaseId:'intake'},
      {id:'accept2',label:'是否签收交付任务？',kind:'decision',laneId:'delivery',phaseId:'intake'},
      {id:'data',label:'提供／补充审核所需的业务材料',kind:'task',laneId:'client',phaseId:'review'},
      {id:'archive',label:'核对档案、材料与历史记录\n【档案管理】',kind:'task',laneId:'pm',phaseId:'review'},
      {id:'write',label:'撰写、修改并保存多个资料版本\n【资料处理／档案归档】',kind:'task',laneId:'writer',phaseId:'review'},
      {id:'review',label:'审阅正文并填写审核意见\n【专业审核】',kind:'task',laneId:'review',phaseId:'review'},
      {id:'pass',label:'审核是否通过并完成确认？',kind:'decision',laneId:'review',phaseId:'review'},
      {id:'final',label:'定稿并归档业务资产\n【资料处理／档案归档】',kind:'task',laneId:'writer',phaseId:'review'},
      {id:'ready',label:'全部材料齐备且\n所需资料已完成定稿？',kind:'decision',laneId:'delivery',phaseId:'delivery'},
      {id:'more',label:'协调相关人员补充缺失材料',kind:'task',laneId:'pm',phaseId:'delivery'},
      {id:'submit',label:'提交并记录外部平台回执\n【交付管理】',kind:'task',laneId:'delivery',phaseId:'delivery'},
      {id:'ok',label:'是否提交成功？',kind:'decision',laneId:'delivery',phaseId:'delivery'},
      {id:'done',label:'确认本次交付结果并完成归档',kind:'end',laneId:'pm',phaseId:'delivery'}],
    edges:[['assign','accept','包含资料服务'],['assign','accept2','包含交付服务'],['accept','assign','退回：重新分配','feedback'],['accept2','assign','退回：重新分配','feedback'],['data','archive',''],['archive','write','读取档案与历史资产'],['accept','write','签收'],['write','review','提交审核'],['review','pass',''],['pass','write','驳回并重新修改','feedback'],['pass','final','通过'],['final','ready','定稿已可用'],['accept2','ready','签收'],['archive','ready','材料已可用'],['ready','more','否'],['more','data','补充业务材料','feedback'],['more','write','资料待完善','feedback'],['ready','submit','是'],['submit','ok',''],['ok','submit','否：修正后重试','feedback'],['ok','done','是']].map(([source,target,label,kind],i)=>({id:'e'+i,source,target,label, ...(kind?{kind}:{})}))})
}

for(const orientation of ['vertical','horizontal'] as const)test(`复杂泳道 ${orientation}：长文、反馈、标签避让及内容层不变`,()=>{
  const d=complex();d.presentation.orientation=orientation;const before=JSON.stringify(d),s=layoutDocument(d)
  assert.equal(JSON.stringify(d),before);assert.equal(s.edges.length,d.edges.length)
  for(const [i,n] of s.nodes.entries()){assert.ok(s.nodes.slice(i+1).every(m=>!intersectsBox(n,m)),n.node.id+' 与其他节点重叠');assert.ok(s.containers.some(c=>c.id===n.node.phaseId&&(orientation==='vertical'?n.y>=c.y&&n.y+n.height<=c.y+c.height:n.x>=c.x&&n.x+n.width<=c.x+c.width)))}
  const labels=s.edges.filter(e=>e.labelBox)
  for(const [i,e] of labels.entries()){assert.ok(!s.nodes.some(n=>intersectsBox(e.labelBox!,n)),e.edge.id+' 标签压住节点');assert.ok(!labels.slice(i+1).some(f=>intersectsBox(e.labelBox!,f.labelBox!)),e.edge.id+' 标签重叠')}
  for(const e of s.edges)for(let i=1;i<e.points!.length;i++)for(const n of s.nodes){if(i===1&&n.node.id===e.edge.source||i===e.points!.length-1&&n.node.id===e.edge.target)continue;assert.ok(!segmentHitsBox(e.points![i-1],e.points![i],n),e.edge.id+' 穿过 '+n.node.id)}
  assert.ok(renderScene(s,d).includes('data-label-id'));assert.ok(renderDrawio(s,d).includes('<mxfile'))
  assert.deepEqual(extractContent(validateDocument(d)),extractContent(d))
})

test('长文字增宽并保持判断菱形比例，中文标点不单独落到下一行',()=>{
  const d=complex(),s=layoutDocument(d)
  assert.ok(s.nodes.find(n=>n.node.id==='write')!.width>168)
  for(const n of s.nodes.filter(n=>n.node.kind==='decision'))assert.ok(n.height>=n.width*.6)
  assert.ok(wrapText('是否完成任务？',6).every(line=>!/^？/.test(line)))
})

test('创建时间排序独立于修改时间，工作区保存元数据而内容层保持纯语义',()=>{
  const a=complex(),b=copy(a);a.id='old';a.createdAt=100;a.updatedAt=10000;b.id='new';b.createdAt=200;b.updatedAt=200
  assert.deepEqual([a,b].sort(byCreationNewest).map(d=>d.id),['new','old']);assert.ok(!Object.hasOwn(extractContent(a),'createdAt'))
})
