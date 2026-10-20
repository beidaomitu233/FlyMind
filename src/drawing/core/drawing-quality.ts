import type {DiagramContent,DiagramNode} from './model'

export const DRAWING_STANDARD_VERSION='1.1'
export type EditIntent='structure'|'wording'|'annotation'
export interface QualityIssue {code:string;severity:'error'|'warning';message:string;nodeId?:string;edgeId?:string;actual?:number;limit?:number}
export interface DrawingQuality {standardVersion:string;passed:boolean;score:number;issues:QualityIssue[]}
const semantic=(d:DiagramContent)=>({kind:d.kind,nodes:d.nodes.filter(n=>n.kind!=='note').map(n=>({...n,...(d.kind!=='dataflow'?{description:undefined}:{})})).sort((a,b)=>a.id.localeCompare(b.id)),edges:d.edges.filter(e=>d.nodes.some(n=>n.id===e.source&&n.kind!=='note')&&d.nodes.some(n=>n.id===e.target&&n.kind!=='note')).slice().sort((a,b)=>a.id.localeCompare(b.id)),lanes:d.lanes,phases:d.phases,groups:d.groups})
const annotations=(d:DiagramContent)=>({notes:d.nodes.filter(n=>n.kind==='note'),edges:d.edges.filter(e=>d.nodes.some(n=>n.kind==='note'&&(n.id===e.source||n.id===e.target))),descriptions:d.kind==='dataflow'?[]:d.nodes.filter(n=>n.kind!=='note').map(n=>({id:n.id,description:n.description})).sort((a,b)=>a.id.localeCompare(b.id))})
function stable(v:any):any{return Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v}
const json=(v:unknown)=>JSON.stringify(stable(v))
const cap=(s:string,cn:number,en:number)=>/[\u3400-\u9fff]/.test(s)?cn:en
const topology=(d:DiagramContent)=>({kind:d.kind,nodes:d.nodes.filter(n=>n.kind!=='note').map(({id,kind,laneId,phaseId,groupId,parentId})=>({id,kind,laneId,phaseId,groupId,parentId})).sort((a,b)=>a.id.localeCompare(b.id)),edges:d.edges.filter(e=>d.nodes.some(n=>n.kind!=='note'&&n.id===e.source)&&d.nodes.some(n=>n.kind!=='note'&&n.id===e.target)).map(({source,target,kind})=>({source,target,kind:kind??'flow'})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),lanes:d.lanes.map(({id})=>({id})),phases:d.phases.map(({id})=>({id})),groups:d.groups.map(({id})=>({id}))})
const addedAnnotations=(next:DiagramContent,before:DiagramContent)=>next.nodes.some(n=>n.kind==='note'&&json(n)!==json(before.nodes.find(old=>old.id===n.id)))||next.nodes.some(n=>n.kind!=='note'&&n.description&&n.description!==before.nodes.find(old=>old.id===n.id)?.description&&next.kind!=='dataflow')
const length=(value:string)=>[...value].length
const componentName=/^(?:redis|mysql|postgresql|mongodb|nginx|kafka|rabbitmq|elasticsearch|docker|kubernetes|k8s|spring\s*boot|api(?:网关)?|数据库|消息队列|负载均衡器)(?:\s*v?\d+(?:\.\d+)*)?$/i
const outcome=/完成|归档|结束|交付|关闭|终止|结果|报告|落地|complete|done|result|report/i

