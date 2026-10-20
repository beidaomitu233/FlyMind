import {readControlledEdge} from './controlled'
import {ROUTING_SUPPLY,type RoutingSupply} from './routing-supply'
import {attr,children,element,fail,type NativeDocument,type NativeCell} from './xml'
import {box,mainEntries,businessType,geometry,setStyle,styleValue} from './state'
import {textUnits} from './template'
export interface RoutePoint {x:number;y:number}
export interface RouteBox {id:string;x:number;y:number;w:number;h:number}
interface LabelRect {x:number;y:number;w:number;h:number;edgeId:string}
let supply:Promise<RoutingSupply>|undefined
async function loadSupply():Promise<RoutingSupply>{
 if(!supply)supply=(async()=>{
  if(typeof document==='undefined'){
   // A variable URL + vite-ignore isolates Node built-ins from the Vue graph.
   const filename='./routing-node'+(import.meta.url.endsWith('.ts')?'.ts':'.js')
   const adapter=await import(/* @vite-ignore */ new URL(filename,import.meta.url).href)
   return adapter.loadNodeRoutingSupply()
  }
  const directory=new URL('/drawio/js/libavoid-js/',location.origin)
  for(const [file,hash] of Object.entries(ROUTING_SUPPLY)){const response=await fetch(new URL(file,directory),{redirect:'error'});if(!response.ok)fail('ROUTING_SUPPLY_MISSING','固定路由供应缺失');const bytes=await response.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes),actual=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');if(actual!==hash)fail('ROUTING_SUPPLY_HASH_MISMATCH','固定路由供应SHA256不匹配')}
  await import(/* @vite-ignore */ new URL('libavoid.min.js',directory).href)
  const global=globalThis as any,Avoid=await global.__libavoidReady;if(!Avoid||typeof Avoid.Router!=='function')fail('ROUTING_INIT_FAILED','固定libavoid初始化失败')
  await import(/* @vite-ignore */ new URL('libavoid-routing.js',directory).href)
  if(typeof global.AvoidRouting?.computeRoutes!=='function')fail('ROUTING_INIT_FAILED','固定路由API不可用')
  return {Avoid,core:global.AvoidRouting}
 })().catch(error=>{supply=undefined;throw error})
 return supply
}
export function absoluteRouteBox(n:NativeDocument,e:NativeCell):RouteBox{
 const b=box(e);let parent=attr(e.cell,'parent');const seen=new Set<string>();while(parent){if(seen.has(parent))fail('CYCLIC_PARENT','路由容器引用循环');seen.add(parent);const p=n.cells.get(parent);if(!p)break;const g=children(p.cell,'mxGeometry')[0];if(g){b.x+=Number(attr(g,'x')??0);b.y+=Number(attr(g,'y')??0)}parent=attr(p.cell,'parent')}return {id:e.id,x:b.x,y:b.y,w:b.width,h:b.height}
}
const center=(b:RouteBox):RoutePoint=>({x:b.x+b.w/2,y:b.y+b.h/2})
function meetsBox(a:RoutePoint,b:RoutePoint,r:{x:number;y:number;w:number;h:number},gap=0){
 const left=r.x-gap,right=r.x+r.w+gap,top=r.y-gap,bottom=r.y+r.h+gap
 if(a.x===b.x)return a.x>left&&a.x<right&&Math.max(a.y,b.y)>top&&Math.min(a.y,b.y)<bottom
 if(a.y===b.y)return a.y>top&&a.y<bottom&&Math.max(a.x,b.x)>left&&Math.min(a.x,b.x)<right
 // Read-only human routes may include a diagonal segment. Use its bounding
 // corridor conservatively; never let that one segment veto every label slot.
 return Math.max(a.x,b.x)>left&&Math.min(a.x,b.x)<right&&Math.max(a.y,b.y)>top&&Math.min(a.y,b.y)<bottom
}
const overlap=(a:LabelRect,b:{x:number;y:number;w:number;h:number},gap=0)=>a.x<b.x+b.w+gap&&a.x+a.w>b.x-gap&&a.y<b.y+b.h+gap&&a.y+a.h>b.y-gap
/** Containers are not solid obstacles (their children live inside). Their
 * actual header strip and document title are solid, read-only no-entry zones. */
