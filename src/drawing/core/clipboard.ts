import { copy,newId,cardStyle,type DiagramContent,type DiagramDocument,type DiagramScene,type Point } from './model'
import { composeDocument,extractContent,replaceRendering } from './layers'
import { expandGroups,fullHex,orderedNodes } from './objects'
import { selectionBounds } from './canvas-geometry'
import { nodePreset,edgePreset,type RenderingConfig } from './render-config'

export interface SelectionFragment {
  format:'flymind.selection';version:1;sourceId:string;kind:DiagramDocument['kind']
  content:Pick<DiagramContent,'nodes'|'edges'|'lanes'|'phases'|'groups'>
  rendering:RenderingConfig
}
function descendants(d:DiagramDocument,ids:string[]){
  const set=new Set(expandGroups(d,ids));let previous=0
  while(previous!==set.size){previous=set.size;expandGroups(d,[...set]).forEach(id=>set.add(id));if(d.kind==='mindmap')d.nodes.filter(n=>n.parentId&&set.has(n.parentId)).forEach(n=>set.add(n.id))}
  return set
}
export function createFragment(d:DiagramDocument,scene:DiagramScene,ids:string[]):SelectionFragment {
  const selected=descendants(d,ids);if(!selected.size)throw new Error('请选择要复制的节点')
  const content=extractContent(d);content.nodes=content.nodes.filter(n=>selected.has(n.id))
  for(const n of content.nodes)if(n.parentId&&!selected.has(n.parentId))delete n.parentId
  content.edges=content.edges.filter(e=>selected.has(e.source)&&selected.has(e.target))
  const rendering:RenderingConfig={theme:d.presentation.theme,orientation:d.presentation.orientation,positions:{},styles:{},cards:{},edges:{},objects:{groups:{},order:[]}}
  for(const n of content.nodes){const b=scene.nodes.find(b=>b.node.id===n.id)!;rendering.positions[n.id]={x:b.x,y:b.y,width:b.width,height:b.height};const preset=nodePreset(d,n.kind);rendering.styles![n.id]={shape:preset.shape,fontSize:preset.fontSize,...d.presentation.styles?.[n.id],fill:fullHex(b.fill),stroke:fullHex(b.color),textColor:fullHex(b.textColor)};if(d.presentation.cards?.[n.id])rendering.cards![n.id]=copy(d.presentation.cards[n.id])}
  if(d.kind==='dataflow')for(const n of content.nodes)rendering.cards![n.id]=cardStyle(d,n.id)
  for(const e of scene.edges)if(selected.has(e.edge.source)&&selected.has(e.edge.target))rendering.edges![e.edge.id]={...edgePreset(d),...copy(d.presentation.edges?.[e.edge.id]||{}),color:fullHex(e.color)}
  for(const [id,members] of Object.entries(d.presentation.objects?.groups||{})){const subset=members.filter(n=>selected.has(n));if(subset.length>1)rendering.objects!.groups![id]=subset}
  rendering.objects!.order=orderedNodes(d).map(n=>n.id).filter(id=>selected.has(id))
  return {format:'flymind.selection',version:1,sourceId:d.id,kind:d.kind,content:{nodes:content.nodes,edges:content.edges,lanes:content.lanes.filter(l=>content.nodes.some(n=>n.laneId===l.id)),phases:content.phases.filter(p=>content.nodes.some(n=>n.phaseId===p.id)),groups:content.groups.filter(g=>content.nodes.some(n=>n.groupId===g.id))},rendering}
}
export function parseFragment(text:string):SelectionFragment {
  if(text.length>2_000_000)throw new Error('剪贴板片段不能超过 2 MB')
  const f=JSON.parse(text) as SelectionFragment
  if(!f||f.format!=='flymind.selection'||f.version!==1||typeof f.sourceId!=='string'||!['swimlane','flowchart','architecture','mindmap','dataflow'].includes(f.kind)||Object.keys(f).some(k=>!['format','version','sourceId','kind','content','rendering'].includes(k)))throw new Error('剪贴板不是 FlyMind 节点片段')
  if(!f.content||Object.keys(f.content).some(k=>!['nodes','edges','lanes','phases','groups'].includes(k)))throw new Error('片段内容无效')
  // A selection can contain several root topics. Validate graph fields and
  // references without requiring a complete mindmap or complete lanes.
  const d=composeDocument({schemaVersion:1,id:'clipboard',title:'selection',kind:'flowchart',...f.content})
  replaceRendering(d,f.rendering)
  if(f.content.nodes.some(n=>!f.rendering.positions?.[n.id]||['x','y','width','height'].some(k=>!Number.isFinite((f.rendering.positions[n.id] as any)[k]))))throw new Error('片段缺少节点几何')
  return copy(f)
}
export function pasteFragment(d:DiagramDocument,fragment:SelectionFragment,point:Point,selectedId?:string):string[]{
  const f=parseFragment(JSON.stringify(fragment)),map=new Map(f.content.nodes.map(n=>[n.id,newId()])),anchor=d.nodes.find(n=>n.id===selectedId),bounds=selectionBounds(f.content.nodes.map(n=>f.rendering.positions[n.id] as any))!
  const dx=Math.max(16-bounds.x,point.x-bounds.x-bounds.width/2),dy=Math.max(16-bounds.y,point.y-bounds.y-bounds.height/2)
  const mapContainers=(key:'lanes'|'phases'|'groups')=>{
    const mapping=new Map<string,string>()
    for(const c of f.content[key]){const existing=d[key].find(x=>(f.sourceId===d.id&&x.id===c.id)||x.label===c.label);if(existing)mapping.set(c.id,existing.id);else{const id=newId(key);d[key].push({...copy(c),id});mapping.set(c.id,id)}}return mapping
  }
  const lanes=d.kind==='swimlane'?mapContainers('lanes'):new Map<string,string>(),phases=d.kind==='swimlane'?mapContainers('phases'):new Map<string,string>(),groups=d.kind==='architecture'?mapContainers('groups'):new Map<string,string>()
  for(const original of f.content.nodes){const n=copy(original);n.id=map.get(original.id)!;delete n.laneId;delete n.phaseId;delete n.groupId;delete n.parentId
    if(d.kind==='swimlane'){n.laneId=lanes.get(original.laneId||'')||anchor?.laneId||d.lanes[0]?.id;n.phaseId=phases.get(original.phaseId||'')||anchor?.phaseId||d.phases[0]?.id}
    if(d.kind==='architecture')n.groupId=groups.get(original.groupId||'')||anchor?.groupId||d.groups[0]?.id
    if(d.kind==='architecture')n.kind='module';else if(d.kind==='mindmap')n.kind='topic';else if(d.kind==='dataflow')n.kind=n.kind==='note'?'note':'card';else if(['module','topic','card','note'].includes(n.kind))n.kind='task'
    if(d.kind==='mindmap')n.parentId=map.get(original.parentId||'')||anchor?.id||d.nodes.find(x=>!x.parentId)!.id
    d.nodes.push(n)
    const b=f.rendering.positions[original.id] as any;d.presentation.positions[n.id]={x:b.x+dx,y:b.y+dy,width:b.width,height:b.height}
    if(f.rendering.styles?.[original.id])(d.presentation.styles??={})[n.id]=copy(f.rendering.styles[original.id])
    if(f.rendering.cards?.[original.id])(d.presentation.cards??={})[n.id]=copy(f.rendering.cards[original.id])
  }
  const relationships=[...f.content.edges]
  // Parent relationships become visible edges when pasting a mindmap into a
  // graph. Graph -> mindmap retains all relationships, including cycles, as
  // additional edges; topics attach to the selected parent/root.
  if(d.kind!=='mindmap')for(const n of f.content.nodes)if(n.parentId&&map.has(n.parentId))relationships.push({id:'parent_'+n.id,source:n.parentId,target:n.id})
  for(const e of relationships){const id=newId('edge');d.edges.push({...copy(e),id,source:map.get(e.source)!,target:map.get(e.target)!});const old=f.rendering.edges?.[e.id];if(old){const s=copy(old);s.points=s.points?.map(p=>({x:p.x+dx,y:p.y+dy}));if(s.labelPosition)s.labelPosition={x:s.labelPosition.x+dx,y:s.labelPosition.y+dy};(d.presentation.edges??={})[id]=s}}
  if(d.kind==='mindmap')for(const n of f.content.nodes)if(n.parentId&&map.has(n.parentId)){const old=f.rendering.edges?.['parent_'+n.id];if(old){const s=copy(old);s.points=s.points?.map(p=>({x:p.x+dx,y:p.y+dy}));if(s.labelPosition)s.labelPosition={x:s.labelPosition.x+dx,y:s.labelPosition.y+dy};(d.presentation.edges??={})['parent_'+map.get(n.id)!]=s}}
  for(const members of Object.values(f.rendering.objects?.groups||{}))((d.presentation.objects??={}).groups??={})[newId('canvas_group')]=members.map(id=>map.get(id)!)
  const order=(d.presentation.objects??={}).order??=[]
  if(!order.length)order.push(...d.nodes.filter(n=>![...map.values()].includes(n.id)).map(n=>n.id))
  order.push(...(f.rendering.objects?.order||f.content.nodes.map(n=>n.id)).map(id=>map.get(id)!).filter(Boolean))
  return [...map.values()]
}
