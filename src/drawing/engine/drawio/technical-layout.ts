import type {Box,DiagramContent,DiagramNode} from '../../core/model'
import {attr,type NativeDocument} from './xml'
import {setStyle} from './state'

export type TechnicalCategory='client'|'frontend'|'gateway'|'service'|'storage'|'scheduler'|'messaging'|'locking'|'operations'|'observability'|'other'
export interface TechnicalNodeSize {width:number;height:number;font:number;shape:string}
export interface TechnicalPlacement {node:DiagramNode;box:Box;parent?:string}
export interface TechnicalRegion {id:string;box:Box}
export const TECHNICAL_REGION_STYLE='shape=rectangle;container=1;collapsible=0;recursiveResize=0;expand=0;fillColor=none;strokeColor=#159bff;strokeWidth=2;dashed=1;dashPattern=7 5;labelPosition=center;verticalLabelPosition=top;align=center;verticalAlign=bottom;spacing=12;fontColor=#ef3434;fontStyle=1;resizable=1;'
export const TECHNICAL_NODE_STYLE='shape=rectangle;fillColor=none;strokeColor=none;fontColor=#262c35;spacing=0;'
export const TECHNICAL_EDGE_STYLE='strokeColor=#41454a;strokeWidth=1.6;'

const registry:Record<string,TechnicalCategory>={
 desktop:'client',mobile:'client',browser:'client',client:'client',
 vue:'frontend',vuedotjs:'frontend',react:'frontend',uniapp:'frontend',
 nginx:'gateway',gateway:'gateway',haproxy:'gateway',
 springboot:'service','spring-boot':'service',service:'service',node:'service',nodejs:'service',nodedotjs:'service',python:'service',
 mysql:'storage',postgresql:'storage',postgres:'storage',redis:'storage',minio:'storage',elasticsearch:'storage',database:'storage',
 quartz:'scheduler',scheduler:'scheduler','redis-stream':'messaging',rabbitmq:'messaging',kafka:'messaging',redisson:'locking',lock:'locking',
 jenkins:'operations',docker:'operations',portainer:'operations',kubernetes:'operations',
 'spring-boot-admin':'observability',druid:'observability',skywalking:'observability',monitor:'observability',prometheus:'observability',grafana:'observability',
}
export function technicalCategory(node:DiagramNode):TechnicalCategory{return registry[node.technology??'']??'other'}
/** Native port constraints express dependency direction, not business coordinates. */
export function technicalDependencyPorts(source:DiagramNode,target:DiagramNode):Record<string,number>{
 const a=technicalCategory(source),b=technicalCategory(target),ports=(exitX:number,exitY:number,entryX:number,entryY:number)=>({exitX,exitY,entryX,entryY,exitPerimeter:0,entryPerimeter:0})
 if(['operations','observability'].includes(a)&&b==='service')return ports(.5,0,.5,1)
 if(a==='scheduler'&&b==='service')return ports(.5,1,0,.5)
 if(a==='service'&&b==='messaging')return ports(.35,0,.35,1)
 if(a==='messaging'&&b==='service')return ports(.65,1,.65,0)
 if(a==='service'&&b==='locking')return ports(1,.5,0,.5)
 if(a==='client'&&b==='frontend'||a==='frontend'&&b==='gateway'||a==='gateway'&&b==='service'||a==='service'&&b==='storage')return ports(1,.5,0,.5)
 return {}
}
/** Called only after initial routing, never on ordinary text patches. */
export function styleTechnicalDependencies(native:NativeDocument,content:DiagramContent){
 const nodes=new Map(content.nodes.map(node=>[node.id,node]))
 for(const edge of content.edges){const source=nodes.get(edge.source)!,target=nodes.get(edge.target)!,a=technicalCategory(source),b=technicalCategory(target),auxiliary=[a,b].some(c=>['scheduler','messaging','locking','operations','observability'].includes(c)),curved=auxiliary||a==='client'
  const entry=[...native.cells.values()].find(e=>attr(e.object,'fmType')==='edge'&&attr(e.object,'fmRole')==='main'&&attr(e.object,'fmId')===edge.id)
  if(entry)setStyle(entry,{curved:curved?1:0,bezier:0,rounded:0,...(auxiliary?{dashed:1,dashPattern:'6 4'}:{})})
 }
}
const primary=new Set<TechnicalCategory>(['client','frontend','gateway','service','storage','other'])
const rank:Partial<Record<TechnicalCategory,number>>={client:0,frontend:1,gateway:2,service:3,storage:4}

