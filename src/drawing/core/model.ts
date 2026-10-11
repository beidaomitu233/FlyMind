export type DiagramKind = 'swimlane' | 'flowchart' | 'architecture' | 'mindmap' | 'dataflow'
export type NodeKind = 'task' | 'decision' | 'start' | 'end' | 'module' | 'topic' | 'card' | 'note'
export interface CardStyle { icon?: 'database' | 'network' | 'check' | 'none'; tone?: 'blue' | 'teal'; variant?: 'card' | 'band' }
export interface Point { x:number; y:number }
export type Port='top'|'right'|'bottom'|'left'
export interface NodeStyle { fill?:string; stroke?:string; textColor?:string; fontSize?:number }
export interface EdgeStyle { color?:string; width?:number; sourcePort?:Port; targetPort?:Port; points?:Point[]; labelPosition?:Point; arrow?:'end'|'both'|'none' }
export type ThemeName = 'blue' | 'indigo' | 'forest'
export interface DiagramNode {
  id: string
  label: string
  kind: NodeKind
  laneId?: string
  phaseId?: string
  groupId?: string
  parentId?: string
  order?: number
  description?: string
  items?: string[]
  badge?: string
}
export interface DiagramEdge { id: string; source: string; target: string; label?: string; dashed?: boolean; kind?: 'flow' | 'feedback' }
export interface DiagramLane { id: string; label: string }
export interface DiagramPhase { id: string; label: string }
export interface DiagramGroup { id: string; label: string; tone?: 'blue' | 'green' | 'amber'; kind?: 'layer' | 'governance' }
export interface Box { x: number; y: number; width: number; height: number }
export interface DiagramDocument {
  schemaVersion: 1
  id: string
  title: string
  kind: DiagramKind
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  lanes: DiagramLane[]
  phases: DiagramPhase[]
  groups: DiagramGroup[]
  presentation: { theme: ThemeName; orientation: 'vertical' | 'horizontal'; positions: Record<string, Partial<Box>>; cards?: Record<string, CardStyle>; styles?:Record<string,NodeStyle>; edges?:Record<string,EdgeStyle> }
  updatedAt: number
}
export interface SceneNode extends Box { node: DiagramNode; color: string; fill: string; textColor: string }
export interface SceneContainer extends Box { id: string; label: string; kind: 'title' | 'lane' | 'phase' | 'layer' | 'governance'; tone?: string; vertical?: boolean }
export interface SceneEdge { edge: DiagramEdge; path: string; labelX: number; labelY: number; color: string; points?:Point[] }
export interface DiagramScene { width: number; height: number; nodes: SceneNode[]; edges: SceneEdge[]; containers: SceneContainer[] }
export const kindLabels: Record<DiagramKind, string> = { swimlane: '泳道图', flowchart: '流程图', architecture: '架构图', mindmap: '思维导图', dataflow: '数据流架构图' }
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
  const d=copy(input) as DiagramDocument
  if(d.schemaVersion!==1) throw new Error('schemaVersion 必须为 1')
  if(!Object.hasOwn(kindLabels,d.kind)) throw new Error('不支持的图形类型')
  if(typeof d.title!=='string'||!d.title.trim()||d.title.length>160) throw new Error('请输入 1–160 字的图形标题')
  if(!Array.isArray(d.nodes)||!d.nodes.length||d.nodes.length>500) throw new Error('图形需要 1–500 个节点')
  for(const key of ['edges','lanes','phases','groups'] as const) { if(d[key]===undefined) (d as any)[key]=[]; if(!Array.isArray(d[key])) throw new Error(`${key} 应为数组`) }
  if(d.edges.length>2000) throw new Error('连线数量不能超过 2000')
  const ids=new Set<string>()
  for(const n of d.nodes) {
    if(!n||typeof n.id!=='string'||!n.id||ids.has(n.id)) throw new Error('节点 ID 缺失或重复')
    ids.add(n.id)
    if(['x','y','width','height','style','icon','tone','variant','fill','stroke','textColor','fontSize'].some(key=>Object.hasOwn(n,key)))throw new Error('节点层不存放坐标和样式，请使用 presentation.positions、presentation.styles 或 presentation.cards')
    if(typeof n.label!=='string'||!n.label.trim()||n.label.length>500) throw new Error('节点文字应为 1–500 字')
    if(!['task','decision','start','end','module','topic','card','note'].includes(n.kind)) throw new Error(`节点 ${n.id} 的类型无效`)
    if(n.order!==undefined&&(!Number.isInteger(n.order)||n.order<0||n.order>200)) throw new Error('order 应为 0–200 的整数')
    if(n.items!==undefined&&(!Array.isArray(n.items)||n.items.length>30||n.items.some(x=>typeof x!=='string'||x.length>200))) throw new Error('模块条目应为不超过 30 项的文字数组')
    if(n.badge!==undefined&&(typeof n.badge!=='string'||n.badge.length>30))throw new Error('标记应为 30 字以内的文字')
    if(n.description!==undefined&&(typeof n.description!=='string'||n.description.length>4000))throw new Error('备注应为 4000 字以内的文字')
  }
  const listIds=(list:Array<{id:string;label:string}>)=>{const set=new Set<string>();for(const x of list){if(!x||typeof x.id!=='string'||!x.id||set.has(x.id)||typeof x.label!=='string'||!x.label.trim()||x.label.length>160)throw new Error('分组、泳道或阶段 ID/名称无效');set.add(x.id)}return set}
  const lanes=listIds(d.lanes),phases=listIds(d.phases),groups=listIds(d.groups)
  if(d.lanes.length>30||d.phases.length>30||d.groups.length>30)throw new Error('泳道、阶段和分层各最多 30 个')
  for(const g of d.groups){if(g.kind&&!['layer','governance'].includes(g.kind))throw new Error('分层 kind 无效');if(g.tone&&!['blue','green','amber'].includes(g.tone))throw new Error('分层 tone 无效')}
  if(d.kind==='swimlane'&&!d.lanes.length) throw new Error('泳道图至少需要一个角色泳道')
  if(d.kind==='architecture'&&!d.groups.length) throw new Error('架构图至少需要一个分层')
  for(const n of d.nodes){
    if(n.laneId&&!lanes.has(n.laneId)) throw new Error(`节点 ${n.id} 引用了不存在的泳道`)
    if(n.phaseId&&!phases.has(n.phaseId)) throw new Error(`节点 ${n.id} 引用了不存在的阶段`)
    if(n.groupId&&!groups.has(n.groupId)) throw new Error(`节点 ${n.id} 引用了不存在的分层`)
    if(n.parentId&&!ids.has(n.parentId)) throw new Error(`节点 ${n.id} 的父节点不存在`)
    if(d.kind==='swimlane'&&!n.laneId) throw new Error(`节点 ${n.id} 需要 laneId`)
    if(d.kind==='swimlane'&&d.phases.length&&!n.phaseId) throw new Error(`节点 ${n.id} 需要 phaseId`)
    if(d.kind==='architecture'&&!n.groupId) throw new Error(`节点 ${n.id} 需要 groupId`)
  }
  const edgeIds=new Set<string>()
  for(const e of d.edges){if(!e||typeof e.id!=='string'||!e.id||edgeIds.has(e.id)||!ids.has(e.source)||!ids.has(e.target))throw new Error('连线 ID 无效或端点不存在');edgeIds.add(e.id);if(e.label!==undefined&&(typeof e.label!=='string'||e.label.length>200))throw new Error('连线文字过长');if(e.kind!==undefined&&!['flow','feedback'].includes(e.kind))throw new Error('连线类型无效')}
  if(d.kind==='mindmap') {
    if(d.nodes.filter(n=>!n.parentId).length!==1) throw new Error('思维导图需要一个中心主题')
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
  if(d.presentation.styles!==undefined){map(d.presentation.styles,'styles');for(const [id,s] of Object.entries(d.presentation.styles)){if(!ids.has(id)){delete d.presentation.styles[id];continue}map(s,'节点样式');for(const k of ['fill','stroke','textColor'] as const)if(s[k]!==undefined&&!color(s[k]))throw new Error('颜色必须为 #RRGGBB');if(s.fontSize!==undefined&&(!Number.isFinite(s.fontSize)||s.fontSize<10||s.fontSize>48))throw new Error('字号范围为 10–48')}}
  if(d.presentation.edges!==undefined){map(d.presentation.edges,'edges');const ports=['top','right','bottom','left'];for(const [id,s] of Object.entries(d.presentation.edges)){if(!edgeIds.has(id)){delete d.presentation.edges[id];continue}map(s,'连线样式');if(s.color!==undefined&&!color(s.color))throw new Error('颜色必须为 #RRGGBB');if(s.width!==undefined&&(!Number.isFinite(s.width)||s.width<1||s.width>8))throw new Error('连线宽度范围为 1–8');if(s.sourcePort!==undefined&&!ports.includes(s.sourcePort)||s.targetPort!==undefined&&!ports.includes(s.targetPort))throw new Error('连线端口无效');if(s.arrow!==undefined&&!['end','both','none'].includes(s.arrow))throw new Error('箭头无效');if(s.points!==undefined&&(!Array.isArray(s.points)||s.points.length>40||s.points.some(p=>!point(p))))throw new Error('连线路径点无效');if(s.labelPosition!==undefined&&!point(s.labelPosition))throw new Error('连线标签位置无效')}}
  d.id=typeof d.id==='string'&&d.id?d.id:newId('diagram')
  d.updatedAt=Number.isFinite(d.updatedAt)?d.updatedAt:Date.now()
  return d
}
