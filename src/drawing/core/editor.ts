import { copy,newId,type DiagramDocument,type DiagramScene,type Box } from './model'
import {createFragment,pasteFragment} from './clipboard'
import {selectionBounds} from './canvas-geometry'
import {intersectsBox} from './routing'
export function pinScene(d:DiagramDocument,scene:DiagramScene){for(const b of scene.nodes)d.presentation.positions[b.node.id]={x:b.x,y:b.y,width:b.width,height:b.height,...d.presentation.positions[b.node.id]};for(const e of scene.edges)if(e.edge.label){const style=(d.presentation.edges??={})[e.edge.id]??={};style.labelPosition??={x:e.labelX,y:e.labelY}}}
export function vacantPosition(scene:DiagramScene,box:Box,horizontal=false,includeText=false):Box{
  const stepX=box.width+48,stepY=box.height+48
  for(let radius=0;radius<=30;radius++){const offsets:{x:number;y:number}[]=[];for(let x=-radius;x<=radius;x++){const y=radius-Math.abs(x);offsets.push({x,y});if(y)offsets.push({x,y:-y})}offsets.sort((a,b)=>(a.x*stepX)**2+(a.y*stepY)**2-(b.x*stepX)**2-(b.y*stepY)**2||(horizontal?b.x-a.x:b.y-a.y));for(const offset of offsets){const candidate={...box,x:box.x+offset.x*stepX,y:box.y+offset.y*stepY};if(candidate.x>=16&&candidate.y>=16&&!scene.nodes.some(n=>(includeText||n.node.kind!=='note')&&intersectsBox(candidate,n,24)))return candidate}}
  return {...box,y:Math.max(80,...scene.nodes.map(n=>n.y+n.height))+64}
}
export function duplicateNodes(d:DiagramDocument,scene:DiagramScene,ids:string[]):string[]{
  const fragment=createFragment(d,scene,ids),bounds=selectionBounds(fragment.content.nodes.map(n=>fragment.rendering.positions[n.id] as Box))!
  return pasteFragment(d,fragment,{x:bounds.x+bounds.width/2+32,y:bounds.y+bounds.height/2+32},ids[0])
}
export type AlignMode='left'|'center'|'top'|'middle'|'horizontal'|'vertical'
export function alignNodes(d:DiagramDocument,scene:DiagramScene,ids:string[],mode:AlignMode){
  const boxes=scene.nodes.filter(n=>ids.includes(n.node.id));if(boxes.length<2)return;const minX=Math.min(...boxes.map(b=>b.x)),minY=Math.min(...boxes.map(b=>b.y)),maxX=Math.max(...boxes.map(b=>b.x+b.width)),maxY=Math.max(...boxes.map(b=>b.y+b.height)),sorted=[...boxes].sort((a,b)=>mode==='vertical'?a.y-b.y:a.x-b.x),gap=mode==='vertical'?(maxY-minY-boxes.reduce((sum,b)=>sum+b.height,0))/(boxes.length-1):(maxX-minX-boxes.reduce((sum,b)=>sum+b.width,0))/(boxes.length-1);let cursor=mode==='vertical'?minY:minX
  for(const b of sorted){const position={...d.presentation.positions[b.node.id],x:b.x,y:b.y};if(mode==='left')position.x=minX;if(mode==='center')position.x=(minX+maxX-b.width)/2;if(mode==='top')position.y=minY;if(mode==='middle')position.y=(minY+maxY-b.height)/2;if(mode==='horizontal'){position.x=cursor;cursor+=b.width+gap}if(mode==='vertical'){position.y=cursor;cursor+=b.height+gap}d.presentation.positions[b.node.id]=position}
}
export function transformSelectionPaths(d:DiagramDocument,scene:DiagramScene,boxes:Record<string,Partial<Box>>){
  const before=scene.nodes.filter(n=>Object.hasOwn(boxes,n.node.id)),bounds=selectionBounds(before),after=selectionBounds(before.map(b=>({...b,...boxes[b.node.id]})))
  if(bounds&&after&&before.length>1){const sx=after.width/bounds.width,sy=after.height/bounds.height,affine=before.every(b=>{const n={...b,...boxes[b.node.id]};return Math.abs(n.x-(after.x+(b.x-bounds.x)*sx))<.001&&Math.abs(n.y-(after.y+(b.y-bounds.y)*sy))<.001&&Math.abs(n.width-b.width*sx)<.001&&Math.abs(n.height-b.height*sy)<.001}),transform=(p:{x:number;y:number})=>({x:after.x+(p.x-bounds.x)*sx,y:after.y+(p.y-bounds.y)*sy});for(const edge of scene.edges)if(affine&&Object.hasOwn(boxes,edge.edge.source)&&Object.hasOwn(boxes,edge.edge.target)){const style=d.presentation.edges?.[edge.edge.id];if(style?.points)style.points=style.points.map(transform);if(style?.labelPosition)style.labelPosition=transform(style.labelPosition)}}
}
export function placeNodes(d:DiagramDocument,scene:DiagramScene,boxes:Record<string,Partial<Box>>){
  transformSelectionPaths(d,scene,boxes)
  for(const [id,box] of Object.entries(boxes)){d.presentation.positions[id]={...d.presentation.positions[id],...box};const n=d.nodes.find(n=>n.id===id)!,b=scene.nodes.find(n=>n.node.id===id)!;if(n.kind==='note'){if(box.width!==undefined)((d.presentation.texts??={})[id]??={}).width=Math.max(24,box.width);continue}if(box.x===undefined&&box.y===undefined)continue;const cx=(box.x??b.x)+(box.width??b.width)/2,cy=(box.y??b.y)+(box.height??b.height)/2
    if(d.kind==='swimlane'){
      const vertical=d.presentation.orientation==='vertical',dx=(box.x??b.x)-b.x,dy=(box.y??b.y)-b.y
      if(d.presentation.ranks)delete d.presentation.ranks[id]
      if(Math.abs(vertical?dx:dy)>.01){const lane=scene.containers.filter(c=>c.kind==='lane').find(c=>vertical?cx>=c.x&&cx<=c.x+c.width:cy>=c.y&&cy<=c.y+c.height);if(lane)n.laneId=lane.id}
      if(Math.abs(vertical?dy:dx)>.01){const phase=scene.containers.filter(c=>c.kind==='phase').find(c=>vertical?cy>=c.y&&cy<=c.y+c.height:cx>=c.x&&cx<=c.x+c.width);if(phase)n.phaseId=phase.id||undefined}
    }
    if(d.kind==='architecture'){const g=scene.containers.find(c=>c.kind==='layer'&&cy>=c.y&&cy<=c.y+c.height);if(g)n.groupId=g.id}
  }
}