/** Initial rendering strategy only. No coordinates or synthetic relations enter content.
 * Known technology semantics determine the main chain / auxiliary strips; unknown
 * groups retain their input order and use actual inter-group dependency depth. */
export function layoutTechnical(content:DiagramContent,sizes:ReadonlyMap<string,TechnicalNodeSize>,orientation:'vertical'|'horizontal'='horizontal'){
 const nodes=content.nodes.filter(n=>n.kind!=='note'),members=(id:string)=>nodes.filter(n=>n.groupId===id)
 if(!content.groups.length){
  const depth=new Map(nodes.map(n=>[n.id,0])),incoming=new Map(nodes.map(n=>[n.id,0])),edges=content.edges.filter(e=>e.kind!=='feedback'&&e.source!==e.target)
  for(const e of edges)incoming.set(e.target,(incoming.get(e.target)??0)+1)
  const queue=nodes.filter(n=>incoming.get(n.id)===0).map(n=>n.id)
  for(let i=0;i<queue.length;i++)for(const edge of edges.filter(e=>e.source===queue[i])){depth.set(edge.target,Math.max(depth.get(edge.target)??0,(depth.get(edge.source)??0)+1));incoming.set(edge.target,(incoming.get(edge.target)??0)-1);if(incoming.get(edge.target)===0)queue.push(edge.target)}
  const rows=new Map<number,number>(),placed=nodes.map(node=>{const column=rank[technicalCategory(node)]??depth.get(node.id)??0,row=rows.get(column)??0;rows.set(column,row+1);const s=sizes.get(node.id),x=64+column*330,y=150+row*210;return {node,box:{x:orientation==='horizontal'?x:y,y:orientation==='horizontal'?y:x,width:s?.width??180,height:Math.max(148,s?.height??148)}}})
  return {placed,regions:[] as TechnicalRegion[],orientation}
 }
 const category=(id:string):TechnicalCategory=>{const counts=new Map<TechnicalCategory,number>();for(const n of members(id)){const c=technicalCategory(n);counts.set(c,(counts.get(c)??0)+1)}return [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]??'other'}
 const groupByNode=new Map(nodes.map(n=>[n.id,n.groupId])),depth=new Map(content.groups.map(g=>[g.id,0]))
 // Bounded relaxation is only a tie-breaker; cycles never generate new links.
 for(let pass=0;pass<content.groups.length;pass++){let changed=false;for(const edge of content.edges){const a=groupByNode.get(edge.source),b=groupByNode.get(edge.target);if(a&&b&&a!==b&&primary.has(category(a))&&primary.has(category(b))&&edge.kind!=='feedback'){const next=Math.min(content.groups.length,(depth.get(a)??0)+1);if(next>(depth.get(b)??0)){depth.set(b,next);changed=true}}}if(!changed)break}
 const groups=content.groups.map((g,index)=>({...g,index,category:category(g.id)})),main=groups.filter(g=>primary.has(g.category)).sort((a,b)=>(rank[a.category]??depth.get(a.id)??2)-(rank[b.category]??depth.get(b.id)??2)||a.index-b.index)
 const top=groups.filter(g=>['scheduler','messaging','locking'].includes(g.category)).sort((a,b)=>['scheduler','messaging','locking'].indexOf(a.category)-['scheduler','messaging','locking'].indexOf(b.category)),bottom=groups.filter(g=>['operations','observability'].includes(g.category)).sort((a,b)=>['operations','observability'].indexOf(a.category)-['operations','observability'].indexOf(b.category))
 const size=(n:DiagramNode)=>({width:Math.max(160,sizes.get(n.id)?.width??180),height:Math.max(148,sizes.get(n.id)?.height??148)})
 const nodeGap=(id:string)=>content.edges.some(e=>e.label?.trim()&&groupByNode.get(e.source)===id&&groupByNode.get(e.target)===id)?64:18
 const placed:TechnicalPlacement[]=[],regions:TechnicalRegion[]=[],gap=150,pad=18,mainPad=48,mainY=top.length?400:150
 const mainHeight=Math.max(340,...main.map(g=>members(g.id).reduce((h,n)=>h+size(n).height,0)+Math.max(0,members(g.id).length-1)*nodeGap(g.id)+2*mainPad))
 const loose=nodes.filter(n=>!n.groupId),clientWidth=Math.max(0,...loose.map(n=>size(n).width)),start=64+(loose.length?clientWidth+gap:0)
 let x=start
 for(const g of main){const list=members(g.id),width=Math.max(208,...list.map(n=>size(n).width+2*pad)),region={id:g.id,box:{x,y:mainY,width,height:mainHeight}};regions.push(region)
  const occupied=list.reduce((h,n)=>h+size(n).height,0),space=(mainHeight-2*mainPad-occupied)/Math.max(1,list.length-1);let y=list.length===1?(mainHeight-size(list[0]).height)/2:mainPad
  for(const node of list){const s=size(node);placed.push({node,parent:g.id,box:{x:(width-s.width)/2,y,width:s.width,height:s.height}});y+=s.height+space}x+=width+gap
 }
 const right=Math.max(start+300,x-gap),service=main.find(g=>g.category==='service'),serviceRegion=regions.find(r=>r.id===service?.id),referenceCenter=serviceRegion?serviceRegion.box.x+serviceRegion.box.width/2:(start+right)/2
 // Terminals stay outside the service containers. Their edges remain real node edges.
 for(const [i,node]of loose.entries()){const s=size(node);placed.push({node,box:{x:64,y:mainY+(mainHeight-s.height)*(loose.length===1?.5:i/(loose.length-1)),...s}})}
 for(const [i,g]of top.entries()){const list=members(g.id),width=Math.max(208,...list.map(n=>size(n).width+2*pad)),height=list.reduce((h,n)=>h+size(n).height,0)+2*pad+Math.max(0,list.length-1)*18
  const preferred=g.category==='scheduler'?main.find(m=>m.category==='gateway'):g.category==='locking'?main.find(m=>m.category==='storage'):service,anchor=regions.find(r=>r.id===preferred?.id),center=anchor?anchor.box.x+anchor.box.width/2:referenceCenter+(i-(top.length-1)/2)*(width+gap)
  let left=center-width/2;while(regions.some(r=>r.box.y===140&&left<r.box.x+r.box.width+48&&left+width>r.box.x-48))left+=width+48
  regions.push({id:g.id,box:{x:left,y:140,width,height}});let y=pad;for(const node of list){const s=size(node);placed.push({node,parent:g.id,box:{x:(width-s.width)/2,y,...s}});y+=s.height+18}
 }
 let bottomX=start
 for(const g of bottom){const list=members(g.id),width=list.reduce((w,n)=>w+size(n).width,0)+Math.max(0,list.length-1)*48+2*pad,height=Math.max(148,...list.map(n=>size(n).height))+mainPad+pad
  regions.push({id:g.id,box:{x:bottomX,y:mainY+mainHeight+170,width,height}});let localX=pad;for(const node of list){const s=size(node);placed.push({node,parent:g.id,box:{x:localX,y:mainPad,...s}});localX+=s.width+48}bottomX+=width+150
 }
 // Explicit direction change rotates the strategy, never the business graph.
 if(orientation==='vertical'){for(const r of regions){const b=r.box;r.box={x:b.y,y:b.x,width:b.height,height:b.width}}for(const p of placed){const b=p.box;p.box={x:b.y,y:b.x,width:b.width,height:b.height}}for(const r of regions){const children=placed.filter(p=>p.parent===r.id);if(main.some(g=>g.id===r.id)){let nextX=mainPad;for(const p of [...children].sort((a,b)=>a.box.x-b.box.x)){p.box.x=Math.max(p.box.x,nextX);nextX=p.box.x+p.box.width+nodeGap(r.id)}}r.box.width=Math.max(r.box.width,...children.map(p=>p.box.x+p.box.width+pad));r.box.height=Math.max(r.box.height,...children.map(p=>p.box.y+p.box.height+pad))}}
 if(orientation==='vertical'){
  const roots=[...regions.map(r=>r.box),...placed.filter(p=>!p.parent).map(p=>p.box)]
  const dy=Math.max(0,128-Math.min(...roots.map(b=>b.y)))
  for(const box of roots)box.y+=dy
 }
 return {placed,regions,orientation}
}
