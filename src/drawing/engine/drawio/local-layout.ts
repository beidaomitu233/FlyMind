import type {DiagramContent,DiagramNode} from '../../core/model'
import {attr,fail,type NativeDocument,type NativeCell} from './xml'
import {absoluteRouteBox,nativeForbiddenRegions,nativeReadonlyRoutes,inspectNativeLayout,type RouteBox} from './routing'
import {box,setBox,mainEntries,businessType,styleValue,unlocked} from './state'
import {textUnits} from './template'

const intersects=(a:RouteBox,b:RouteBox,gap=0)=>a.x<b.x+b.w+gap&&a.x+a.w>b.x-gap&&a.y<b.y+b.h+gap&&a.y+a.h>b.y-gap
const area=(a:RouteBox,b:RouteBox)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y))
const layers=(n:NativeDocument)=>mainEntries(n).filter(e=>businessType(e)==='layer')
function obstacles(n:NativeDocument,e:NativeCell,container?:NativeCell){
 const nodes=mainEntries(n).filter(x=>businessType(x)==='node'&&x.id!==e.id).map(x=>absoluteRouteBox(n,x)),headers=nativeForbiddenRegions(n).filter(x=>!x.id.startsWith(e.id+':')&&x.id!==e.id)
 const others=layers(n).filter(x=>x.id!==e.id&&x.id!==container?.id).map(x=>absoluteRouteBox(n,x))
 const routes=nativeReadonlyRoutes(n).filter(r=>r.source!==e.id&&r.target!==e.id),labels=routes.flatMap(r=>r.label?[{...r.label,id:r.id+':label'}]:[])
 const segments=routes.flatMap(r=>r.points.slice(1).map((p,i)=>({id:r.id+':segment',x:Math.min(p.x,r.points[i].x)-2,y:Math.min(p.y,r.points[i].y)-2,w:Math.abs(p.x-r.points[i].x)+4,h:Math.abs(p.y-r.points[i].y)+4})))
 return [...nodes,...headers,...others,...labels,...segments]
}
function canGrow(n:NativeDocument,container:NativeCell,width:number,height:number){
 const old=absoluteRouteBox(n,container),candidate={...old,w:width,h:height}
 if(width>50000||height>50000)return false
 const external=[...layers(n).filter(e=>e.id!==container.id),...mainEntries(n).filter(e=>businessType(e)==='node'&&attr(e.cell,'parent')!==container.id)].map(e=>absoluteRouteBox(n,e))
 return external.every(obstacle=>area(candidate,obstacle)<=area(old,obstacle)+.001)
}
/** A bounded local empty-space search. Nodes/headers/labels/saved routes remain
 * read-only obstacles; the destination container alone may grow safely. */
export function placeLocalNode(n:NativeDocument,e:NativeCell,container:NativeCell|undefined,content:DiagramContent,node:DiagramNode,horizontal:boolean){
 if(container)unlocked(n,container)
 const parentId=container?.id??'1',parentBox=container?absoluteRouteBox(n,container):{x:0,y:0,w:0,h:0},b=box(e)
 const start=Number(container&&styleValue(container,'startSize')||0),minX=container?(styleValue(container,'horizontal')==='0'?start+14:24):64,minY=container?(styleValue(container,'horizontal')==='0'?24:start+24):128
 const neighbors:Array<{entry:NativeCell;before:boolean;label?:string}>=content.edges.filter(edge=>edge.source===node.id||edge.target===node.id).flatMap(edge=>{const id=edge.source===node.id?edge.target:edge.source;const entry=mainEntries(n).find(e=>businessType(e)==='node'&&attr(e.object,'fmId')===id);return entry?[{entry,before:edge.target===node.id,label:edge.label}]:[]})
 if(!neighbors.length&&node.parentId){const p=mainEntries(n).find(e=>businessType(e)==='node'&&attr(e.object,'fmId')===node.parentId);if(p)neighbors.push({entry:p,before:true})}
 const neighbor=neighbors.find(x=>x.before)??neighbors[0],nb=neighbor&&absoluteRouteBox(n,neighbor.entry)
 // A node-only safe gap can still be too narrow for a native edge label. Match
 // the router's font/labelWidth budget, plus its box spacing and clearances.
 const edgeGap=Math.max(48,...neighbors.filter(x=>x.label).map(x=>Math.max(64,Math.min(180,Math.ceil(textUnits(x.label!)*13)+8))+32))
 const anchor=nb?{x:nb.x-parentBox.x+(horizontal?(neighbor!.before?nb.w+edgeGap:-b.width-edgeGap):0),y:nb.y-parentBox.y+(!horizontal?(neighbor!.before?nb.h+edgeGap:-b.height-edgeGap):0)}:{x:minX,y:minY}
 const ownBox=absoluteRouteBox(n,e),ownHeaders=nativeForbiddenRegions(n).filter(header=>header.id.startsWith(e.id+':')),fixed=obstacles(n,e,container),xs=new Set([minX,Math.max(minX,anchor.x)]),ys=new Set([minY,Math.max(minY,anchor.y)])
 const candidateGap=edgeGap>48?edgeGap:32
 for(const obstacle of fixed){for(const x of [obstacle.x+obstacle.w-parentBox.x+candidateGap,obstacle.x-parentBox.x-b.width-candidateGap])if(x>=minX)xs.add(x);for(const y of [obstacle.y+obstacle.h-parentBox.y+candidateGap,obstacle.y-parentBox.y-b.height-candidateGap])if(y>=minY)ys.add(y)}
 const bounded=(values:Set<number>,anchor:number)=>[...values].filter(Number.isFinite).sort((a,b)=>Math.abs(a-anchor)-Math.abs(b-anchor)).slice(0,32)
 const candidates=bounded(xs,anchor.x).flatMap(x=>bounded(ys,anchor.y).map(y=>({x,y}))).sort((a,b)=>Math.abs(a.x-anchor.x)+Math.abs(a.y-anchor.y)-Math.abs(b.x-anchor.x)-Math.abs(b.y-anchor.y)).slice(0,512)
 for(const point of candidates){
  const candidate={id:e.id,x:parentBox.x+point.x,y:parentBox.y+point.y,w:b.width,h:b.height}
  const footprint=[candidate,...ownHeaders.map(header=>({...header,x:header.x+candidate.x-ownBox.x,y:header.y+candidate.y-ownBox.y}))]
  if(Math.max(Math.abs(candidate.x),Math.abs(candidate.y),candidate.x+b.width,candidate.y+b.height)>50000||fixed.some(obstacle=>footprint.some(shape=>intersects(shape,obstacle,8))))continue
  const width=container?Math.max(parentBox.w,point.x+b.width+24):0,height=container?Math.max(parentBox.h,point.y+b.height+24):0
  if(container&&!canGrow(n,container,width,height))continue
  e.cell.setAttribute('parent',parentId);setBox(e,point)
  if(container&&(width!==parentBox.w||height!==parentBox.h))setBox(container,{width,height})
  return
 }
 fail('LOCAL_CONTAINER_NO_SPACE','目标附近没有不覆盖已有节点、分组标题、标签或线路的局部空位；请显式自动排版，原图未修改')
}
export function growLocalContainer(n:NativeDocument,container:NativeCell,e:NativeCell){
 const b=box(e),old=box(container),width=Math.max(old.width,b.x+b.width+24),height=Math.max(old.height,b.y+b.height+24)
 if(width===old.width&&height===old.height)return
 unlocked(n,container);if(!canGrow(n,container,width,height))fail('LOCAL_CONTAINER_NO_SPACE','局部分层扩容会覆盖已有对象；请显式自动排版，原图未修改')
 setBox(container,{width,height})
}
/** Existing drafts may contain old defects. Compare conflict magnitude, not just
 * code/cell IDs, so larger overlap or longer line crossings cannot hide in them. */
