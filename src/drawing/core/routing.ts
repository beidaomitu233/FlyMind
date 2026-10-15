import type {Box,Point,Port,SceneNode,SceneEdge,DiagramDocument,DiagramEdge,DiagramScene} from './model'
import {nodePreset} from './render-config'
import {textUnits,wrapText} from './text'

export function intersectsBox(a:Box,b:Box,gap=0){return a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y}
export function segmentHitsBox(a:Point,b:Point,box:Box,pad=0){
  if(Math.abs(a.x-b.x)<.001)return a.x>box.x-pad+.01&&a.x<box.x+box.width+pad-.01&&Math.max(a.y,b.y)>box.y-pad+.01&&Math.min(a.y,b.y)<box.y+box.height+pad-.01
  if(Math.abs(a.y-b.y)<.001)return a.y>box.y-pad+.01&&a.y<box.y+box.height+pad-.01&&Math.max(a.x,b.x)>box.x-pad+.01&&Math.min(a.x,b.x)<box.x+box.width+pad-.01
  return false
}
export function edgeLabelBox(label:string,size=13){
  const lines=wrapText(label,14),width=Math.max(28,...lines.map(l=>textUnits(l)*size+18)),height=lines.length*size*1.45+12
  return {width,height,lines}
}
type Segment={a:Point;b:Point}
type Anchor={port:Port;p:Point;stub:Point;penalty:number;key:string}
type Item={key:number;g:number;f:number}
class MinHeap{
  a:Item[]=[]
  push(v:Item){const a=this.a;a.push(v);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p].f<=v.f)break;a[i]=a[p];i=p}a[i]=v}
  pop(){const a=this.a,head=a[0],last=a.pop()!;if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].f<a[c].f)c++;if(a[c].f>=last.f)break;a[i]=a[c];i=c}a[i]=last}return head}
}
const ports:Port[]=['top','right','bottom','left']
const length=(a:Point,b:Point)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y)
function simplify(points:Point[]){
  const p=points.filter((a,i)=>!i||length(a,points[i-1])>.01)
  return p.filter((a,i)=>!i||i===p.length-1||!((p[i-1].x===a.x&&a.x===p[i+1].x)||(p[i-1].y===a.y&&a.y===p[i+1].y)))
}

