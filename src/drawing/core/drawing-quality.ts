import type {DiagramContent,DiagramNode} from './model'

export const DRAWING_STANDARD_VERSION='1.0'
export type EditIntent='structure'|'wording'|'annotation'
export interface QualityIssue {code:string;severity:'error'|'warning';message:string;nodeId?:string;edgeId?:string;actual?:number;limit?:number}
export interface DrawingQuality {standardVersion:string;passed:boolean;score:number;issues:QualityIssue[]}
const semantic=(d:DiagramContent)=>({kind:d.kind,nodes:d.nodes.filter(n=>n.kind!=='note').map(n=>({...n,...(d.kind!=='dataflow'?{description:undefined}:{})})).sort((a,b)=>a.id.localeCompare(b.id)),edges:d.edges.filter(e=>d.nodes.some(n=>n.id===e.source&&n.kind!=='note')&&d.nodes.some(n=>n.id===e.target&&n.kind!=='note')).slice().sort((a,b)=>a.id.localeCompare(b.id)),lanes:d.lanes,phases:d.phases,groups:d.groups})
const annotations=(d:DiagramContent)=>({notes:d.nodes.filter(n=>n.kind==='note'),edges:d.edges.filter(e=>d.nodes.some(n=>n.kind==='note'&&(n.id===e.source||n.id===e.target))),descriptions:d.kind==='dataflow'?[]:d.nodes.filter(n=>n.kind!=='note').map(n=>({id:n.id,description:n.description})).sort((a,b)=>a.id.localeCompare(b.id))})
function stable(v:any):any{return Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v}
const json=(v:unknown)=>JSON.stringify(stable(v))
const cap=(s:string,cn:number,en:number)=>/[\u3400-\u9fff]/.test(s)?cn:en
const key=(i:QualityIssue)=>[i.code,i.nodeId||'',i.edgeId||''].join(':')