export function assertNoWorseLocalLayout(before:NativeDocument,after:NativeDocument){
 const metrics=(n:NativeDocument)=>{
  const nodes=mainEntries(n).filter(e=>businessType(e)==='node').map(e=>absoluteRouteBox(n,e)),routes=nativeReadonlyRoutes(n),rects=new Map([...nodes,...nativeForbiddenRegions(n),...routes.flatMap(r=>r.label?[{...r.label,id:r.id}]:[])].map(b=>[b.id,b])),result=new Map<string,number>()
  for(const issue of inspectNativeLayout(n)){
   if(issue.code==='UNREADABLE_ASPECT_RATIO')continue
   const symmetric=['NODE_OVERLAP','LABEL_OVERLAP_LABEL','OPPOSITE_ROUTE_OVERLAP'].includes(issue.code),key=issue.code+'\0'+JSON.stringify(symmetric?[...issue.cellIds].sort():issue.cellIds),a=rects.get(issue.cellIds[0]),b=rects.get(issue.cellIds[1]);let weight=a&&b?Math.max(1,area(a,b)):1
   if(['ROUTE_THROUGH_SHAPE','ROUTE_THROUGH_LABEL'].includes(issue.code)&&b){const route=routes.find(r=>r.id===issue.cellIds[0]);weight=Math.max(1,route?.points.slice(1).reduce((sum,p,i)=>{const q=route.points[i];if(p.x===q.x&&p.x>b.x&&p.x<b.x+b.w)return sum+Math.max(0,Math.min(Math.max(p.y,q.y),b.y+b.h)-Math.max(Math.min(p.y,q.y),b.y));if(p.y===q.y&&p.y>b.y&&p.y<b.y+b.h)return sum+Math.max(0,Math.min(Math.max(p.x,q.x),b.x+b.w)-Math.max(Math.min(p.x,q.x),b.x));return sum},0)??1)}
   if(issue.code==='OPPOSITE_ROUTE_OVERLAP'){
    const first=routes.find(r=>r.id===issue.cellIds[0]),second=routes.find(r=>r.id===issue.cellIds[1]);let length=0
    for(let i=1;i<(first?.points.length??0);i++)for(let j=1;j<(second?.points.length??0);j++){const a=first!.points[i-1],b=first!.points[i],c=second!.points[j-1],d=second!.points[j],vertical=a.x===b.x;if(vertical&&c.x===d.x&&a.x===c.x&&Math.sign(b.y-a.y)!==Math.sign(d.y-c.y))length+=Math.max(0,Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))-Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y)));else if(!vertical&&a.y===b.y&&c.y===d.y&&a.y===c.y&&Math.sign(b.x-a.x)!==Math.sign(d.x-c.x))length+=Math.max(0,Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))-Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x)))}
    weight=Math.max(1,length)
   }
   result.set(key,(result.get(key)??0)+weight)
  }return result
 }
 const old=metrics(before),next=metrics(after),worsened=[...next].filter(([key,value])=>value>(old.get(key)??0)+.001)
 if(worsened.length)fail('LOCAL_LAYOUT_CONFLICT','局部修改新增或加重布局冲突；请保留原图并显式自动排版，不会移动无关人工对象')
}
