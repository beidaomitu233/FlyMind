export type DiagramKind = 'swimlane' | 'flowchart' | 'architecture' | 'mindmap' | 'dataflow' | 'technical'
export type NodeKind = 'task' | 'decision' | 'start' | 'end' | 'module' | 'topic' | 'card' | 'note'
export interface CardStyle { icon?: 'database' | 'network' | 'check' | 'none'; tone?: 'blue' | 'teal'; variant?: 'card' | 'band' }
export interface Point { x:number; y:number }
export type Port='top'|'right'|'bottom'|'left'
export interface NodeStyle { fill?:string; stroke?:string; textColor?:string; fontSize?:number;shape?:NodeShape }
export interface EdgeStyle { color?:string; width?:number; sourcePort?:Port; targetPort?:Port; points?:Point[]; labelPosition?:Point;labelColor?:string;labelFontSize?:number; arrow?:'end'|'both'|'none';dashed?:boolean;route?:LineRoute }
export type ThemeName = 'blue' | 'indigo' | 'forest'
export interface DiagramNode {
  id: string
  label: string
  kind: NodeKind
  laneId?: string
  phaseId?: string
  groupId?: string
  parentId?: string
  color?: string
  technology?: string
  description?: string
  items?: string[]
  badge?: string
}
export interface DiagramEdge { id: string; source: string; target: string; label?: string; kind?: 'flow' | 'feedback' }
export interface DiagramLane { id: string; label: string }
export interface DiagramPhase { id: string; label: string }
export interface DiagramGroup { id: string; label: string; color?:string; kind?: 'layer' | 'governance' }
export interface Box { x: number; y: number; width: number; height: number }
export interface DiagramContent {
  schemaVersion: 1
  id: string
  title: string
  kind: DiagramKind
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  lanes: DiagramLane[]
  phases: DiagramPhase[]
  groups: DiagramGroup[]
}
// A transient editor/engine view. Files and MCP expose the two layers separately.
export interface DiagramDocument extends DiagramContent {
  presentation: RenderingConfig
  updatedAt: number
  createdAt?: number
}
export interface SceneNode extends Box { node: DiagramNode; color: string; fill: string; textColor: string }
export interface SceneContainer extends Box { id: string; label: string; kind: 'title' | 'lane' | 'phase' | 'corner' | 'layer' | 'governance'; tone?: string; vertical?: boolean }
export interface SceneEdge { edge: DiagramEdge; path: string; labelX: number; labelY: number; color: string; points?:Point[];labelBox?:Box }
export interface DiagramScene { width: number; height: number; nodes: SceneNode[]; edges: SceneEdge[]; containers: SceneContainer[] }
export const kindLabels: Record<DiagramKind, string> = { swimlane: '泳道图', flowchart: '流程图', architecture: '架构图', mindmap: '思维导图', dataflow: '数据流架构图', technical:'技术架构图' }
export function cardStyle(d:DiagramDocument,id:string):Required<CardStyle> { return {icon:'none',tone:'blue',variant:'card',...d.presentation.cards?.[id]} }
export const palette = {
  blue: { brand:'#3278ae', dark:'#194c70', soft:'#edf5fb', accent:'#249568', accentSoft:'#edf8f2', edge:'#557185' },
  indigo: { brand:'#596fea', dark:'#3c4cad', soft:'#eef0ff', accent:'#259d79', accentSoft:'#edf9f3', edge:'#65728d' },
  forest: { brand:'#27867e', dark:'#185c57', soft:'#edf7f5', accent:'#558957', accentSoft:'#f0f7ed', edge:'#547b75' }
}
export function newId(prefix='n') { return `${prefix}_${Math.random().toString(36).slice(2,10)}` }
export function copy<T>(value:T):T { return JSON.parse(JSON.stringify(value)) }
export function validateDocument(input: unknown): DiagramDocument {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('图形数据应为 JSON 对象')
  const source=copy(input) as any
  const d=(source.schemaVersion===2&&source.content?{...source.content,presentation:source.rendering,updatedAt:source.updatedAt,...(source.createdAt!==undefined?{createdAt:source.createdAt}:{})}:source) as DiagramDocument
  if(d.createdAt!==undefined&&(!Number.isFinite(d.createdAt)||d.createdAt!<=0))throw new Error('创建时间无效')
  if(d.schemaVersion!==1) throw new Error('schemaVersion 必须为 1')
  if(!Object.hasOwn(kindLabels,d.kind)) throw new Error('不支持的图形类型')
  if(typeof d.title!=='string'||!d.title.trim()||d.title.length>160) throw new Error('请输入 1–160 字的图形标题')
  if(!Array.isArray(d.nodes)||!d.nodes.length||d.nodes.length>500) throw new Error('图形需要 1–500 个节点')
  for(const key of ['edges','lanes','phases','groups'] as const) { if(d[key]===undefined) (d as any)[key]=[]; if(!Array.isArray(d[key])) throw new Error(`${key} 应为数组`) }
  if(d.edges.length>2000) throw new Error('连线数量不能超过 2000')
  d.presentation=d.presentation||defaultRendering(d.kind)
  // Import migration only: move old cosmetic fields out of content.
  for(const n of d.nodes as any[]){if(n?.order!==undefined){(d.presentation.ranks??={})[n.id]=n.order;delete n.order}}
  for(const e of d.edges as any[]){if(e?.dashed!==undefined){(d.presentation.edges??={})[e.id]={...d.presentation.edges?.[e.id],dashed:e.dashed};delete e.dashed}}
  for(const g of d.groups as any[]){if(g?.tone!==undefined){(d.presentation.groups??={})[g.id]={...d.presentation.groups?.[g.id],tone:g.tone};delete g.tone}}
  const ids=new Set<string>()
  for(const n of d.nodes) {
    if(!n||typeof n.id!=='string'||!n.id||ids.has(n.id)) throw new Error('节点 ID 缺失或重复')
    ids.add(n.id)
    if(['x','y','width','height','style','icon','tone','variant','fill','stroke','textColor','fontSize'].some(key=>Object.hasOwn(n,key)))throw new Error('节点层不存放坐标和样式，请使用 presentation.positions、presentation.styles 或 presentation.cards')
    if(typeof n.label!=='string'||!n.label.trim()||n.label.length>500) throw new Error('节点文字应为 1–500 字')
    if(!['task','decision','start','end','module','topic','card','note'].includes(n.kind)) throw new Error(`节点 ${n.id} 的类型无效`)
    if(n.technology!==undefined&&(d.kind!=='technical'||typeof n.technology!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(n.technology)))throw new Error('technology 仅技术架构图使用小写技术标识，不接受URL或样式')
    if(n.color!==undefined&&!/^#[0-9a-f]{6}$/i.test(n.color))throw new Error('可选节点颜色应为 #RRGGBB')
    if(n.items!==undefined&&(!Array.isArray(n.items)||n.items.length>30||n.items.some(x=>typeof x!=='string'||x.length>200))) throw new Error('模块条目应为不超过 30 项的文字数组')
    if(n.badge!==undefined&&(typeof n.badge!=='string'||n.badge.length>30))throw new Error('标记应为 30 字以内的文字')
    if(n.description!==undefined&&(typeof n.description!=='string'||n.description.length>4000))throw new Error('备注应为 4000 字以内的文字')
  }
  const listIds=(list:Array<{id:string;label:string}>)=>{const set=new Set<string>();for(const x of list){if(!x||typeof x.id!=='string'||!x.id||set.has(x.id)||typeof x.label!=='string'||!x.label.trim()||x.label.length>160)throw new Error('分组、泳道或阶段 ID/名称无效');set.add(x.id)}return set}
  const lanes=listIds(d.lanes),phases=listIds(d.phases),groups=listIds(d.groups)
  if(d.presentation.objects){
    const o=d.presentation.objects
    if(typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!['groups','locked','order'].includes(k)))throw new Error('画布对象配置无效')
    for(const key of ['locked','order'] as const)if(o[key]!==undefined){if(!Array.isArray(o[key])||o[key]!.some(id=>typeof id!=='string')||new Set(o[key]).size!==o[key]!.length)throw new Error('画布对象列表无效');o[key]=o[key]!.filter(id=>ids.has(id))}
    if(o.groups){if(typeof o.groups!=='object'||Array.isArray(o.groups)||Object.keys(o.groups).length>500)throw new Error('画布组合无效');const grouped=new Set<string>();for(const [id,members] of Object.entries(o.groups)){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||!Array.isArray(members)||members.some(n=>typeof n!=='string')||new Set(members).size!==members.length)throw new Error('画布组合无效');o.groups[id]=members.filter(n=>ids.has(n));if(o.groups[id].length<2){delete o.groups[id];continue}for(const n of o.groups[id]){if(grouped.has(n))throw new Error('节点只能属于一个画布组合');grouped.add(n)}}}
  }
  if(d.lanes.length>30||d.phases.length>30||d.groups.length>30)throw new Error('泳道、阶段和分层各最多 30 个')
  for(const g of d.groups){if(g.kind&&!['layer','governance'].includes(g.kind))throw new Error('分层 kind 无效');if(g.color!==undefined&&!/^#[0-9a-f]{6}$/i.test(g.color))throw new Error('可选分层颜色应为 #RRGGBB')}
  if(d.kind==='swimlane'&&!d.lanes.length) throw new Error('泳道图至少需要一个角色泳道')
  if(d.kind==='architecture'&&!d.groups.length) throw new Error('架构图至少需要一个分层')
  for(const n of d.nodes){
    if(n.laneId&&!lanes.has(n.laneId)) throw new Error(`节点 ${n.id} 引用了不存在的泳道`)
    if(n.phaseId&&!phases.has(n.phaseId)) throw new Error(`节点 ${n.id} 引用了不存在的阶段`)
    if(n.groupId&&!groups.has(n.groupId)) throw new Error(`节点 ${n.id} 引用了不存在的分层`)
    if(n.parentId&&!ids.has(n.parentId)) throw new Error(`节点 ${n.id} 的父节点不存在`)
    if(n.kind!=='note'&&d.kind==='swimlane'&&!n.laneId) throw new Error(`节点 ${n.id} 需要 laneId`)
    if(n.kind!=='note'&&d.kind==='swimlane'&&d.phases.length&&!n.phaseId) throw new Error(`节点 ${n.id} 需要 phaseId`)
    if(n.kind!=='note'&&d.kind==='architecture'&&!n.groupId) throw new Error(`节点 ${n.id} 需要 groupId`)
  }
  const edgeIds=new Set<string>()
  for(const e of d.edges){if(!e||typeof e.id!=='string'||!e.id||edgeIds.has(e.id)||!ids.has(e.source)||!ids.has(e.target))throw new Error('连线 ID 无效或端点不存在');edgeIds.add(e.id);if(e.label!==undefined&&(typeof e.label!=='string'||e.label.length>200))throw new Error('连线文字过长');if(e.kind!==undefined&&!['flow','feedback'].includes(e.kind))throw new Error('连线类型无效')}
  if(d.kind==='mindmap') {
    if(d.nodes.filter(n=>n.kind!=='note'&&!n.parentId).length!==1) throw new Error('思维导图需要一个中心主题')
    if(d.nodes.some(n=>n.kind!=='note'&&d.nodes.some(p=>p.id===n.parentId&&p.kind==='note')))throw new Error('说明文字不能作为父主题')
    if(d.edges.some(e=>d.nodes.some(n=>n.parentId&&e.id===`parent_${n.id}`)))throw new Error('连线 ID 与自动父子连线重复，请为额外连线使用其他 ID')
    for(const n of d.nodes){const seen=new Set<string>();let cur:DiagramNode|undefined=n;while(cur){if(seen.has(cur.id))throw new Error('思维导图不能循环引用父节点');seen.add(cur.id);cur=d.nodes.find(x=>x.id===cur!.parentId)}}
  }
  d.presentation=d.presentation||{theme:'indigo',orientation:'vertical',positions:{}}
  if(!Object.hasOwn(palette,d.presentation.theme)) d.presentation.theme='indigo'
  if(!['vertical','horizontal'].includes(d.presentation.orientation))d.presentation.orientation='vertical'
  d.presentation.positions=d.presentation.positions||{}
  if(typeof d.presentation.positions!=='object'||Array.isArray(d.presentation.positions))throw new Error('positions 应为对象')
  for(const [id,p] of Object.entries(d.presentation.positions)){if(!ids.has(id)){delete d.presentation.positions[id];continue}if(!p||typeof p!=='object')throw new Error('节点位置无效');for(const key of ['x','y','width','height'] as const)if(p[key]!==undefined&&(!Number.isFinite(p[key])||Math.abs(p[key]!)>50000||((key==='width'||key==='height')&&p[key]!<32)))throw new Error('节点位置或尺寸超出允许范围')}
  if(d.presentation.cards!==undefined){
    if(!d.presentation.cards||typeof d.presentation.cards!=='object'||Array.isArray(d.presentation.cards))throw new Error('cards 应为对象')
    for(const [id,s] of Object.entries(d.presentation.cards)){
      if(!ids.has(id)){delete d.presentation.cards[id];continue}
      if(!s||typeof s!=='object'||Array.isArray(s))throw new Error('卡片样式无效')
      if(s.icon!==undefined&&!['database','network','check','none'].includes(s.icon))throw new Error('卡片图标无效')
      if(s.tone!==undefined&&!['blue','teal'].includes(s.tone))throw new Error('卡片配色无效')
      if(s.variant!==undefined&&!['card','band'].includes(s.variant))throw new Error('卡片布局无效')
    }
  }
  const map=(value:unknown,name:string)=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${name} 应为对象`)}
  const color=(v:unknown)=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v)
  const point=(p:Point)=>p&&typeof p==='object'&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=50000&&Math.abs(p.y)<=50000
  if(d.presentation.ranks){map(d.presentation.ranks,'ranks');for(const [id,r] of Object.entries(d.presentation.ranks)){if(!ids.has(id)){delete d.presentation.ranks[id];continue}if(!Number.isInteger(r)||r<0||r>200)throw new Error('渲染布局行应为 0–200 的整数')}}
  if(d.presentation.texts){map(d.presentation.texts,'texts');for(const [id,t] of Object.entries(d.presentation.texts)){if(!d.nodes.some(n=>n.id===id&&n.kind==='note')){delete d.presentation.texts[id];continue}map(t,'文字渲染');if(Object.keys(t).some(k=>!['width','fontSize','color'].includes(k))||t.width!==undefined&&(!Number.isFinite(t.width)||t.width<24||t.width>4000)||t.fontSize!==undefined&&(!Number.isFinite(t.fontSize)||t.fontSize<10||t.fontSize>48)||t.color!==undefined&&!color(t.color))throw new Error('文字渲染配置无效')}}
  if(d.presentation.phases){map(d.presentation.phases,'phases');for(const [id,s] of Object.entries(d.presentation.phases)){if(!phases.has(id)){delete d.presentation.phases[id];continue}map(s,'阶段尺寸');if(Object.keys(s).some(k=>k!=='size')||!Number.isFinite(s.size)||s.size<56||s.size>50000)throw new Error('阶段尺寸应为 56–50000')}}
  if(d.presentation.groups){map(d.presentation.groups,'groups');for(const [id,s] of Object.entries(d.presentation.groups)){if(!groups.has(id)){delete d.presentation.groups[id];continue}map(s,'分组渲染配置');if(s.tone&&!['blue','green','amber'].includes(s.tone))throw new Error('分组配色无效');if(s.columns!==undefined&&(!Number.isInteger(s.columns)||s.columns<1||s.columns>10))throw new Error('分组列数应为 1–10')}}
  if(d.presentation.nodeDefaults){map(d.presentation.nodeDefaults,'nodeDefaults');for(const [kind,s] of Object.entries(d.presentation.nodeDefaults)){if(!['task','decision','start','end','module','topic','card','note'].includes(kind))throw new Error('标准节点类型无效');map(s,'标准节点配置');for(const key of ['width','height'] as const)if(s[key]!==undefined&&(!Number.isFinite(s[key])||s[key]!<32||s[key]!>2000))throw new Error('标准节点尺寸应为 32–2000');if(s.fontSize!==undefined&&(!Number.isFinite(s.fontSize)||s.fontSize<10||s.fontSize>48))throw new Error('字号范围为 10–48');if(s.shape&&!['rectangle','rounded','ellipse','diamond'].includes(s.shape))throw new Error('节点形状无效');for(const key of ['fill','stroke','textColor'] as const)if(s[key]!==undefined&&!color(s[key]))throw new Error('颜色必须为 #RRGGBB')}}
  const checkEdge=(s:EdgeStyle)=>{if(s.route&&!['orthogonal','straight','curved'].includes(s.route))throw new Error('连接线类型无效');if(s.dashed!==undefined&&typeof s.dashed!=='boolean')throw new Error('虚线配置无效');if(s.color!==undefined&&!color(s.color))throw new Error('颜色必须为 #RRGGBB');if(s.width!==undefined&&(!Number.isFinite(s.width)||s.width<1||s.width>8))throw new Error('连线宽度范围为 1–8');if(s.arrow&&!['end','both','none'].includes(s.arrow))throw new Error('箭头无效')}
  if(d.presentation.edgeDefaults){map(d.presentation.edgeDefaults,'edgeDefaults');checkEdge(d.presentation.edgeDefaults)}
  if(d.presentation.styles!==undefined){map(d.presentation.styles,'styles');for(const [id,s] of Object.entries(d.presentation.styles)){if(!ids.has(id)){delete d.presentation.styles[id];continue}map(s,'节点样式');if(s.shape&&!['rectangle','rounded','ellipse','diamond'].includes(s.shape))throw new Error('节点形状无效');for(const k of ['fill','stroke','textColor'] as const)if(s[k]!==undefined&&!color(s[k]))throw new Error('颜色必须为 #RRGGBB');if(s.fontSize!==undefined&&(!Number.isFinite(s.fontSize)||s.fontSize<10||s.fontSize>48))throw new Error('字号范围为 10–48')}}
  if(d.presentation.edges!==undefined){map(d.presentation.edges,'edges');const ports=['top','right','bottom','left'];for(const [id,s] of Object.entries(d.presentation.edges)){if(d.kind==='mindmap')d.nodes.filter(n=>n.parentId).forEach(n=>edgeIds.add(`parent_${n.id}`));if(!edgeIds.has(id)){delete d.presentation.edges[id];continue}map(s,'连线样式');checkEdge(s);if(s.color!==undefined&&!color(s.color))throw new Error('颜色必须为 #RRGGBB');if(s.width!==undefined&&(!Number.isFinite(s.width)||s.width<1||s.width>8))throw new Error('连线宽度范围为 1–8');if(s.sourcePort!==undefined&&!ports.includes(s.sourcePort)||s.targetPort!==undefined&&!ports.includes(s.targetPort))throw new Error('连线端口无效');if(s.arrow!==undefined&&!['end','both','none'].includes(s.arrow))throw new Error('箭头无效');if(s.points!==undefined&&(!Array.isArray(s.points)||s.points.length>40||s.points.some(p=>!point(p))))throw new Error('连线路径点无效');if(s.labelPosition!==undefined&&!point(s.labelPosition))throw new Error('连线标签位置无效');if(s.labelColor!==undefined&&!color(s.labelColor))throw new Error('文字颜色无效');if(s.labelFontSize!==undefined&&(!Number.isFinite(s.labelFontSize)||s.labelFontSize<10||s.labelFontSize>48))throw new Error('字号范围为 10–48')}}
  d.id=typeof d.id==='string'&&d.id?d.id:newId('diagram')
  d.updatedAt=Number.isFinite(d.updatedAt)?d.updatedAt:Date.now()
  return d
}
import { defaultRendering, type RenderingConfig, type LineRoute, type NodeShape } from './render-config'