// A rectilinear visibility grid is shared conceptually by all edges. Searches
// are lazy; previous paths and label boxes reserve their own routing space.
export function orthogonalRouter(d:DiagramDocument,scene:DiagramScene){
  const segments:Segment[]=[],labels:Box[]=[],counts=new Map<string,number>(),vertical=d.presentation.orientation==='vertical'
  const headers:Box[]=scene.containers.flatMap(c=>c.kind==='title'||c.kind==='phase'?[c]:c.kind==='lane'?[{...c,width:c.vertical?c.width:120,height:c.vertical?56:c.height}]:[])
  const nodeBlocks=scene.nodes.map(n=>({x:n.x-10,y:n.y-10,width:n.width+20,height:n.height+20})),baseX:number[]=[],baseY:number[]=[]
  for(const n of scene.nodes){baseX.push(n.x-24,n.x-40,n.x+n.width+24,n.x+n.width+40,n.x+n.width/2);baseY.push(n.y-24,n.y-40,n.y+n.height+24,n.y+n.height+40,n.y+n.height/2)}
  for(const c of scene.containers.filter(c=>c.kind==='lane')){for(const inset of [16,32,48]){if(c.vertical)baseX.push(c.x+inset,c.x+c.width-inset);else baseY.push(c.y+inset,c.y+c.height-inset)}}
  const bounds={left:Math.max(8,Math.min(...scene.nodes.map(n=>n.x))-64),right:Math.max(...scene.nodes.map(n=>n.x+n.width))+72,top:Math.max(d.kind==='swimlane'?160:8,Math.min(...scene.nodes.map(n=>n.y))-64),bottom:Math.max(...scene.nodes.map(n=>n.y+n.height))+72}
  baseX.push(bounds.left,bounds.right);baseY.push(bounds.top,bounds.bottom)
  function anchors(n:SceneNode,preferred:Port,fixed?:Port):Anchor[]{
    const shape=d.presentation.styles?.[n.node.id]?.shape||nodePreset(d,n.node.kind).shape
    return (fixed?[fixed]:ports).map(port=>{
      const key=n.node.id+':'+port,index=fixed?0:counts.get(key)||0,step=index?Math.ceil(index/2)*14*(index%2?-1:1):0
      const side=port==='left'||port==='right',offset=Math.max(-(side?n.height:n.width)*.26,Math.min((side?n.height:n.width)*.26,step)),cx=n.x+n.width/2,cy=n.y+n.height/2
      let p:Point=side?{x:port==='left'?n.x:n.x+n.width,y:cy+offset}:{x:cx+offset,y:port==='top'?n.y:n.y+n.height}
      if(shape==='diamond'){if(side)p.x+=Math.abs(offset)*n.width/n.height*(port==='left'?1:-1);else p.y+=Math.abs(offset)*n.height/n.width*(port==='top'?1:-1)}
      if(shape==='ellipse'){if(side)p.x=cx+(port==='left'?-1:1)*n.width/2*Math.sqrt(1-(offset/(n.height/2))**2);else p.y=cy+(port==='top'?-1:1)*n.height/2*Math.sqrt(1-(offset/(n.width/2))**2)}
      const reach=24+(index%3)*12,stub=side?{x:port==='left'?n.x-reach:n.x+n.width+reach,y:p.y}:{x:p.x,y:port==='top'?n.y-reach:n.y+n.height+reach}
      return {p,stub,port,key,penalty:port===preferred?0:72}
    })
  }
  function congestion(a:Point,b:Point){let cost=0
    for(const s of segments){const h=a.y===b.y,sh=s.a.y===s.b.y
      if(h===sh){const distance=Math.abs(h?a.y-s.a.y:a.x-s.a.x),overlap=Math.min(Math.max(h?a.x:a.y,h?b.x:b.y),Math.max(h?s.a.x:s.a.y,h?s.b.x:s.b.y))-Math.max(Math.min(h?a.x:a.y,h?b.x:b.y),Math.min(h?s.a.x:s.a.y,h?s.b.x:s.b.y));if(distance<14&&overlap>0)cost+=overlap*5*(1-distance/14)}
      else {const u=h?a:s.a,v=h?b:s.b,x=h?s.a.x:a.x,y=h?a.y:s.a.y,top=Math.min(h?s.a.y:a.y,h?s.b.y:b.y),bottom=Math.max(h?s.a.y:a.y,h?s.b.y:b.y);if(x>Math.min(u.x,v.x)+.01&&x<Math.max(u.x,v.x)-.01&&y>top+.01&&y<bottom-.01)cost+=48}
    }return cost
  }
  function route(a:SceneNode,b:SceneNode,edge:DiagramEdge,fixedSource?:Port,fixedTarget?:Port){
    const dx=b.x+b.width/2-a.x-a.width/2,dy=b.y+b.height/2-a.y-a.height/2,across=vertical?Math.abs(dy)<Math.max(a.height,b.height)/2:Math.abs(dx)<Math.max(a.width,b.width)/2
    const back=edge.kind==='feedback'||(vertical?dy<0:dx<0),source:Port=across?(vertical?(dx>0?'right':'left'):(dy>0?'bottom':'top')):vertical?(back?'right':'bottom'):(back?'bottom':'right'),target:Port=across?(vertical?(dx>0?'left':'right'):(dy>0?'top':'bottom')):vertical?(back?'right':'top'):(back?'bottom':'left')
    const starts=anchors(a,source,fixedSource),ends=anchors(b,target,fixedTarget),blocks=[...nodeBlocks,...headers,...labels.map(l=>({x:l.x-6,y:l.y-6,width:l.width+12,height:l.height+12}))]
    const xs=[...baseX],ys=[...baseY];for(const l of labels){xs.push(l.x-12,l.x+l.width+12);ys.push(l.y-12,l.y+l.height+12)}
    const compact=(values:number[],lo:number,hi:number,mandatory:number[])=>{
      let all=[...new Set(values.filter(v=>v>=8))].sort((a,b)=>a-b)
      if(all.length>140){all=all.sort((a,b)=>Math.min(Math.abs(a-lo),Math.abs(a-hi))-Math.min(Math.abs(b-lo),Math.abs(b-hi))).slice(0,136);all.push(Math.max(8,Math.min(...values)),Math.max(...values))}
      return [...new Set([...all,...mandatory])].sort((a,b)=>a-b)
    }
    const x=compact(xs,a.x,b.x,[...starts,...ends].map(p=>p.stub.x)),y=compact(ys,a.y,b.y,[...starts,...ends].map(p=>p.stub.y)),nx=x.length,total=nx*y.length
    const cell=(p:Point)=>y.indexOf(p.y)*nx+x.indexOf(p.x),point=(c:number)=>({x:x[c%nx],y:y[Math.floor(c/nx)]}),targets=new Map<number,Anchor[]>()
    for(const end of ends){const c=cell(end.stub);targets.set(c,[...(targets.get(c)||[]),end])}
    const heap=new MinHeap(),dist=new Map<number,number>(),parent=new Map<number,number>(),roots=new Map<number,Anchor>(),blocked=new Map<number,boolean>()
    const heuristic=(p:Point)=>Math.min(...ends.map(e=>length(p,e.stub)+e.penalty))
    for(const start of starts){if(blocks.some(n=>segmentHitsBox(start.stub,start.stub,n)))continue;const c=cell(start.stub),key=c*3+(start.port==='left'||start.port==='right'?1:2),g=start.penalty+length(start.p,start.stub);if(g<(dist.get(key)??Infinity)){dist.set(key,g);roots.set(key,start);heap.push({key,g,f:g+heuristic(start.stub)})}}
    let best:Item|undefined,bestEnd:Anchor|undefined,bestCost=Infinity,visits=0
    while(heap.a.length&&visits++<18000){const item=heap.pop();if(item.g!==dist.get(item.key))continue;if(item.f>=bestCost)break;const c=Math.floor(item.key/3),dir=item.key%3,p=point(c),ix=c%nx,iy=Math.floor(c/nx)
      for(const end of targets.get(c)||[]){const cost=item.g+end.penalty+length(end.stub,end.p);if(cost<bestCost){bestCost=cost;best=item;bestEnd=end}}
      for(const [ni,nj,nd] of [[ix-1,iy,1],[ix+1,iy,1],[ix,iy-1,2],[ix,iy+1,2]]){if(ni<0||ni>=nx||nj<0||nj>=y.length)continue;const nc=nj*nx+ni,np=point(nc),bk=Math.min(c,nc)*total+Math.max(c,nc)
        let hit=blocked.get(bk);if(hit===undefined){hit=blocks.some(n=>segmentHitsBox(p,np,n));blocked.set(bk,hit)}if(hit)continue
        const key=nc*3+nd,g=item.g+length(p,np)+(dir===nd?0:28)+congestion(p,np);if(g>=(dist.get(key)??Infinity))continue;dist.set(key,g);parent.set(key,item.key);heap.push({key,g,f:g+heuristic(np)})
      }
    }
    if(!best||!bestEnd)return undefined
    const points:Point[]=[];let key=best.key;while(true){points.push(point(Math.floor(key/3)));const prev=parent.get(key);if(prev===undefined)break;key=prev}
    const start=roots.get(key)!;points.reverse();const all=simplify([start.p,...points,bestEnd.p]);counts.set(start.key,(counts.get(start.key)||0)+1);counts.set(bestEnd.key,(counts.get(bestEnd.key)||0)+1)
    return {path:all.map((p,i)=>!i?`M ${p.x} ${p.y}`:p.x===all[i-1].x?`V ${p.y}`:`H ${p.x}`).join(' '),labelX:0,labelY:0}
  }
  function finish(edge:SceneEdge,manualLabel?:Point){
    const points=edge.points||[]
    if(edge.edge.label){
      const metrics=edgeLabelBox(edge.edge.label,d.kind==='dataflow'?22:13),candidates:Point[]=[]
      for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],h=a.y===b.y;for(const t of [.5,.3,.7,.15,.85]){const p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};if(h){candidates.push({x:p.x,y:p.y-metrics.height/2-8},{x:p.x,y:p.y+metrics.height/2+8})}else candidates.push({x:p.x+metrics.width/2+8,y:p.y},{x:p.x-metrics.width/2-8,y:p.y})}}
      if(!candidates.length)candidates.push({x:edge.labelX,y:edge.labelY})
      let best:Box|undefined,bestCost=Infinity
      const midpoint=points[Math.floor(points.length/2)]||{x:edge.labelX,y:edge.labelY}
      for(const [i,p] of candidates.entries()){const box={x:p.x-metrics.width/2,y:p.y-metrics.height/2,width:metrics.width,height:metrics.height}
        if(box.x<8||box.y<8||scene.nodes.some(n=>intersectsBox(box,n,8))||headers.some(n=>intersectsBox(box,n,4))||labels.some(n=>intersectsBox(box,n,8)))continue
        const lines=segments.filter(s=>segmentHitsBox(s.a,s.b,box,4)).length,cost=lines*1000+length(p,midpoint)*.02+i*.2
        if(cost<bestCost){best=box;bestCost=cost}
      }
      if(manualLabel)best={x:manualLabel.x-metrics.width/2,y:manualLabel.y-metrics.height/2,width:metrics.width,height:metrics.height}
      if(!best){ // Search nearby free space when a very long label needs a larger gap.
        outer:for(let radius=24;radius<=480;radius+=24)for(const p of candidates.slice(0,24))for(const sign of [-1,1]){const box={x:p.x-metrics.width/2+radius*sign,y:p.y-metrics.height/2,width:metrics.width,height:metrics.height};if(box.x>=8&&box.y>=8&&![...scene.nodes,...headers,...labels].some(n=>intersectsBox(box,n,8))){best=box;break outer}}
      }
      best??={x:edge.labelX-metrics.width/2,y:edge.labelY-metrics.height/2,width:metrics.width,height:metrics.height}
      edge.labelX=best.x+best.width/2;edge.labelY=best.y+best.height/2;edge.labelBox=best;labels.push(best)
    }
    for(let i=1;i<points.length;i++)segments.push({a:points[i-1],b:points[i]})
  }
  return {route,finish}
}
