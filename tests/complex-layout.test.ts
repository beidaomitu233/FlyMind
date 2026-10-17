import {test} from 'node:test'
import assert from 'node:assert/strict'
import {copy,validateDocument,type DiagramDocument} from '../src/drawing/core/model'
import {layoutDocument} from '../src/drawing/core/layout'
import {extractContent,composeDocument} from '../src/drawing/core/layers'
import {intersectsBox,segmentHitsBox} from '../src/drawing/core/routing'
import {renderScene,renderDrawio} from '../src/drawing/core/render'
import {byCreationNewest} from '../src/drawing/core/metadata'
import {wrapText} from '../src/drawing/core/text'
import {automaticRanks} from '../src/drawing/core/auto-layout'
import {layoutSwimlane} from '../src/drawing/core/swimlane-layout'
import {pinScene,placeNodes} from '../src/drawing/core/editor'

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

for(const orientation of ['vertical','horizontal'] as const)test(`泳道 ${orientation}：跨角色前置逐级推进，独立分支同排，汇合后置`,()=>{
  const d=complex();d.presentation.orientation=orientation
  const before=extractContent(d),s=layoutSwimlane(d),byId=new Map(s.nodes.map(n=>[n.node.id,n]))
  const step=(id:string)=>{const n=byId.get(id)!;return orientation==='vertical'?n.y+n.height/2:n.x+n.width/2}
  assert.equal(step('accept'),step('accept2'),'共同前置的独立分支应可同排')
  assert.ok(step('accept')>step('assign'),'角色交接不能挤在前置节点同排')
  for(const e of d.edges.filter(e=>e.kind!=='feedback')){
    const a=byId.get(e.source)!,b=byId.get(e.target)!
    assert.ok(orientation==='vertical'?b.y>a.y+a.height:b.x>a.x+a.width,e.id+' 必须在前置节点之后')
  }
  assert.deepEqual(extractContent(d),before,'自动排序不能补写描述或更改业务关系')
})

test('泳道排序与节点/连线 JSON 数组顺序无关，反馈不影响主流程行',()=>{
  const d=complex(),members=d.nodes.filter(n=>n.phaseId==='review'),expected=automaticRanks(d,members,true)
  const reordered=copy(d);reordered.nodes.reverse();reordered.edges.reverse()
  const actual=automaticRanks(reordered,reordered.nodes.filter(n=>n.phaseId==='review'),true)
  assert.deepEqual([...actual].sort(),[...expected].sort())
  const forward=copy(d);forward.edges=forward.edges.filter(e=>e.kind!=='feedback')
  assert.deepEqual([...automaticRanks(forward,members,true)].sort(),[...expected].sort())
  assert.deepEqual(['data','archive','write','review','pass','final'].map(id=>expected.get(id)),[0,1,2,3,4,5])
})

test('泳道同角色分支错行后，汇合继续等待全部前置，不被旧行覆盖压平',()=>{
  const d=composeDocument({title:'同角色并行任务',kind:'swimlane',lanes:[{id:'a',label:'甲'},{id:'b',label:'乙'}],nodes:[
    {id:'start',label:'开始',kind:'start',laneId:'a'},
    {id:'one',label:'任务一',kind:'task',laneId:'b'},
    {id:'two',label:'任务二',kind:'task',laneId:'b'},
    {id:'join',label:'汇合',kind:'end',laneId:'a'}],
    edges:[['start','one'],['start','two'],['one','join'],['two','join']].map(([source,target],i)=>({id:'e'+i,source,target}))})
  d.presentation.ranks={join:0}
  const ranks=automaticRanks(d,d.nodes,true)
  assert.notEqual(ranks.get('one'),ranks.get('two'))
  assert.ok(ranks.get('join')!>Math.max(ranks.get('one')!,ranks.get('two')!))
})

test('旧泳道未标记循环从实际阶段入口展开，置乱数组后结果稳定且不丢节点边',()=>{
  const d=composeDocument({title:'旧循环兼容',kind:'swimlane',lanes:[{id:'customer',label:'客户'},{id:'pm',label:'产品经理'}],phases:[{id:'before',label:'导入'},{id:'review',label:'评审'}],nodes:[
    {id:'entry',label:'导入',kind:'start',laneId:'pm',phaseId:'before'},
    {id:'agree',label:'是否确认',kind:'decision',laneId:'customer',phaseId:'review'},
    {id:'propose',label:'沟通方案',kind:'task',laneId:'pm',phaseId:'review'},
    {id:'revise',label:'修改方案',kind:'task',laneId:'pm',phaseId:'review'}],
    edges:[['entry','propose'],['propose','agree'],['agree','revise'],['revise','propose']].map(([source,target],i)=>({id:'e'+i,source,target}))})
  const ranks=automaticRanks(d,d.nodes.filter(n=>n.phaseId==='review'),true)
  assert.deepEqual(['propose','agree','revise'].map(id=>ranks.get(id)),[0,1,2])
  d.nodes.reverse();d.edges.reverse()
  assert.deepEqual([...automaticRanks(d,d.nodes.filter(n=>n.phaseId==='review'),true)].sort(),[...ranks].sort())
  const scene=layoutSwimlane(d);assert.equal(scene.nodes.length,4);assert.equal(d.edges.length,4)
})

