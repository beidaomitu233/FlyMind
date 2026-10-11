import type { DiagramDocument,DiagramNode,Box } from './model'
import { nodeDimensions } from './render-config'

// Measure the actual rendered boxes before placing each subtree.
export function mindPositions(d:DiagramDocument){
  const root=d.nodes.find(n=>!n.parentId)!,children=(n:DiagramNode)=>d.nodes.filter(x=>x.parentId===n.id),sizes=new Map(d.nodes.map(n=>[n.id,nodeDimensions(d,n)])),heights=new Map<string,number>(),positions=new Map<string,Box>()
  function height(n:DiagramNode):number {const h=Math.max(sizes.get(n.id)!.height,children(n).reduce((sum,c,i)=>sum+height(c)+(i?28:0),0));heights.set(n.id,h);return h}
  height(root)
  function branch(n:DiagramNode,nearX:number,y:number,right:boolean){const s=sizes.get(n.id)!,x=right?nearX:nearX-s.width;positions.set(n.id,{x,y:y-s.height/2,width:s.width,height:s.height});const list=children(n),total=list.reduce((sum,c,i)=>sum+heights.get(c.id)!+(i?28:0),0);let top=y-total/2;for(const c of list){const h=heights.get(c.id)!;branch(c,right?x+s.width+100:x-100,top+h/2,right);top+=h+28}}
  const branches=children(root),split=Math.ceil(branches.length/2),s=sizes.get(root.id)!;positions.set(root.id,{x:0,y:-s.height/2,width:s.width,height:s.height})
  for(const [list,right] of [[branches.slice(0,split),true],[branches.slice(split),false]] as const){const total=list.reduce((sum,c,i)=>sum+heights.get(c.id)!+(i?28:0),0);let top=-total/2;for(const c of list){const h=heights.get(c.id)!;branch(c,right?s.width+100:-100,top+h/2,right);top+=h+28}}
  const minX=Math.min(...[...positions.values()].map(b=>b.x)),minY=Math.min(...[...positions.values()].map(b=>b.y));for(const b of positions.values()){b.x+=64-minX;b.y+=64-minY}return positions
}
