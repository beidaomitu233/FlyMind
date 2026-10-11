import { calculateLayout } from '../../utils/layout'
import type { MindNode } from '../../types/mindmap'
import { palette, type DiagramDocument, type DiagramScene, type SceneNode, type DiagramNode, type DiagramEdge } from './model'
import { layoutDataflow, routeDataflow } from './dataflow'
import { nearestPort, pathPoints, polyline, portPoint } from './geometry'

export function layoutDocument(d:DiagramDocument):DiagramScene {
  const p=palette[d.presentation.theme], scene:DiagramScene=d.kind==='dataflow'?layoutDataflow(d,flowRanks({...d,edges:d.edges.filter(e=>e.kind!=='feedback')})):{width:1200,height:800,nodes:[],edges:[],containers:[]}
  const add=(node:DiagramNode,x:number,y:number,width=168,height=68,color=p.brand,fill='#ffffff',textColor='#32495d')=>{
    const override=d.presentation.positions[node.id]||{}
    scene.nodes.push({node,x,y,width,height,color,fill,textColor,...override})
  }
  if(d.kind==='dataflow'){
    // Dedicated card layout above; share the scene and edge pipeline below.
  }else if(d.kind==='swimlane'){
    const phases=d.phases.length?d.phases:[{id:'',label:'流程'}]
    const vertical=d.presentation.orientation==='vertical', laneSize=240
    const step=vertical?116:224
    const sizes=phases.map(ph=>Math.max(170,(Math.max(0,...d.nodes.filter(n=>(n.phaseId||'')===ph.id).map(n=>n.order||0))+1)*step+44))
    const sum=sizes.reduce((a,b)=>a+b,0)
    scene.width=vertical?80+72+d.lanes.length*laneSize:80+120+sum
    scene.height=vertical?144+sum+40:144+d.lanes.length*180+40
    scene.containers.push({id:'title',label:d.title,kind:'title',x:40,y:24,width:scene.width-80,height:64})
    d.lanes.forEach((lane,i)=>scene.containers.push({id:lane.id,label:lane.label,kind:'lane',vertical,x:vertical?112+i*laneSize:40,y:vertical?88:144+i*180,width:vertical?laneSize:scene.width-80,height:vertical?56+sum:180}))
    let offset=0
    phases.forEach((ph,i)=>{
      scene.containers.push({id:ph.id,label:ph.label,kind:'phase',vertical,x:vertical?40:160+offset,y:vertical?144+offset:88,width:vertical?72:sizes[i],height:vertical?sizes[i]:56})
      d.nodes.filter(n=>(n.phaseId||'')===ph.id).forEach(n=>{
        const lane=Math.max(0,d.lanes.findIndex(l=>l.id===n.laneId)), decision=n.kind==='decision',w=decision?152:168,h=decision?92:68
        add(n,vertical?112+lane*laneSize+(laneSize-w)/2:160+offset+28+(n.order||0)*step,vertical?144+offset+28+(n.order||0)*step:144+lane*180+(180-h)/2,w,h,decision?p.accent:p.brand,decision?p.accentSoft:'#fff')
      })
      offset+=sizes[i]
    })
  }else if(d.kind==='architecture'){
    const layers=d.groups.filter(g=>g.kind!=='governance'), governance=d.groups.find(g=>g.kind==='governance')
    scene.width=1880
    scene.containers.push({id:'title',label:d.title,kind:'title',x:24,y:24,width:1832,height:80})
    let y=124
    const mainWidth=governance?1552:1748
    layers.forEach(g=>{
      const list=d.nodes.filter(n=>n.groupId===g.id), cols=Math.min(list.length||1,list.length>6?(g.id==='business'?5:3):list.length||1)
      const rows=Math.max(1,Math.ceil(list.length/cols)), cellW=(mainWidth-24-(cols-1)*14)/cols
      const rowH=Math.max(124,...list.map(n=>54+Math.ceil((n.items?.length||0)/(cellW<260?1:2))*28))
      const height=rows*rowH+(rows-1)*14+24
      scene.containers.push({id:g.id,label:g.label,kind:'layer',tone:g.tone||'blue',x:24,y,width:100,height})
      list.forEach((n,i)=>add(n,140+12+(i%cols)*(cellW+14),y+12+Math.floor(i/cols)*(rowH+14),cellW,rowH,g.tone==='green'?p.accent:g.tone==='amber'?'#d9933f':p.brand,g.tone==='green'?p.accentSoft:g.tone==='amber'?'#fff7ea':p.soft,g.tone==='green'?'#256e51':g.tone==='amber'?'#a76720':p.dark))
      y+=height+18
    })
    scene.height=y+6
    if(governance){
      scene.containers.push({id:governance.id,label:governance.label,kind:'governance',x:1720,y:124,width:136,height:y-142})
      const list=d.nodes.filter(n=>n.groupId===governance.id), h=(y-196)/(list.length||1)
      list.forEach((n,i)=>add(n,1730,182+i*h,116,Math.min(h-16,150),'#a6afd1','#eff1fa','#465473'))
    }
  }else if(d.kind==='mindmap'){
    const root=d.nodes.find(n=>!n.parentId)!, colors=['#596fea','#309f9a','#db9761','#9981cf']
    const build=(n:DiagramNode):MindNode=>({id:n.id,text:n.label,children:d.nodes.filter(x=>x.parentId===n.id).map(build)})
    const positions=calculateLayout(build(root),1600,1000,'logic')
    const minX=Math.min(...Array.from(positions.values()).map(n=>n.x)),minY=Math.min(...Array.from(positions.values()).map(n=>n.y))
    const branches=d.nodes.filter(n=>n.parentId===root.id)
    const branchColor=(n:DiagramNode):string=>{let parent=n;while(parent.parentId&&parent.parentId!==root.id)parent=d.nodes.find(x=>x.id===parent.parentId)!;return colors[Math.max(0,branches.findIndex(x=>x.id===parent.id))%colors.length]}
    d.nodes.forEach(n=>{const b=positions.get(n.id)!;add(n,b.x-minX+64,b.y-minY+64,Math.max(b.width,n.label.length*16+32),n.id===root.id?76:52,n.id===root.id?p.brand:branchColor(n),n.id===root.id?p.brand:'#fff',n.id===root.id?'#fff':'#3c4b63')})
  }else{
    const ranks=flowRanks(d), buckets=new Map<number,DiagramNode[]>()
    d.nodes.forEach(n=>{const rank=n.order??ranks.get(n.id)??0;const list=buckets.get(rank)||[];list.push(n);buckets.set(rank,list)})
    const horizontal=d.presentation.orientation==='horizontal'
    const maxWidth=Math.max(...Array.from(buckets.values()).map(x=>x.length))*260
    for(const [rank,nodes] of buckets){nodes.forEach((n,i)=>{const decision=n.kind==='decision',w=decision?184:200,h=decision?112:70;add(n,horizontal?80+rank*290:80+(maxWidth-nodes.length*260)/2+i*260,horizontal?80+(maxWidth-nodes.length*260)/2+i*260:80+rank*160,w,h,decision?p.accent:p.brand,decision?p.accentSoft:n.kind==='start'||n.kind==='end'?p.soft:'#fff')})}
  }
  for(const n of scene.nodes){scene.width=Math.max(scene.width,n.x+n.width+64);scene.height=Math.max(scene.height,n.y+n.height+64)}
  for(const n of scene.nodes){const style=d.presentation.styles?.[n.node.id];if(style){n.fill=style.fill||n.fill;n.color=style.stroke||n.color;n.textColor=style.textColor||n.textColor}}
  if(d.kind==='mindmap'){scene.width=Math.max(...scene.nodes.map(n=>n.x+n.width))+64;scene.height=Math.max(...scene.nodes.map(n=>n.y+n.height))+64}
  if(d.kind==='flowchart'){scene.width=Math.max(...scene.nodes.map(n=>n.x+n.width))+80;scene.height=Math.max(...scene.nodes.map(n=>n.y+n.height))+80}
  const edges:DiagramEdge[]=d.kind==='mindmap'?d.nodes.filter(n=>n.parentId).map(n=>({id:`parent_${n.id}`,source:n.parentId!,target:n.id})):d.edges
  let feedbackIndex=0
  for(const edge of edges){const a=scene.nodes.find(n=>n.node.id===edge.source),b=scene.nodes.find(n=>n.node.id===edge.target);if(!a||!b)continue
    const color=d.kind==='mindmap'?b.color:d.kind==='dataflow'?a.color:p.edge
    const cardRoute=d.kind==='dataflow'?routeDataflow(a,b,edge,scene.nodes,edge.kind==='feedback'?feedbackIndex++:0):undefined
    let route=cardRoute||routeEdge(a,b,d.kind==='mindmap',d.presentation.orientation==='vertical',edge.source+edge.target,scene.nodes)
    const style=d.presentation.edges?.[edge.id],automatic=pathPoints(route.path)
    if(style?.points||style?.sourcePort||style?.targetPort){
      const start=portPoint(a,style.sourcePort||nearestPort(a,automatic[0]||{x:b.x,y:b.y})),end=portPoint(b,style.targetPort||nearestPort(b,automatic.at(-1)||{x:a.x,y:a.y}))
      const points=style.points!==undefined?style.points:automatic.slice(1,-1)
      const all=[start,...points,end];route={...route,path:polyline(all),labelX:all[Math.floor((all.length-1)/2)].x,labelY:all[Math.floor((all.length-1)/2)].y-16}
      for(const p of all){scene.width=Math.max(scene.width,p.x+64);scene.height=Math.max(scene.height,p.y+64)}
    }
    if(style?.labelPosition)route={...route,labelX:style.labelPosition.x,labelY:style.labelPosition.y}
    if(cardRoute)scene.height=Math.max(scene.height,cardRoute.extentY+32)
    scene.edges.push({edge,...route,color:style?.color||color,points:pathPoints(route.path)})
  }
  return scene
}