export function nativeForbiddenRegions(n:NativeDocument):RouteBox[]{
 const result:RouteBox[]=[]
 for(const e of n.cells.values()){
  const role=attr(e.object,'fmRole'),type=businessType(e)
  if(type==='layer'&&role==='main'){const b=absoluteRouteBox(n,e),header=Number(styleValue(e,'startSize')??48);result.push({...b,id:e.id+':header',h:Math.min(b.h,header)})}
  else if(type==='decoration'&&role==='title')result.push(absoluteRouteBox(n,e))
 }
 return result
}
export interface NativeLayoutIssue {code:string;cellIds:string[]}
/** Read-only machine gate for AI first layout / explicit relayout only. Manual
 * save/project does not invoke this and therefore does not rearrange drafts. */
export function inspectNativeLayout(n:NativeDocument,checkAspect=false):NativeLayoutIssue[]{
 const nodes=mainEntries(n).filter(e=>businessType(e)==='node').map(e=>absoluteRouteBox(n,e)),regions=nativeForbiddenRegions(n),byId=new Map(nodes.map(b=>[b.id,b])),issues:NativeLayoutIssue[]=[],routes=new Map<string,RoutePoint[]>(),labels:LabelRect[]=[]
 const add=(code:string,...cellIds:string[])=>issues.push({code,cellIds})
 for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++)if(overlap({...nodes[i],edgeId:''},nodes[j]))add('NODE_OVERLAP',nodes[i].id,nodes[j].id)
 for(const node of nodes)for(const region of regions)if(overlap({...node,edgeId:''},region))add('NODE_HEADER_OVERLAP',node.id,region.id)
 for(const e of n.cells.values())if(attr(e.cell,'edge')==='1'&&((attr(e.object,'fmRole')??'main')==='main'&&businessType(e)==='edge'||attr(e.object,'fmRole')==='parent-edge')){
  if(attr(e.cell,'source')===attr(e.cell,'target'))continue // Native loop is separately envelope-validated by the router.
  const occupancy=existingOccupancy(n,e,byId);if(!occupancy)continue;routes.set(e.id,occupancy.points);if(occupancy.label)labels.push(occupancy.label)
  for(let i=1;i<occupancy.points.length;i++){const a=occupancy.points[i-1],b=occupancy.points[i];if(a.x!==b.x&&a.y!==b.y)add('NON_ORTHOGONAL_ROUTE',e.id);for(const obstacle of [...nodes,...regions])if(![attr(e.cell,'source'),attr(e.cell,'target')].includes(obstacle.id)&&meetsBox(a,b,obstacle))add('ROUTE_THROUGH_SHAPE',e.id,obstacle.id)}
 }
 for(let i=0;i<labels.length;i++){
  const label=labels[i];for(const obstacle of [...nodes,...regions])if(overlap(label,obstacle))add('LABEL_OVERLAP_SHAPE',label.edgeId,obstacle.id)
  for(let j=i+1;j<labels.length;j++)if(overlap(label,labels[j]))add('LABEL_OVERLAP_LABEL',label.edgeId,labels[j].edgeId)
  for(const [id,points]of routes)if(id!==label.edgeId)for(let j=1;j<points.length;j++)if(meetsBox(points[j-1],points[j],label))add('ROUTE_THROUGH_LABEL',id,label.edgeId)
  const own=routes.get(label.edgeId)??[],distance=Math.min(...own.slice(1).map((p,j)=>{const a=own[j],dx=Math.max(label.x-Math.max(a.x,p.x),Math.min(a.x,p.x)-label.x-label.w,0),dy=Math.max(label.y-Math.max(a.y,p.y),Math.min(a.y,p.y)-label.y-label.h,0);return Math.hypot(dx,dy)}))
  if(distance>32)add('LABEL_TOO_FAR_FROM_EDGE',label.edgeId)
 }
 // Opposite arrows on one exact shared segment conceal an intermediate step.
 // Same-direction branch/merge stems (including mindmap trees) remain legal.
 const tracks=new Map<string,Array<{edgeId:string;from:number;to:number;direction:number}>>()
 for(const [edgeId,points]of routes)for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],vertical=a.x===b.x;if(!vertical&&a.y!==b.y)continue;const from=vertical?a.y:a.x,to=vertical?b.y:b.x;if(from===to)continue;const key=(vertical?'v:':'h:')+(Math.round((vertical?a.x:a.y)*1e6)/1e6),track=tracks.get(key)??[];track.push({edgeId,from:Math.min(from,to),to:Math.max(from,to),direction:Math.sign(to-from)});tracks.set(key,track)}
 for(const track of tracks.values()){track.sort((a,b)=>a.from-b.from);for(let i=0;i<track.length;i++)for(let j=i+1;j<track.length&&track[j].from<track[i].to-1;j++)if(track[i].edgeId!==track[j].edgeId&&track[i].direction!==track[j].direction){const a=n.cells.get(track[i].edgeId)!,b=n.cells.get(track[j].edgeId)!,reciprocal=attr(a.cell,'source')===attr(b.cell,'target')&&attr(a.cell,'target')===attr(b.cell,'source');if(!reciprocal)add('OPPOSITE_ROUTE_OVERLAP',track[i].edgeId,track[j].edgeId)}}
 if(checkAspect&&nodes.length>=4){const width=Math.max(...nodes.map(b=>b.x+b.w))-Math.min(...nodes.map(b=>b.x)),height=Math.max(...nodes.map(b=>b.y+b.h))-Math.min(...nodes.map(b=>b.y));if(width>1800&&width/height>3.2)add('UNREADABLE_ASPECT_RATIO',...nodes.map(n=>n.id))}
 return issues
}
export function assertNativeLayout(n:NativeDocument,checkAspect=false){const issues=inspectNativeLayout(n,checkAspect).filter(issue=>issue.code!=='UNREADABLE_ASPECT_RATIO');if(issues.length)fail('DRAWING_LAYOUT_FAILED',JSON.stringify({issues:issues.slice(0,20),total:issues.length}))}
function polyline(source:RouteBox,target:RouteBox,bends:RoutePoint[],sourceConstraint?:{x:number;y:number},targetConstraint?:{x:number;y:number}):RoutePoint[]{
 const start=sourceConstraint?{x:source.x+sourceConstraint.x*source.w,y:source.y+sourceConstraint.y*source.h}:center(source),end=targetConstraint?{x:target.x+targetConstraint.x*target.w,y:target.y+targetConstraint.y*target.h}:center(target)
 const result=[start,...bends,end].filter((p,i,a)=>!i||p.x!==a[i-1].x||p.y!==a[i-1].y)
 // Native floating orthogonal endpoints meet the side midpoint; remove the
 // terminal-centre portion when computing label arclength positions.
 if(result.length>1){const a=result[0],b=result[1];result[0]=sourceConstraint?a:Math.abs(a.x-b.x)<=.5?{x:b.x,y:b.y>a.y?source.y+source.h:source.y}:Math.abs(a.y-b.y)<=.5?{x:b.x>a.x?source.x+source.w:source.x,y:b.y}:a;const z=result.length-1,c=result[z],d=result[z-1];result[z]=targetConstraint?c:Math.abs(c.x-d.x)<=.5?{x:d.x,y:d.y>c.y?target.y+target.h:target.y}:Math.abs(c.y-d.y)<=.5?{x:d.x>c.x?target.x+target.w:target.x,y:d.y}:c}
 return result.filter((p,i,a)=>!i||p.x!==a[i-1].x||p.y!==a[i-1].y)
}
function midpoint(points:RoutePoint[]):RoutePoint{let remaining=points.slice(1).reduce((n,p,i)=>n+Math.abs(p.x-points[i].x)+Math.abs(p.y-points[i].y),0)/2;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],length=Math.abs(b.x-a.x)+Math.abs(b.y-a.y);if(remaining<=length)return {x:a.x+(b.x-a.x)*(length?remaining/length:0),y:a.y+(b.y-a.y)*(length?remaining/length:0)};remaining-=length}return points.at(-1)!}
/** Read-only label slots around solver segments; never computes edge routes. */
function labelSlot(n:NativeDocument,entry:NativeCell,points:RoutePoint[],obstacles:RouteBox[],routes:Map<string,RoutePoint[]>,placed:LabelRect[]):{rect?:LabelRect;w:number;h:number}{
 const text=readControlledEdge(n,entry)??attr(entry.object,'label')??attr(entry.cell,'value')??'',font=Number(styleValue(entry,'fontSize')??13),labelWidth=Number(styleValue(entry,'labelWidth')??180),lines=text.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(textUnits(line)*font/Math.max(font,labelWidth-2))),0)
 // Match the conservative native occupancy used by the read-only quality gate
 // (label width + spacing, line-height + spacing), not a smaller text-only box.
 const w=Math.max(16,labelWidth+12),h=Math.ceil(lines*font*1.2)+12,base=midpoint(points),candidates:Array<{rect:LabelRect;cost:number}>=[]
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],horizontal=a.y===b.y,length=Math.abs(b.x-a.x)+Math.abs(b.y-a.y)
  if(length<8)continue
  // Fixed fractions miss narrow but valid channels after a container reorder.
  // Sample obstacle interval boundaries too; this only chooses a label offset,
  // never moves a node/old edge or relaxes any clearance predicate below.
  const from=horizontal?a.x:a.y,to=horizontal?b.x:b.y,half=horizontal?w/2:h/2,positions=new Set([.5,.35,.65,.2,.8,.1,.9,.05,.95])
  const boundary=(coordinate:number)=>{const fraction=(coordinate-from)/(to-from);if(fraction>=0&&fraction<=1)positions.add(fraction)}
  for(const r of [...obstacles,...placed]){const low=horizontal?r.x:r.y,high=low+(horizontal?r.w:r.h);boundary(low-half-9);boundary(high+half+9)}
  for(const[id,route]of routes)if(id!==entry.id)for(const p of route){const coordinate=horizontal?p.x:p.y;boundary(coordinate-half-5);boundary(coordinate+half+5)}
  const fractions=[...positions].sort((a,b)=>Math.abs(a-.5)-Math.abs(b-.5)||a-b).slice(0,256)
  for(const fraction of fractions)for(const sign of [1,-1])for(const distance of [0,horizontal?h/2+8:w/2+8,horizontal?h/2+16:w/2+16,horizontal?h/2+24:w/2+24]){
   const x=a.x+(b.x-a.x)*fraction+(horizontal?0:sign*distance),y=a.y+(b.y-a.y)*fraction+(horizontal?sign*distance:0),rect={x:x-w/2,y:y-h/2,w,h,edgeId:entry.id}
   if(obstacles.some(r=>overlap(rect,r,6))||placed.some(r=>overlap(rect,r,8)))continue
   let crossed=false;for(const [id,route]of routes)if(id!==entry.id)for(let j=1;j<route.length;j++)if(meetsBox(route[j-1],route[j],rect,4)){crossed=true;break}if(crossed)continue
   candidates.push({rect,cost:Math.abs(x-base.x)+Math.abs(y-base.y)+distance*.2})
  }
 }
 candidates.sort((a,b)=>a.cost-b.cost||a.rect.y-b.rect.y||a.rect.x-b.rect.x)
 return {rect:candidates[0]?.rect,w,h}
}
const obsoletePorts=['exitX','exitY','exitDx','exitDy','exitPerimeter','entryX','entryY','entryDx','entryDy','entryPerimeter','sourcePort','targetPort','portConstraint','sourcePortConstraint','targetPortConstraint','portConstraintRotation','sourceJettySize','targetJettySize','noEdgeStyle','elbow','segment','libavoidRouting','direction','loopStyle','orthogonalLoop']
function parentOrigin(n:NativeDocument,e:NativeCell){const p=n.cells.get(attr(e.cell,'parent')??'');return p&&children(p.cell,'mxGeometry').length?absoluteRouteBox(n,p):{x:0,y:0}}
/** Conservative, read-only occupancy of already edited native routes and labels. */
function existingOccupancy(n:NativeDocument,e:NativeCell,byId:Map<string,RouteBox>){
 const s=byId.get(attr(e.cell,'source')??''),t=byId.get(attr(e.cell,'target')??'');if(!s||!t)return
 const origin=parentOrigin(n,e),g=geometry(e),array=children(g,'Array').find(a=>attr(a,'as')==='points'),bends=array?children(array,'mxPoint').map(p=>({x:Number(attr(p,'x')??0)+origin.x,y:Number(attr(p,'y')??0)+origin.y})):[]
 const endpoint=(b:RouteBox,prefix:string)=>({x:b.x+Number(styleValue(e,prefix+'X')??.5)*b.w,y:b.y+Number(styleValue(e,prefix+'Y')??.5)*b.h})
 const a=endpoint(s,'exit'),z=endpoint(t,'entry'),points=bends.length?[a,...bends,z]:[a,{x:a.x,y:z.y},z]
 // Existing mxGeometry.x is a normalized path position, y is normal distance.
 const fraction=(Number(attr(g,'x')??0)+1)/2,total=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);let remaining=Math.max(0,Math.min(1,fraction))*total,anchor=points[0],normal={x:0,y:0}
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],len=Math.hypot(b.x-a.x,b.y-a.y);if(remaining<=len){anchor={x:a.x+(b.x-a.x)*(len?remaining/len:0),y:a.y+(b.y-a.y)*(len?remaining/len:0)};normal={x:len?(b.y-a.y)/len:0,y:len?-(b.x-a.x)/len:0};break}remaining-=len}
 const off=children(g,'mxPoint').find(p=>attr(p,'as')==='offset'),font=Number(styleValue(e,'fontSize')??13),text=readControlledEdge(n,e)??attr(e.object,'label')??attr(e.cell,'value')??'',width=Number(styleValue(e,'labelWidth')??Math.max(24,textUnits(text)*font)),height=Math.ceil(Math.max(1,Math.ceil(textUnits(text)*font/width))*font*1.2)+12,y=Number(attr(g,'y')??0)
 return {points,label:text?{edgeId:e.id,x:anchor.x+normal.x*y+Number(off&&attr(off,'x')||0)-width/2-6,y:anchor.y+normal.y*y+Number(off&&attr(off,'y')||0)-height/2,w:width+12,h:height}:undefined}
}
/** Native Loop + orthogonal perimeter. Proxy points validate only
 * the free-side envelope / label occupancy; no hand-routed loop points are saved. */
