import { cardStyle, palette, type DiagramDocument, type DiagramNode, type DiagramScene, type SceneNode, type DiagramEdge } from './model'
import { wrapText } from './text'

export function cardMetrics(d:DiagramDocument,node:DiagramNode,width:number){
  const style=cardStyle(d,node.id),centered=node.kind==='note'||style.variant==='band'
  const titleSize=width<360?23:28,bodySize=width<360?19:23,pad=28
  const titleLines=wrapText(node.label,(width-pad*2)/titleSize)
  const bodyLines=node.description?wrapText(node.description,(width-pad*2)/bodySize):[]
  const iconHeight=!centered&&style.icon!=='none'?52:0
  const titleHeight=titleLines.length*titleSize*1.45,bodyHeight=bodyLines.length*bodySize*1.45
  return {centered,titleSize,bodySize,pad,titleLines,bodyLines,iconHeight,titleHeight,bodyHeight,height:pad*2+iconHeight+titleHeight+(bodyLines.length?14+bodyHeight:0)}
}

// Card rows describe the story; visual coordinates are derived and never stored in nodes.
export function layoutDataflow(d:DiagramDocument,ranks:Map<string,number>):DiagramScene {
  const rows=new Map<number,DiagramNode[]>()
  for(const node of d.nodes){const rank=node.order??ranks.get(node.id)??0;const row=rows.get(rank)||[];row.push(node);rows.set(rank,row)}
  const gap=40,pad=40,maxColumns=Math.max(1,...Array.from(rows.values()).map(row=>row.length)),contentWidth=Math.max(1120,maxColumns*284+(maxColumns-1)*gap)
  const scene:DiagramScene={width:contentWidth+pad*2,height:0,nodes:[],edges:[],containers:[]},p=palette[d.presentation.theme]
  let y=pad
  for(const [,row] of Array.from(rows).sort((a,b)=>a[0]-b[0])){
    const cellWidth=(contentWidth-gap*(row.length-1))/row.length
    const rowHeight=Math.max(...row.map(n=>cardMetrics(d,n,d.presentation.positions[n.id]?.width||cellWidth).height))
    row.forEach((node,i)=>{const style=cardStyle(d,node.id),teal=style.tone==='teal';scene.nodes.push({node,x:pad+i*(cellWidth+gap),y,width:cellWidth,height:rowHeight,color:teal?'#15918e':p.brand,fill:teal?'#eaf7f3':p.soft,textColor:teal?'#118986':p.dark,...d.presentation.positions[node.id]})})
    y+=rowHeight+72
    const feedbacks=d.edges.filter(e=>e.kind==='feedback'&&row.some(n=>n.id===e.source))
    if(feedbacks.length)y+=60+feedbacks.length*44
  }
  scene.height=y-32
  return scene
}

export function routeDataflow(a:SceneNode,b:SceneNode,edge:DiagramEdge,nodes:SceneNode[],feedbackIndex:number){
  const ax=a.x+a.width/2,bx=b.x+b.width/2,ay=a.y+a.height/2,by=b.y+b.height/2
  if(edge.kind==='feedback'){
    const bottom=Math.max(...nodes.filter(n=>n.node.kind!=='note').map(n=>n.y+n.height))+64+feedbackIndex*44
    return {path:`M ${ax} ${a.y+a.height} V ${bottom} H ${bx} V ${b.y+b.height}`,labelX:(ax+bx)/2,labelY:bottom-16,extentY:bottom+32}
  }
  // Multiple sources get separate inlet ports on a wide integration band.
  if(a.y+a.height<b.y&&Math.max(a.x,b.x)<Math.min(a.x+a.width,b.x+b.width)){
    const x1=a.width>b.width?Math.max(a.x+24,Math.min(a.x+a.width-24,bx)):ax
    const x2=b.width>a.width?Math.max(b.x+24,Math.min(b.x+b.width-24,ax)):bx
    const y1=a.y+a.height,y2=b.y,mid=(y1+y2)/2
    return {path:x1===x2?`M ${x1} ${y1} V ${y2}`:`M ${x1} ${y1} V ${mid} H ${x2} V ${y2}`,labelX:(x1+x2)/2+14,labelY:mid,extentY:y2}
  }
  if(Math.abs(ay-by)<1&&a.x+a.width<b.x)return {path:`M ${a.x+a.width} ${ay} H ${b.x}`,labelX:(a.x+a.width+b.x)/2,labelY:ay-16,extentY:ay}
  return undefined
}
