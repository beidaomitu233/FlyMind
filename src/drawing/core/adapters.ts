import { kindLabels, validateDocument, newId, type DiagramDocument, type DiagramNode } from './model'
import { extractContent,composeDocument } from './layers'
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
  return value.presentation||value.schemaVersion===2?validateDocument(value):composeDocument(value)
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
  return `请根据业务材料生成一张${kindLabels[d.kind]}，只返回 FlyMind 内容 JSON。节点只描述 id、label、kind 和关系；可选 color=#RRGGBB。不要输出坐标、order、尺寸、形状、字体、图标、线型、presentation 或 updatedAt。渲染器自动布局和配色。\n统一结构：schemaVersion=1、id、title、kind、nodes、edges、lanes、phases、groups。泳道节点归属 laneId/phaseId，架构模块归属 groupId，思维导图用 parentId，数据流卡片用 card，注释用 note。保留判断分支和循环，反馈边 kind=feedback。\n当前内容参考：\n${JSON.stringify(extractContent(d),null,2)}`
}