// Semantic checks only: no positions, font sizes, line routing or other rendering inputs.
export function inspectDrawing(d:DiagramContent):DrawingQuality {
  const issues:QualityIssue[]=[],nodes=d.nodes.filter(n=>n.kind!=='note'),ids=new Set(nodes.map(n=>n.id)),edges=d.edges.filter(e=>ids.has(e.source)&&ids.has(e.target))
  const issue=(code:string,severity:QualityIssue['severity'],message:string,n?:DiagramNode,actual?:number,limit?:number)=>issues.push({code,severity,message,...(n?{nodeId:n.id}:{}),...(actual!==undefined?{actual}:{}),...(limit!==undefined?{limit}:{})})
  if(!nodes.length)issue('no_business_nodes','error','图形只有说明文字，没有业务节点；请绘制实际流程、模块或主题')
  const allowed=d.kind==='architecture'?['module']:d.kind==='mindmap'?['topic']:d.kind==='dataflow'?['card']:['start','end','task','decision']
  for(const n of nodes){
    if(!allowed.includes(n.kind))issue('node_type','error',`${d.kind} 不使用 ${n.kind} 业务节点，请选择该图形的语义类型`,n)
    const titleLength=[...n.label.trim()].length,short=n.kind==='start'||n.kind==='end',recommended=cap(n.label,short?12:18,short?36:64),hard=cap(n.label,short?24:32,short?72:110)
    if(titleLength>hard)issue('long_label','error',`标题过长：保留一个动作、问题或概念；将必要背景放 description，详细解释留在对话中`,n,titleLength,hard)
    else if(titleLength>recommended)issue('wordy_label','warning','可进一步缩短标题，保留动作和对象；不要删掉业务条件',n,titleLength,recommended)
    if(n.label.split('\n').length>3||(n.label.match(/[。；;]/g)||[]).length>=3)issue('paragraph_label','error','节点标题包含多段说明；请提炼标题，真实连续动作应拆成节点并连线',n)
    if(n.description&&[...n.description].length>(d.kind==='dataflow'?240:500))issue('long_description','error','正文过长；只保留与该节点直接相关的信息，避免把整段 PRD 塞进图形',n,[...n.description].length,d.kind==='dataflow'?240:500)
    else if(n.description&&[...n.description].length>(d.kind==='dataflow'?120:180))issue('wordy_description','warning','正文可以缩短；图内只保留理解该节点所需的信息',n)
    if(d.kind==='architecture'){
      if((n.items?.length||0)>12)issue('too_many_items','error','模块条目超过 12 项；按真实职责拆分模块，不复制为解释卡片',n,n.items!.length,12)
      else if((n.items?.length||0)>8)issue('many_items','warning','模块建议保留 8 项以内核心能力',n)
      if(n.items?.some(s=>[...s].length>cap(s,32,100)))issue('long_item','error','模块条目应是简短能力名称，详细规则放正文资料',n)
    }
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
      if(nodes.length>1&&['task','card'].includes(n.kind)&&!outgoing.length&&!/完成|归档|结束|交付|关闭|终止|结果|报告|complete|done|result|report/i.test(n.label))issue('unclear_outcome','warning','该分支没有明确后续或交付结果，请核对是否遗漏',n)
    }
    const seen=new Set<string>(),components:string[][]=[]
    for(const n of nodes)if(!seen.has(n.id)){const stack=[n.id],group:string[]=[];while(stack.length){const id=stack.pop()!;if(seen.has(id))continue;seen.add(id);group.push(id);for(const e of edges){if(e.source===id&&!seen.has(e.target))stack.push(e.target);if(e.target===id&&!seen.has(e.source))stack.push(e.source)}}components.push(group)}
    if(components.length>1)issue('disconnected_process','error','主图包含互不关联的业务片段；核对缺失连线，独立流程应分图表达',undefined,components.length,1)
  }
  const notes=d.nodes.length-nodes.length;if(notes>Math.max(2,Math.ceil(nodes.length*.15)))issue('excessive_annotations','warning','说明文字占比较高；检查是否用解释替代了业务节点或关系，非必要说明移到对话',undefined,notes,Math.max(2,Math.ceil(nodes.length*.15)))
  const errors=issues.filter(i=>i.severity==='error').length,warnings=issues.length-errors,score=Math.max(0,100-errors*20-Math.min(20,warnings*2))
  return {standardVersion:DRAWING_STANDARD_VERSION,passed:errors===0&&score>=80,score,issues}
}
export class DrawingQualityError extends Error {constructor(public quality:DrawingQuality){super('图形未通过内容标准：'+quality.issues.filter(i=>i.severity==='error').map(i=>(i.nodeId?i.nodeId+'：':'')+i.message).join('；'))}}
export function requireDrawingQuality(next:DiagramContent,before?:DiagramContent,intent:EditIntent='structure'){
  const quality=inspectDrawing(next)
  if(before&&intent!=='annotation'&&json(semantic(before))===json(semantic(next))&&json(annotations(before))!==json(annotations(next))){const issue:QualityIssue={code:'annotation_only_change',severity:'error',message:'本次只修改了说明文字，业务节点和关系未改变。流程修改必须落到实际步骤、条件和连接；仅用户明确要求批注时使用 editIntent=annotation'};throw new DrawingQualityError({...quality,passed:false,score:Math.max(0,quality.score-20),issues:[...quality.issues,issue]})}
  const old=new Map(before?inspectDrawing(before).issues.filter(i=>i.severity==='error').map(i=>[key(i),i]):[])
  const magnitude=(i:QualityIssue)=>i.code==='decision_exits'?(i.limit??2)-(i.actual??0):(i.actual??1)-(i.limit??0)
  const violations=quality.issues.filter(i=>i.severity==='error'&&(!old.has(key(i))||magnitude(i)>magnitude(old.get(key(i))!)))
  if(violations.length)throw new DrawingQualityError({...quality,passed:false,issues:violations})
  return quality
}