// Semantic checks only: no positions, font sizes, line routing or other rendering inputs.
export function inspectDrawing(d:DiagramContent):DrawingQuality {
  const issues:QualityIssue[]=[],nodes=d.nodes.filter(n=>n.kind!=='note'),ids=new Set(nodes.map(n=>n.id)),edges=d.edges.filter(e=>ids.has(e.source)&&ids.has(e.target))
  const issue=(code:string,severity:QualityIssue['severity'],message:string,n?:DiagramNode,actual?:number,limit?:number)=>issues.push({code,severity,message,...(n?{nodeId:n.id}:{}),...(actual!==undefined?{actual}:{}),...(limit!==undefined?{limit}:{})})
  if(!nodes.length)issue('no_business_nodes','error','图形只有说明文字，没有业务节点；请绘制实际流程、模块或主题')
  const allowed=d.kind==='architecture'?['module']:d.kind==='mindmap'?['topic']:d.kind==='dataflow'?['card']:['start','end','task','decision']
  const process=d.kind==='flowchart'||d.kind==='swimlane'
  for(const collection of ['lanes','phases','groups'] as const){
    if(d[collection].length&&(collection==='groups'?d.kind!=='architecture':d.kind!=='swimlane'))issue('unused_'+collection,'error','此图形类型不使用该业务容器；请选择正确图形类型，不将容器当说明框',undefined,d[collection].length,0)
  }
  for(const n of d.nodes){
    const allowedFields=['id','label','kind','color','description',...(n.kind==='note'?[]:d.kind==='architecture'?['groupId','items','badge']:d.kind==='swimlane'?['laneId','phaseId']:d.kind==='mindmap'?['parentId']:d.kind==='dataflow'?['badge']:[])]
    const forbidden=Object.keys(n).filter(field=>!allowedFields.includes(field)&&(n as unknown as Record<string,unknown>)[field]!==undefined)
    for(const field of forbidden)issue('node_field_'+field,'error','该类型不使用 '+field+'；不要借其他类型字段存放步骤或说明',n,length(JSON.stringify((n as unknown as Record<string,unknown>)[field])),0)
    const descriptionLimit=n.kind==='note'?120:process?120:d.kind==='mindmap'?120:240
    const descriptionRecommended=process?80:120
    if(n.description&&length(n.description)>descriptionLimit)issue('long_description','error','备注过长；只保留节点必要属性，方案、参数预算和解释留在对话或资料中',n,length(n.description),descriptionLimit)
    else if(n.description&&length(n.description)>descriptionRecommended)issue('wordy_description','warning','备注应为短属性，不承载多个步骤或整段方案',n,length(n.description),descriptionRecommended)
    if(n.badge&&length(n.badge)>cap(n.badge,12,30))issue('long_badge','error','标记只保留短状态或版本，不放说明段落',n,length(n.badge),cap(n.badge,12,30))
    const visible=length(n.label)+length(n.description??'')+(n.items??[]).reduce((sum,item)=>sum+length(item),0)+length(n.badge??'')
    const visibleLimit=n.kind==='note'?200:d.kind==='architecture'?480:d.kind==='dataflow'?300:160
    if(visible>visibleLimit)issue('node_text_budget','error','节点文字总量超限；不能拆到多个字段绕过简洁要求，应按真实职责拆分或分图',n,visible,visibleLimit)
    if(n.kind==='note'){
      if(length(n.label)>cap(n.label,80,240))issue('long_annotation','error','批注过长；详细解释留在对话或来源文档',n,length(n.label),cap(n.label,80,240))
      continue
    }
    if(!allowed.includes(n.kind))issue('node_type','error',`${d.kind} 不使用 ${n.kind} 业务节点，请选择该图形的语义类型`,n)
    const titleLength=length(n.label.trim()),short=n.kind==='start'||n.kind==='end',recommended=cap(n.label,short?12:18,short?36:64),hard=cap(n.label,short||process?24:32,short?72:process?80:110)
    if(titleLength>hard)issue('long_label','error',`标题过长：保留一个动作、问题或概念；必要短属性可用 description，详细解释与参数预算留在对话中`,n,titleLength,hard)
    else if(titleLength>recommended)issue('wordy_label','warning','可进一步缩短标题，保留动作和对象；不要删掉业务条件',n,titleLength,recommended)
    if(n.label.split('\n').length>3||(n.label.match(/[。；;]/g)||[]).length>=3)issue('paragraph_label','error','节点标题包含多段说明；请提炼标题，真实连续动作应拆成节点并连线',n)
    if(process&&n.kind==='task'&&componentName.test(n.label.trim()))issue('component_as_task','error','技术组件不是执行动作；改用架构图，或写明真实动作与对象（不要虚构步骤）',n)
    if(process&&(/^(?:(?:性能|容量|成本|硬件|资源|部署)(?:参数|预算|指标|配置)?|参数预算)[：:]/.test(n.label.trim())||/^(?:QPS|TPS|P(?:95|99)|CPU|RAM|GPU|RTO|RPO)\s*(?:[<>=≤≥:：]|\d)/i.test(n.label.trim())))issue('specification_as_step','error','参数、性能或成本预算不是流程步骤；移至对话或独立技术资料',n)
    if(d.kind==='architecture'){
      if((n.items?.length||0)>12)issue('too_many_items','error','模块条目超过 12 项；按真实职责拆分模块，不复制为解释卡片',n,n.items!.length,12)
      else if((n.items?.length||0)>8)issue('many_items','warning','模块建议保留 8 项以内核心能力',n,n.items!.length,8)
      if(n.items?.some(s=>[...s].length>cap(s,32,100)))issue('long_item','error','模块条目应是简短能力名称，详细规则放正文资料',n)
    }
    if(d.kind==='architecture'&&n.items?.some(item=>!item.trim()))issue('empty_item','error','能力条目不能是空白占位',n,n.items.filter(item=>!item.trim()).length,0)
    if(d.kind==='mindmap'){
      let depth=1,cur=n;const seen=new Set([n.id]);while(cur.parentId){const p=nodes.find(x=>x.id===cur.parentId);if(!p||seen.has(p.id))break;depth++;seen.add(p.id);cur=p}
      if(depth>5)issue('deep_mindmap','warning','层级超过 5 层；检查是否需要另开主题图，避免机械拆词',n,depth,5)
      if(nodes.some(x=>x.id!==n.id&&x.parentId===n.parentId&&x.label.trim()===n.label.trim()))issue('duplicate_topic','warning','同级主题名称重复，请合并重复概念或明确区别',n)
    }
  }
  for(const e of edges)if(e.label){const length=[...e.label].length,limit=cap(e.label,24,80);if(length>limit)issues.push({code:'long_edge_label',severity:'error',message:'连线文字过长；只表达交接条件或数据名称，解释放对话中',edgeId:e.id,actual:length,limit})}
  if(['flowchart','swimlane','dataflow'].includes(d.kind)){
    for(const n of nodes){const outgoing=edges.filter(e=>e.source===n.id),incoming=edges.filter(e=>e.target===n.id)
      if(nodes.length>1&&!outgoing.length&&!incoming.length)issue('isolated_node','error','业务节点未连接主流程；补齐真实前置/后续，或移除无关节点',n)
      if(n.kind==='decision'){
        if(outgoing.length<2)issue('decision_exits','error','判断至少需要两个真实出口，分别连接到后续节点',n,outgoing.length,2)
        else{const labels=outgoing.map(e=>(e.label||'').trim().toLowerCase());if(labels.some(s=>!s)||new Set(labels).size!==labels.length)issue('decision_conditions','error','每个判断出口都需有不重复的条件，例如 是/否、通过/退回',n)}
      }
      if(n.kind==='end'&&outgoing.length)issue('end_continues','error','结束节点仍有后续步骤；请改为普通步骤或修正连接',n)
      if(nodes.length>1&&['task','card'].includes(n.kind)&&!outgoing.length&&!outcome.test(n.label))issue('unclear_outcome',d.kind==='swimlane'?'error':'warning','该分支没有明确后续或交付结果，请核对是否遗漏',n)
    }
    const seen=new Set<string>(),components:string[][]=[]
    for(const n of nodes)if(!seen.has(n.id)){const stack=[n.id],group:string[]=[];while(stack.length){const id=stack.pop()!;if(seen.has(id))continue;seen.add(id);group.push(id);for(const e of edges){if(e.source===id&&!seen.has(e.target))stack.push(e.target);if(e.target===id&&!seen.has(e.source))stack.push(e.source)}}components.push(group)}
    if(components.length>1)issue('disconnected_process','error','主图包含互不关联的业务片段；核对缺失连线，独立流程应分图表达',undefined,components.length,1)
  }
  if(process&&nodes.length){
    const forward=edges.filter(e=>e.kind!=='feedback')
    const starts=nodes.filter(n=>d.kind==='flowchart'?n.kind==='start':!forward.some(e=>e.target===n.id))
    const ends=nodes.filter(n=>n.kind==='end'||d.kind==='swimlane'&&!edges.some(e=>e.source===n.id)&&outcome.test(n.label))
    if(!starts.length)issue('process_entry_missing','error',d.kind==='flowchart'?'流程图需要明确开始节点':'泳道图需要可定位的业务入口；检查是否遗漏起始动作或将回流误写为普通边',undefined,0,1)
    if(d.kind==='flowchart'&&!ends.length)issue('process_result_missing','error','流程图需要明确结束结果；不要用技术组件或说明文字代替结果',undefined,0,1)
    const indexes=new Map<typeof edges,{out:Map<string,string[]>;incoming:Map<string,string[]>}>()
    const walk=(seeds:string[],links:typeof edges,reverse=false)=>{
      let index=indexes.get(links)
      if(!index){index={out:new Map(),incoming:new Map()};for(const edge of links){index.out.set(edge.source,[...(index.out.get(edge.source)??[]),edge.target]);index.incoming.set(edge.target,[...(index.incoming.get(edge.target)??[]),edge.source])}indexes.set(links,index)}
      const adjacent=reverse?index.incoming:index.out,found=new Set<string>(),todo=[...seeds]
      while(todo.length){const id=todo.pop()!;if(found.has(id))continue;found.add(id);todo.push(...(adjacent.get(id)??[]))}
      return found
    }
    const reachable=walk(starts.map(n=>n.id),edges)
    if(starts.length)for(const node of nodes)if(!reachable.has(node.id))issue('unreachable_step','error','步骤无法从业务入口到达；核对真实方向和缺失前置，不用说明替代连线',node,1,0)
    // Swimlane can express an ongoing service, but only an explicit feedback edge
    // closing a real directed path counts as its recurring result.
    const recurring=d.kind==='swimlane'?edges.filter(e=>e.kind==='feedback'&&walk([e.target],forward).has(e.source)).map(e=>e.source):[]
    const closes=walk([...ends.map(n=>n.id),...recurring],edges,true)
    if(!ends.length&&!recurring.length&&d.kind==='swimlane')issue('process_result_missing','error','泳道图需要明确交付/终止结果或真实闭合的 feedback 持续循环',undefined,0,1)
    if(ends.length||recurring.length)for(const node of nodes)if(!closes.has(node.id))issue('no_result_path','error','该步骤无法到达明确结果或持续反馈闭环；请核对失败出口和后续',node,1,0)
    for(const node of nodes.filter(n=>n.kind==='start')){const incoming=forward.filter(e=>e.target===node.id);if(incoming.length)issue('start_has_predecessor','error','开始节点不应有普通前置；回流应指向真实处理步骤',node,incoming.length,0)}
  }
  if(d.kind==='mindmap'){
    const steps=nodes.filter(n=>/^(?:步骤|step)\s*[一二三四五六七八九十0-9]+(?:[、.：:\s]|$)/i.test(n.label.trim()))
    if(steps.length>=2)for(const node of steps)issue('process_as_mindmap','error','多个顺序步骤不应冒充主题分类；执行先后请使用流程图，分类图应按真实概念命名',node,steps.length,1)
  }
  const notes=d.nodes.length-nodes.length;if(notes>Math.max(2,Math.ceil(nodes.length*.15)))issue('excessive_annotations','error','说明文字占比较高；检查是否用解释替代了业务节点或关系，非必要说明移到对话',undefined,notes,Math.max(2,Math.ceil(nodes.length*.15)))
  const errors=issues.filter(i=>i.severity==='error').length,warnings=issues.length-errors,score=Math.max(0,100-errors*20-Math.min(20,warnings*2))
  return {standardVersion:DRAWING_STANDARD_VERSION,passed:errors===0&&score>=80,score,issues}
}
const family=(code:string)=>({wordy_label:'label_length',long_label:'label_length',wordy_description:'description_length',long_description:'description_length',many_items:'item_count',too_many_items:'item_count'} as Record<string,string>)[code]??code
function measure(issue:QualityIssue,content:DiagramContent){
  const node=content.nodes.find(n=>n.id===issue.nodeId)
  if(issue.actual!==undefined)return [['decision_exits','process_entry_missing','process_result_missing'].includes(issue.code)?(issue.limit??2)-issue.actual:issue.actual-(issue.limit??0)]
  if(node&&['wordy_description','long_description'].includes(issue.code))return [[...(node.description??'')].length]
  if(node&&issue.code==='paragraph_label')return [Math.max(0,node.label.split('\n').length-3),Math.max(0,(node.label.match(/[。；;]/g)||[]).length-2)]
  if(node&&issue.code==='decision_conditions'){
    const labels=content.edges.filter(e=>e.source===node.id).map(e=>(e.label??'').trim().toLowerCase()),present=labels.filter(Boolean)
    return [labels.length-present.length,present.length-new Set(present).size]
  }
  if(node&&issue.code==='end_continues')return [content.edges.filter(e=>e.source===node.id).length]
  if(node&&issue.code==='duplicate_topic')return [content.nodes.filter(n=>n.kind!=='note'&&n.id!==node.id&&n.parentId===node.parentId&&n.label.trim()===node.label.trim()).length]
  if(node&&issue.code==='long_item'){
    const excess=(node.items??[]).map(s=>Math.max(0,[...s].length-(/[\u3400-\u9fff]/.test(s)?32:100))).filter(Boolean)
    return [excess.length,excess.reduce((sum,n)=>sum+n,0),Math.max(0,...excess)]
  }
  // Atomic presence violations (e.g. wrong node kind / isolated node) have no
  // meaningful graded scale beyond their code, object identity and severity.
  return [1]
}
const severity=(issue:QualityIssue)=>issue.severity==='error'?2:1
const qualityKey=(issue:QualityIssue)=>[family(issue.code),issue.nodeId??'',issue.edgeId??''].join(':')


