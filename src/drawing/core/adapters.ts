import { kindLabels, validateDocument, newId, type DiagramDocument, type DiagramNode } from './model'
import type { MindNode } from '../../types/mindmap'
import { parseMarkdown } from '../../utils/markdown'

export function fromMindTree(root:MindNode,title:string):DiagramDocument {
  const nodes:DiagramNode[]=[]
  const visit=(n:MindNode,parentId?:string)=>{const id=n.id||newId();nodes.push({id,label:n.text||'未命名主题',kind:'topic',parentId});(n.children||[]).forEach(c=>visit(c,id))}
  visit(root)
  return validateDocument({schemaVersion:1,id:newId('diagram'),title,kind:'mindmap',nodes,edges:[],lanes:[],phases:[],groups:[],presentation:{theme:'indigo',orientation:'vertical',positions:{}},updatedAt:Date.now()})
}
export function parseDocument(text:string):DiagramDocument {
  const stripped=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')
  let value:any
  try{value=JSON.parse(stripped)}catch{throw new Error('JSON 解析失败，请检查括号、逗号与引号')}
  if(value.type==='flymind'&&value.data?.root)return fromMindTree(value.data.root,value.metadata?.name||value.data.name||'导入的导图')
  if(value.root?.text)return fromMindTree(value.root,value.name||value.root.text)
  if(value.text&&Array.isArray(value.children))return fromMindTree(value,value.text)
  return validateDocument(value)
}
export function fromMarkdown(text:string):DiagramDocument {
  const trees=parseMarkdown(text)
  if(!trees.length)throw new Error('请先输入 Markdown 标题或列表')
  const root=trees.length===1?trees[0]:{id:newId(),text:'中心主题',children:trees}
  return fromMindTree(root,root.text)
}
export function toMindTree(d:DiagramDocument):MindNode {
  if(d.kind!=='mindmap')throw new Error('仅思维导图可导出为 FMD')
  const build=(n:DiagramNode):MindNode=>({id:n.id,text:n.label,children:d.nodes.filter(x=>x.parentId===n.id).map(build)})
  return build(d.nodes.find(n=>!n.parentId)!)
}
export function codexPrompt(d:DiagramDocument):string {
  return `请根据我提供的业务材料生成一张${kindLabels[d.kind]}，只返回可导入 FlyMind 的 JSON，不编造原文不存在的内容。\n数据和渲染分离：不要在 nodes 中输出坐标、图标、颜色或 SVG。\n统一结构：schemaVersion=1、id、title、kind(swimlane/flowchart/architecture/mindmap/dataflow)、nodes、edges、lanes、phases、groups、presentation、updatedAt。\n节点字段：id、label、kind(task/decision/start/end/module/topic/card/note)、可选 laneId、phaseId、groupId、parentId、order、description、items、badge。\n连线字段：id、source、target、可选 label、dashed、kind(flow/feedback)。泳道和阶段字段：id、label。架构分层字段：id、label、tone(blue/green/amber)、kind(layer/governance)。\n泳道图节点必须归属 laneId；有阶段时必须归属 phaseId；order 为阶段内从上到下的行序号，同一行的跨角色活动用相同 order。架构图节点归属 groupId，模块内部条目放 items。思维导图用 parentId，只有一个没有 parentId 的中心主题。保留所有判断分支和循环连线。\n数据流架构图 kind=dataflow，卡片用 kind=card，纯文字注释用 kind=note。label 为标题，description 为画布可见说明（可换行），order 为从上到下的布局行，同一行用相同 order。反馈回流的连线设置 kind=feedback。视觉配置只放 presentation.cards，以节点 ID 为键，可选 icon(database/network/check/none)、tone(blue/teal)、variant(card/band)。多源汇聚支持独立入口，单卡片行自动铺满，band 为居中横幅。\npresentation={"theme":"${d.presentation.theme}","orientation":"${d.presentation.orientation}","positions":{}}，数据流图可附 cards。\n当前图形数据可作为结构参考：\n${JSON.stringify(d,null,2)}`
}