function nativeLoop(b:RouteBox,obstacles:RouteBox[]){
 for(const side of ['east','west','south','north']){
  const vertical=side==='east'||side==='west',positive=side==='east'||side==='south',x=positive?1:0
  const segment=Math.min(32,(vertical?b.h:b.w)/4),start=vertical?{x:b.x+x*b.w,y:b.y+b.h/2-segment}:{x:b.x+b.w/2-segment,y:b.y+x*b.h},end=vertical?{x:start.x,y:b.y+b.h/2+segment}:{x:b.x+b.w/2+segment,y:start.y},outer=vertical?start.x+(positive?2*segment:-2*segment):start.y+(positive?2*segment:-2*segment),points=vertical?[start,{x:outer,y:start.y},{x:outer,y:end.y},end]:[start,{x:start.x,y:outer},{x:end.x,y:outer},end]
  if(obstacles.some(o=>o.id!==b.id&&points.slice(1).some((p,i)=>meetsBox(points[i],p,o,12))))continue
  return {points,style:{orthogonalLoop:'0',orthogonal:'1',loopStyle:'loopEdgeStyle',segment:String(segment),direction:side==='east'?'west':side==='west'?'east':side}}
 }
 fail('ROUTING_LOOP_NO_SPACE','原生自环周围没有安全包络')
}
/** Routes only the supplied edges. All current business shapes are obstacles. */
export async function routeNativeEdges(n:NativeDocument,affected:NativeCell[]):Promise<void>{
 if(!affected.length)return
 const nodes=mainEntries(n).filter(e=>businessType(e)==='node').map(e=>absoluteRouteBox(n,e)),vertices=[...nodes,...nativeForbiddenRegions(n)],byId=new Map(nodes.map(v=>[v.id,v]))
 if(nodes.length>500||affected.length>2000)fail('ROUTING_LIMIT','路由输入超过固定预算')
 const title=[...n.cells.values()].find(e=>attr(e.object,'fmRole')==='title'&&attr(e.object,'fmType')==='decoration'),horizontal=title&&attr(title.object,'fmOrientation')==='horizontal',flow=title&&attr(title.object,'fmKind')==='flowchart';const pin=(b:RouteBox,start:boolean)=>horizontal?{x:start?1:0,y:(Math.round(b.y+b.h/2)-b.y)/b.h,dir:start?8:4}:{x:(Math.round(b.x+b.w/2)-b.x)/b.w,y:start?1:0,dir:start?2:1};const edges=affected.map(e=>{const source=attr(e.cell,'source'),target=attr(e.cell,'target'),s=byId.get(source??''),t=byId.get(target??''),forward=flow&&attr(e.object,'fmKind')!=='feedback'&&s&&t&&(horizontal?t.x>s.x:t.y>s.y),returning=flow&&attr(e.object,'fmRole')!=='parent-edge'&&s&&t&&(attr(e.object,'fmKind')==='feedback'||(horizontal?t.x<s.x:t.y<s.y)),side=(b:RouteBox)=>horizontal?{x:(Math.round(b.x+b.w/2)-b.x)/b.w,y:1,dir:2}:{x:1,y:(Math.round(b.y+b.h/2)-b.y)/b.h,dir:8};return {id:e.id,source,target,...(returning&&s&&t?{sourceConstraint:side(s),targetConstraint:side(t),sourceJetty:24,targetJetty:24}:(attr(e.object,'fmRole')==='parent-edge'||forward)&&s&&t?{sourceConstraint:pin(s,true),targetConstraint:pin(t,false),sourceJetty:24,targetJetty:24}:{})}});for(const e of edges)if(!e.source||!e.target||!byId.has(e.source)||!byId.has(e.target))fail('ROUTING_UNSUPPORTED_EDGE','避障路由需要有效业务端点')
 const affectedIds=new Set(edges.map(e=>e.id)),routes=new Map<string,RoutePoint[]>(),placed:LabelRect[]=[]
 for(const old of mainEntries(n).filter(e=>businessType(e)==='edge'&&!affectedIds.has(e.id))){const occupancy=existingOccupancy(n,old,byId);if(occupancy){routes.set(old.id,occupancy.points);if(occupancy.label)placed.push(occupancy.label)}}
 // Existing labels are immutable visual obstacles, not merely forbidden slots
 // for the next label. Otherwise a new parallel route can run through them.
 const solverVertices=[...vertices,...placed.map(r=>({id:r.edgeId+':protected-label',x:r.x,y:r.y,w:r.w,h:r.h}))]
 const loops=new Map(edges.filter(e=>e.source===e.target).map(e=>[e.id,nativeLoop(byId.get(e.source!)!,solverVertices)])),regular=edges.filter(e=>e.source!==e.target)
 let solved:Record<string,RoutePoint[]>={}
 async function solveFixed(obstacles:RouteBox[],items:typeof regular){const {Avoid,core}=await loadSupply(),releases:Array<()=>void>=[],tracked=Object.create(Avoid),result:Record<string,RoutePoint[]>={};tracked.Router=function(...args:any[]){const r=new Avoid.Router(...args),release=r.delete.bind(r);let done=false;r.delete=()=>{if(!done){done=true;release()}};releases.push(()=>r.delete());return r}
 // Fixed midpoint pins fan out into a shared tree stem. The supplied solver
 // rejects duplicate fixed-pin connectors in one transaction; solve each
 // derived branch separately against ALL node obstacles, without inventing paths.
 try{const ordinary=items.filter(edge=>!edge.sourceConstraint),branches=items.filter(edge=>edge.sourceConstraint);if(ordinary.length)Object.assign(result,core.computeRoutes(tracked,obstacles,ordinary,{shapeBufferDistance:16,idealNudgingDistance:36}));for(const edge of branches)Object.assign(result,core.computeRoutes(tracked,obstacles,[edge],{shapeBufferDistance:16,idealNudgingDistance:36}));return result}catch{fail('ROUTING_FAILED','固定libavoid求解失败，未退回可能穿框的路由')}finally{for(const release of releases)release()}}
 if(regular.length)solved=await solveFixed(solverVertices,regular)
 function installRoute(edge:typeof edges[number],bends:RoutePoint[],obstacles=vertices){if(!Array.isArray(bends)||bends.length>2000||bends.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>50000||Math.abs(p.y)>50000))fail('ROUTING_FAILED','固定路由输出无效')
  const points=polyline(byId.get(edge.source!)!,byId.get(edge.target!)!,bends,edge.sourceConstraint,edge.targetConstraint)
  for(let i=1;i<points.length;i++){if(points[i-1].x!==points[i].x&&points[i-1].y!==points[i].y)fail('ROUTING_FAILED',`路由不是正交段 (${edge.id}: ${JSON.stringify([points[i-1],points[i]])})`);for(const obstacle of obstacles)if(obstacle.id!==edge.source&&obstacle.id!==edge.target&&meetsBox(points[i-1],points[i],obstacle))fail('ROUTING_COLLISION','固定路由仍穿过业务节点或保留标签，未返回此布局')}
  routes.set(edge.id,points)
 }
 for(const edge of edges){if(loops.has(edge.id))routes.set(edge.id,loops.get(edge.id)!.points);else installRoute(edge,solved[edge.id],solverVertices)}
 for(const entry of affected){
  let slot:LabelRect|undefined
  const label=readControlledEdge(n,entry)??attr(entry.object,'label')??attr(entry.cell,'value')??''
  if(label){let choice=labelSlot(n,entry,routes.get(entry.id)!,vertices,routes,placed)
   if(!choice.rect&&!loops.has(entry.id)){
    // One bounded retry for this affected edge only, using the fixed solver.
    // Earlier labels/old edges remain immutable; no node or sibling is moved.
    const edge=edges.find(e=>e.id===entry.id)!,obstacles=[...vertices,...placed.map(r=>({id:r.edgeId+':protected-label',x:r.x,y:r.y,w:r.w,h:r.h}))],s=byId.get(edge.source!)!,t=byId.get(edge.target!)!
    // Opposing feedback across one row/column can have only a tiny internal
    // elbow. Give that edge an outward native port pair, then let libavoid
    // find the free external channel; never invent waypoints or move boxes.
    const sameRow=s.y<t.y+t.h&&s.y+s.h>t.y,sameColumn=s.x<t.x+t.w&&s.x+s.w>t.x,outward=(b:RouteBox)=>sameRow?{x:(Math.round(b.x+b.w/2)-b.x)/b.w,y:1,dir:2}:{x:1,y:(Math.round(b.y+b.h/2)-b.y)/b.h,dir:8},rerouted=attr(entry.object,'fmKind')==='feedback'&&(sameRow||sameColumn)?{...edge,sourceConstraint:outward(s),targetConstraint:outward(t),sourceJetty:24,targetJetty:24}:edge
    const retry=await solveFixed(obstacles,[rerouted]);solved[entry.id]=retry[entry.id];installRoute(rerouted,retry[entry.id],obstacles);choice=labelSlot(n,entry,routes.get(entry.id)!,vertices,routes,placed)
   }
   if(!choice.rect)fail('ROUTING_LABEL_NO_SPACE',`连线 ${attr(entry.object,'fmId')??entry.id} 的 ${choice.w}×${choice.h}px 标签没有近线空位；请显式自动排版以预留层间或列间标签通道，未改动其他人工对象`)
   slot=choice.rect;placed.push(slot)
  }
  const parentId=attr(entry.cell,'parent'),parent=parentId?n.cells.get(parentId):undefined,parentBox=parent&&children(parent.cell,'mxGeometry').length?absoluteRouteBox(n,parent):{x:0,y:0}
  const oldGeometry=geometry(entry),g=element(n.document,'mxGeometry',{relative:1,as:'geometry'}),bends=solved[entry.id]??[];if(bends.length){const array=element(n.document,'Array',{as:'points'});for(const p of bends)array.appendChild(element(n.document,'mxPoint',{x:p.x-parentBox.x,y:p.y-parentBox.y}));g.appendChild(array)}
  if(slot){const base=midpoint(routes.get(entry.id)!);g.insertBefore(element(n.document,'mxPoint',{x:Math.round(slot.x+slot.w/2-base.x),y:Math.round(slot.y+slot.h/2-base.y),as:'offset'}),g.firstChild)}
  // The canonical routing core rounds its new interior bends to integer pixels.
  // ELK/user node centres may be fractional: attach to those solver-aligned
  // perimeter coordinates using native constraints, never round existing nodes
  // or weaken the final orthogonal/collision/signature checks.
  const points=routes.get(entry.id)!,source=byId.get(attr(entry.cell,'source')!)!,target=byId.get(attr(entry.cell,'target')!)!,first=points[0],last=points.at(-1)!,ports=loops.has(entry.id)?{}:{exitX:(first.x-source.x)/source.w,exitY:(first.y-source.y)/source.h,exitPerimeter:'0',entryX:(last.x-target.x)/target.w,entryY:(last.y-target.y)/target.h,entryPerimeter:'0'}
  entry.cell.replaceChild(g,oldGeometry);setStyle(entry,{...Object.fromEntries([...obsoletePorts.map(key=>[key,undefined]),['edgeStyle','orthogonalEdgeStyle'],['curved','0'],['bezier','0'],['rounded','0']]),...ports,...loops.get(entry.id)?.style})
 }
}
