import {attr,children,fail,type NativeDocument,type NativeCell} from './xml'
import {businessType,mainEntries} from './state'
import {absoluteRouteBox,type RouteBox,type RoutePoint} from './routing'

export interface OuterReturn {sourceGate:RoutePoint;targetGate:RoutePoint}
/** Only actual contrary collinear portions become temporary solver obstacles.
 * Perpendicular crossings stay legal; immutable routes are never rewritten. */
export function oppositeBlocks(routes:Map<string,RoutePoint[]>,id:string):RouteBox[]{
 const points=routes.get(id)??[],blocks:RouteBox[]=[]
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],vertical=a.x===b.x;if(!vertical&&a.y!==b.y)continue;const from=vertical?a.y:a.x,to=vertical?b.y:b.x
  for(const[other,route]of routes)if(other!==id)for(let j=1;j<route.length;j++){
   const c=route[j-1],d=route[j];if(vertical?(c.x!==a.x||d.x!==a.x):(c.y!==a.y||d.y!==a.y))continue
   const start=vertical?c.y:c.x,end=vertical?d.y:d.x,low=Math.max(Math.min(from,to),Math.min(start,end)),high=Math.min(Math.max(from,to),Math.max(start,end))
   if(Math.sign(to-from)===Math.sign(end-start)||high-low<=1)continue
   blocks.push({id:id+':opposite:'+blocks.length,x:vertical?a.x-1:low,y:vertical?low:a.y-1,w:vertical?2:high-low,h:vertical?high-low:2})
  }
 }
 return blocks
}
export function assertOuterSeparation(routes:Map<string,RoutePoint[]>,outerIds:Set<string>){
 const tracks=new Map<string,Array<{id:string;low:number;high:number;sign:number}>>()
 for(const[id,points]of routes)for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],vertical=a.x===b.x;if(!vertical&&a.y!==b.y)continue
  const from=vertical?a.y:a.x,to=vertical?b.y:b.x;if(from===to)continue
  const key=(vertical?'v:':'h:')+(vertical?a.x:a.y),list=tracks.get(key)??[];list.push({id,low:Math.min(from,to),high:Math.max(from,to),sign:Math.sign(to-from)});tracks.set(key,list)
 }
 for(const list of tracks.values()){list.sort((a,b)=>a.low-b.low);for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length&&list[j].low<list[i].high-1;j++)if(list[i].id!==list[j].id&&list[i].sign!==list[j].sign&&(outerIds.has(list[i].id)||outerIds.has(list[j].id)))fail('ROUTING_RETURN_OVERLAP',`返回连线 ${outerIds.has(list[i].id)?list[i].id:list[j].id} 的引入/引出与连线 ${outerIds.has(list[i].id)?list[j].id:list[i].id} 反向重叠；请显式自动排版，未改动其他人工线路`)}
}
export function outerReturnPort(n:NativeDocument,b:RouteBox,start:boolean,horizontal:boolean,retry=false){
 const style=attr(n.cells.get(b.id)!.cell,'style')??'',roundShape=/(?:^|;)(?:rhombus|ellipse)(?:;|$)|(?:^|;)shape=(?:rhombus|ellipse)(?:;|$)/.test(style),fraction=roundShape?.5:retry?(start?.875:.125):start?.75:.25
 if(roundShape&&retry)return horizontal?{x:start?1:0,y:(Math.round(b.y+b.h/2)-b.y)/b.h,dir:start?8:4}:{x:(Math.round(b.x+b.w/2)-b.x)/b.w,y:start?1:0,dir:start?2:1}
 // Off-centre rectangle-side pins would float outside a diamond/ellipse.
 // Their cardinal midpoint is a true native perimeter point in either axis.
 return horizontal?{x:(Math.round(b.x+b.w*fraction)-b.x)/b.w,y:1,dir:2}:{x:1,y:(Math.round(b.y+b.h*fraction)-b.y)/b.h,dir:8}
}
/** Main-axis reversal requires separated boxes. A side-by-side lane handoff
 * is not a return merely because the target's centre differs by a few pixels. */
export function isOuterReturn(n:NativeDocument,e:NativeCell,byId:Map<string,RouteBox>,horizontal:boolean):boolean{
 if(attr(e.object,'fmRole')==='parent-edge'||attr(e.cell,'source')===attr(e.cell,'target'))return false
 if(attr(e.object,'fmKind')==='feedback')return true
 const s=byId.get(attr(e.cell,'source')??''),t=byId.get(attr(e.cell,'target')??'');if(!s||!t)return false
 const source=n.cells.get(s.id)!,target=n.cells.get(t.id)!,sp=attr(source.object,'fmPhaseId'),tp=attr(target.object,'fmPhaseId')
 if(sp&&tp&&sp!==tp){
  const phases=mainEntries(n).filter(x=>businessType(x)==='phase'),a=phases.find(p=>attr(p.object,'fmId')===sp),b=phases.find(p=>attr(p.object,'fmId')===tp)
  if(a&&b){const sourcePhase=absoluteRouteBox(n,a),targetPhase=absoluteRouteBox(n,b);return horizontal?targetPhase.x<sourcePhase.x:targetPhase.y<sourcePhase.y}
 }
 return horizontal?t.x+t.w<=s.x-1:t.y+t.h<=s.y-1
}
/** Only route-level constraints: all actual geometry remains solver-owned.
 * New channels are outside the complete native drawing, including containers,
 * notes and immutable old routes/labels. No business coordinates are added. */
export function planOuterReturns(n:NativeDocument,entries:NativeCell[],byId:Map<string,RouteBox>,horizontal:boolean,oldPoints:RoutePoint[],labelSize:(e:NativeCell)=>{w:number;h:number}):Map<string,OuterReturn>{
 const bounds=[...n.cells.values()].filter(e=>attr(e.cell,'vertex')==='1'&&attr(e.object,'fmControlled')!=='1'&&children(e.cell,'mxGeometry').length).map(e=>absoluteRouteBox(n,e))
 let boundary=Math.ceil(Math.max(0,...bounds.map(b=>horizontal?b.y+b.h:b.x+b.w),...oldPoints.map(p=>horizontal?p.y:p.x))),previousHalf=0
 const result=new Map<string,OuterReturn>()
 for(const e of entries){
  if(!isOuterReturn(n,e,byId,horizontal))continue
  const s=byId.get(attr(e.cell,'source')!)!,t=byId.get(attr(e.cell,'target')!)!,size=labelSize(e),half=Math.ceil((horizontal?size.h:size.w)/2)
  boundary+=previousHalf+half+48;previousHalf=half
  const sp=outerReturnPort(n,s,true,horizontal),tp=outerReturnPort(n,t,false,horizontal)
  let from=Math.round(horizontal?s.x+s.w*sp.x:s.y+s.h*sp.y),to=Math.round(horizontal?t.x+t.w*tp.x:t.y+t.h*tp.y)
  // Explicit feedback can join one rank. Two distinct outside gate points
  // still force a real return loop instead of retracing the same lead-out.
  if(Math.abs(from-to)<32){from+=24;to-=24}
  if(Math.abs(boundary)>49000)fail('ROUTING_LIMIT','外围返回通道超过固定画幅预算，请拆分图形')
  result.set(e.id,{sourceGate:horizontal?{x:from,y:boundary}:{x:boundary,y:from},targetGate:horizontal?{x:to,y:boundary}:{x:boundary,y:to}})
 }
 return result
}