test('长文字增宽并保持判断菱形比例，中文标点不单独落到下一行',()=>{
  const d=complex(),s=layoutDocument(d)
  assert.ok(s.nodes.find(n=>n.node.id==='write')!.width>168)
  for(const n of s.nodes.filter(n=>n.node.kind==='decision'))assert.ok(n.height>=n.width*.6)
  assert.ok(wrapText('是否完成任务？',6).every(line=>!/^？/.test(line)))
})

for(const orientation of ['vertical','horizontal'] as const)test(`手动泳道 ${orientation}：阶段栏包住实际节点，旧行号和独立文字不生成幽灵空行`,()=>{
  const d=complex();d.presentation.orientation=orientation
  const before=layoutDocument(d),axis=orientation==='vertical'?'y':'x',extent=orientation==='vertical'?'height':'width'
  pinScene(d,before)
  d.presentation.ranks={write:190,ready:170,done:199}
  const note={id:'independent',label:'旁注',kind:'note' as const,laneId:'pm',phaseId:'intake'}
  d.nodes.push(note);d.presentation.positions[note.id]={x:orientation==='vertical'?1300:330,y:orientation==='vertical'?330:1300,width:80,height:60};d.presentation.ranks[note.id]=200
  const data=JSON.stringify(d),s=layoutDocument(d),phases=s.containers.filter(c=>c.kind==='phase')
  assert.equal(JSON.stringify(d),data)
  for(const n of before.nodes){const now=s.nodes.find(m=>m.node.id===n.node.id)!;assert.deepEqual([now.x,now.y,now.width,now.height],[n.x,n.y,n.width,n.height]);const ph=phases.find(c=>c.id===n.node.phaseId)!;assert.ok(now[axis]>=ph[axis]&&now[axis]+now[extent]<=ph[axis]+ph[extent],n.node.id+' 错位到其他阶段')}
  phases.slice(1).forEach((ph,i)=>assert.equal(ph[axis],phases[i][axis]+phases[i][extent]))
  assert.ok(s[extent]<=before[extent],'旧行号不能撑长固定节点的阶段栏')
  const stable=s[extent]
  for(let i=0;i<5;i++){pinScene(d,layoutDocument(d));assert.equal(layoutDocument(d)[extent],stable,'编辑固定位置后阶段栏发生漂移')}
})

test('泳道稀疏旧行号只决定排序，不为缺号分配空行，末行后只保留边距',()=>{
  const d=composeDocument({title:'稀疏旧行',kind:'swimlane',lanes:[{id:'a',label:'甲'}],nodes:[{id:'one',label:'一',kind:'task',laneId:'a'},{id:'two',label:'二',kind:'task',laneId:'a'}],edges:[{id:'e',source:'one',target:'two'}]})
  d.presentation.ranks={one:100,two:200}
  const s=layoutSwimlane(d),last=s.nodes.find(n=>n.node.id==='two')!,ph=s.containers.find(c=>c.kind==='phase')!
  const padding=ph.y+ph.height-last.y-last.height
  assert.ok(s.height<700);assert.ok(padding>=36&&padding<=40)
})

for(const orientation of ['vertical','horizontal'] as const)test(`泳道 ${orientation}：表头左上角为完整色块，SVG 与 draw.io 均保留`,()=>{
  const d=complex();d.presentation.orientation=orientation;const s=layoutDocument(d)
  const corner=s.containers.find(c=>c.kind==='corner')!,phase=s.containers.find(c=>c.kind==='phase')!,lane=s.containers.find(c=>c.kind==='lane')!
  assert.equal(corner.x,40);assert.equal(corner.y,88)
  assert.equal(corner.width,orientation==='vertical'?lane.x-corner.x:phase.x-corner.x)
  assert.equal(corner.height,orientation==='vertical'?phase.y-corner.y:lane.y-corner.y)
  assert.match(renderScene(s,d),/<g data-container-id="swimlane-corner"><rect[^>]+fill="#596fea"/)
  assert.match(renderDrawio(s,d),/id="c-swimlane-corner"[^>]+fillColor=#596fea/)
})

test('拖动不再写入估算行号，跨阶段按当前真实边界归属；只缩放不误改角色或阶段',()=>{
  const d=complex(),s=layoutDocument(d);pinScene(d,s);d.presentation.ranks={write:180}
  const write=s.nodes.find(n=>n.node.id==='write')!,phase=s.containers.find(c=>c.id==='delivery'&&c.kind==='phase')!
  placeNodes(d,s,{write:{x:write.x,y:write.y,height:write.height+120}})
  assert.equal(d.nodes.find(n=>n.id==='write')!.phaseId,'review');assert.equal(d.presentation.ranks.write,undefined)
  placeNodes(d,s,{write:{x:write.x,y:phase.y+45}})
  assert.equal(d.nodes.find(n=>n.id==='write')!.phaseId,'delivery');assert.equal(d.presentation.ranks.write,undefined)
})

test('创建时间排序独立于修改时间，工作区保存元数据而内容层保持纯语义',()=>{
  const a=complex(),b=copy(a);a.id='old';a.createdAt=100;a.updatedAt=10000;b.id='new';b.createdAt=200;b.updatedAt=200
  assert.deepEqual([a,b].sort(byCreationNewest).map(d=>d.id),['new','old']);assert.ok(!Object.hasOwn(extractContent(a),'createdAt'))
})