// Components in a cycle share a rank; all cycle edges remain in the scene.
function flowRanks(d:DiagramDocument):Map<string,number>{
  const index=new Map<string,number>(),low=new Map<string,number>(),stack:string[]=[],onStack=new Set<string>(),components:string[][]=[];let counter=0
  const visit=(id:string)=>{index.set(id,counter);low.set(id,counter++);stack.push(id);onStack.add(id)
    for(const e of d.edges.filter(e=>e.source===id)){if(!index.has(e.target)){visit(e.target);low.set(id,Math.min(low.get(id)!,low.get(e.target)!))}else if(onStack.has(e.target))low.set(id,Math.min(low.get(id)!,index.get(e.target)!))}
    if(low.get(id)===index.get(id)){const c:string[]=[];let value:string;do{value=stack.pop()!;onStack.delete(value);c.push(value)}while(value!==id);components.push(c)}
  }
  d.nodes.forEach(n=>{if(!index.has(n.id))visit(n.id)})
  const owner=new Map<string,number>();components.forEach((c,i)=>c.forEach(id=>owner.set(id,i)))
  const rank=new Map<number,number>(),incoming=components.map(()=>0),links=new Set<string>()
  d.edges.forEach(e=>{const a=owner.get(e.source)!,b=owner.get(e.target)!;if(a!==b&&!links.has(`${a}:${b}`)){links.add(`${a}:${b}`);incoming[b]++}})
  const queue=incoming.flatMap((v,i)=>v===0?[i]:[]);queue.forEach(i=>rank.set(i,0))
  while(queue.length){const a=queue.shift()!;for(const link of links){const [from,to]=link.split(':').map(Number);if(from===a){rank.set(to,Math.max(rank.get(to)||0,(rank.get(a)||0)+1));if(--incoming[to]===0)queue.push(to)}}}
  return new Map(d.nodes.map(n=>[n.id,rank.get(owner.get(n.id)!)||0]))
}
function routeEdge(a:SceneNode,b:SceneNode,curved:boolean,vertical:boolean,key:string,nodes:SceneNode[]){
  const ax=a.x+a.width/2,ay=a.y+a.height/2,bx=b.x+b.width/2,by=b.y+b.height/2
  if(curved){const right=bx>ax,x1=right?a.x+a.width:a.x,x2=right?b.x:b.x+b.width,mid=(x1+x2)/2;return {path:`M ${x1} ${ay} C ${mid} ${ay}, ${mid} ${by}, ${x2} ${by}`,labelX:mid,labelY:(ay+by)/2}}
  type Point={x:number;y:number}
  const ports=(n:SceneNode)=>{const offset=Math.abs(ay-by)<30&&n.node.kind!=='decision'?(bx>ax?-10:10):0;return [{x:n.x+n.width/2,y:n.y,dx:0,dy:-1},{x:n.x+n.width,y:n.y+n.height/2+offset,dx:1,dy:0},{x:n.x+n.width/2,y:n.y+n.height,dx:0,dy:1},{x:n.x,y:n.y+n.height/2+offset,dx:-1,dy:0}]}
  const left=Math.max(8,Math.min(a.x,b.x)-34),right=Math.max(a.x+a.width,b.x+b.width)+34,top=Math.max(8,Math.min(a.y,b.y)-34),bottom=Math.max(a.y+a.height,b.y+b.height)+34
  let best:Point[]=[],bestCost=Infinity
  const intersects=(u:Point,v:Point,n:SceneNode)=>{
    const margin=8,x1=n.x-margin,x2=n.x+n.width+margin,y1=n.y-margin,y2=n.y+n.height+margin
    if(Math.abs(u.x-v.x)<.01)return u.x>x1&&u.x<x2&&Math.max(u.y,v.y)>y1&&Math.min(u.y,v.y)<y2
    return u.y>y1&&u.y<y2&&Math.max(u.x,v.x)>x1&&Math.min(u.x,v.x)<x2
  }
  for(const [si,start] of ports(a).entries())for(const [ti,end] of ports(b).entries()){
    const u={x:start.x+start.dx*24,y:start.y+start.dy*24},v={x:end.x+end.dx*24,y:end.y+end.dy*24}
    const routes:Point[][]=[[{x:u.x,y:v.y}],[{x:v.x,y:u.y}]]
    for(const x of [left,right,(u.x+v.x)/2])routes.push([{x,y:u.y},{x,y:v.y}])
    for(const y of [top,bottom,(u.y+v.y)/2])routes.push([{x:u.x,y},{x:v.x,y}])
    for(const route of routes){const points=[start,u,...route,v,end];let cost=points.length*8
      const desiredSource=vertical?(by>ay?2:1):(bx>ax?1:2),desiredTarget=vertical?(by>ay?0:1):(bx>ax?3:2)
      cost+=(si===desiredSource?0:90)+(ti===desiredTarget?0:90)
      for(let i=1;i<points.length;i++){const prev=points[i-1],next=points[i];cost+=Math.abs(prev.x-next.x)+Math.abs(prev.y-next.y);for(const n of nodes){if((i===1&&n.node.id===a.node.id)||(i===points.length-1&&n.node.id===b.node.id))continue;if(intersects(prev,next,n))cost+=100000}}
      if(cost<bestCost){bestCost=cost;best=points}
    }
  }
  const points=best.filter((point,i)=>i===0||point.x!==best[i-1].x||point.y!==best[i-1].y)
  const simplified=points.filter((point,i)=>i===0||i===points.length-1||!((points[i-1].x===point.x&&point.x===points[i+1].x)||(points[i-1].y===point.y&&point.y===points[i+1].y)))
  let longest=-1,labelX=0,labelY=0
  for(let i=1;i<simplified.length;i++){const u=simplified[i-1],v=simplified[i],len=Math.hypot(v.x-u.x,v.y-u.y);if(len>longest){longest=len;labelX=(u.x+v.x)/2+(u.x===v.x?14:0);labelY=(u.y+v.y)/2+(u.y===v.y?-12:0)}}
  return {path:simplified.map((p,i)=>i===0?`M ${p.x} ${p.y}`:p.x===simplified[i-1].x?`V ${p.y}`:`H ${p.x}`).join(' '),labelX,labelY}
}