export class DrawingQualityError extends Error {constructor(public quality:DrawingQuality){super('图形未通过内容标准：'+quality.issues.map(i=>(i.nodeId?i.nodeId+'：':'')+i.message).join('；'))}}
export function requireDrawingQuality(next:DiagramContent,before?:DiagramContent,intent:EditIntent='structure'){
  const quality=inspectDrawing(next)
  if(before&&intent!=='annotation'&&((json(semantic(before))===json(semantic(next))&&json(annotations(before))!==json(annotations(next)))||(addedAnnotations(next,before)&&json(topology(before))===json(topology(next))))){const issue:QualityIssue={code:'annotation_only_change',severity:'error',message:'本次只修改了说明文字，业务节点和关系未改变。流程修改必须落到实际步骤、条件和连接；仅用户明确要求批注时使用 editIntent=annotation'};throw new DrawingQualityError({...quality,passed:false,score:Math.max(0,quality.score-20),issues:[...quality.issues,issue]})}
  if(!before){if(!quality.passed)throw new DrawingQualityError(quality);return quality}
  const old=new Map(inspectDrawing(before).issues.map(i=>[qualityKey(i),i]))
  const violations=quality.issues.filter(issue=>{const prior=old.get(qualityKey(issue));return !prior||severity(issue)>severity(prior)||severity(issue)===severity(prior)&&measure(issue,next).some((n,index)=>n>(measure(prior,before)[index]??0))})
  if(violations.length)throw new DrawingQualityError({...quality,passed:false,issues:violations})
  return quality
}
