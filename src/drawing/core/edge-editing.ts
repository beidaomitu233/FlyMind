import type {Point,Port} from './model'
const same=(a:Point,b:Point)=>Math.abs(a.x-b.x)<.01&&Math.abs(a.y-b.y)<.01
export function simplifyOrthogonal(points:Point[]){const p=points.filter((a,i)=>!i||!same(a,points[i-1]));return p.filter((a,i)=>!i||i===p.length-1||!((p[i-1].x===a.x&&a.x===p[i+1].x)||(p[i-1].y===a.y&&a.y===p[i+1].y)))}
export function orthogonalPoints(points:Point[],sourcePort?:Port,targetPort?:Port){
  if(points.length<2)return points
  const stub=(p:Point,port:Port)=>({x:p.x+(port==='left'?-20:port==='right'?20:0),y:p.y+(port==='top'?-20:port==='bottom'?20:0)})
  const aligned=(p:Point,next:Point,port:Port)=>port==='top'?next.x===p.x&&next.y<p.y:port==='bottom'?next.x===p.x&&next.y>p.y:port==='left'?next.y===p.y&&next.x<p.x:next.y===p.y&&next.x>p.x
  const raw=[points[0],...(sourcePort&&!aligned(points[0],points[1],sourcePort)?[stub(points[0],sourcePort)]:[]),...points.slice(1,-1),...(targetPort&&!aligned(points.at(-1)!,points.at(-2)!,targetPort)?[stub(points.at(-1)!,targetPort)]:[]),points.at(-1)!],out:Point[]=[raw[0]]
  for(const b of raw.slice(1)){const a=out.at(-1)!;if(a.x!==b.x&&a.y!==b.y){const prev=out.at(-2),horizontal=prev?prev.y===a.y:sourcePort==='left'||sourcePort==='right';out.push(horizontal?{x:b.x,y:a.y}:{x:a.x,y:b.y})}out.push({...b})}
  return simplifyOrthogonal(out)
}
// Move a complete segment perpendicular to itself. Endpoints remain attached.
export function moveOrthogonalSegment(input:Point[],index:number,delta:Point):Point[]{
  const points=input.map(p=>({...p}));if(index<0||index>=points.length-1)return points
  if(index===points.length-2&&points.length>2)return moveOrthogonalSegment([...points].reverse(),0,delta).reverse()
  const a=points[index],b=points[index+1],horizontal=a.y===b.y,shift=horizontal?delta.y:delta.x
  const move=(p:Point)=>horizontal?{x:p.x,y:p.y+shift}:{x:p.x+shift,y:p.y}
  if(index>0){points[index]=move(a);points[index+1]=move(b);return simplifyOrthogonal(points)}
  const distance=horizontal?b.x-a.x:b.y-a.y,step=Math.sign(distance)*Math.min(24,Math.abs(distance)/3),lead=horizontal?{x:a.x+step,y:a.y}:{x:a.x,y:a.y+step}
  if(points.length===2){const tail=horizontal?{x:b.x-step,y:b.y}:{x:b.x,y:b.y-step};return simplifyOrthogonal([a,lead,move(lead),move(tail),tail,b])}
  return simplifyOrthogonal([a,lead,move(lead),move(b),...points.slice(2)])
}
