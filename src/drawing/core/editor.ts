import { copy,newId,type DiagramDocument,type DiagramScene,type Box } from './model'
export function duplicateNodes(d:DiagramDocument,scene:DiagramScene,ids:string[]):string[]{
  const map=new Map(ids.map(id=>[id,newId()])),oldEdges=[...d.edges]
  for(const n of [...d.nodes])if(map.has(n.id)){const c=copy(n),b=scene.nodes.find(b=>b.node.id===n.id)!;c.id=map.get(n.id)!;if(d.kind==='mindmap')c.parentId=n.parentId?(map.get(n.parentId)||n.parentId):n.id;d.nodes.push(c);if(d.presentation.ranks?.[n.id]!==undefined)d.presentation.ranks[c.id]=d.presentation.ranks[n.id];d.presentation.positions[c.id]={x:b.x+32,y:b.y+32,width:b.width,height:b.height};if(d.presentation.styles?.[n.id])(d.presentation.styles??={})[c.id]=copy(d.presentation.styles[n.id]);if(d.presentation.cards?.[n.id])(d.presentation.cards??={})[c.id]=copy(d.presentation.cards[n.id])}
  for(const e of oldEdges)if(map.has(e.source)&&map.has(e.target)){const id=newId('edge');d.edges.push({...copy(e),id,source:map.get(e.source)!,target:map.get(e.target)!});if(d.presentation.edges?.[e.id]){const s=copy(d.presentation.edges[e.id]);s.points=s.points?.map(p=>({x:p.x+32,y:p.y+32}));if(s.labelPosition)s.labelPosition={x:s.labelPosition.x+32,y:s.labelPosition.y+32};d.presentation.edges[id]=s}}
  return [...map.values()]
}
export type AlignMode='left'|'center'|'top'|'middle'|'horizontal'|'vertical'
export function alignNodes(d:DiagramDocument,scene:DiagramScene,ids:string[],mode:AlignMode){
  const boxes=scene.nodes.filter(n=>ids.includes(n.node.id));if(boxes.length<2)return;const minX=Math.min(...boxes.map(b=>b.x)),minY=Math.min(...boxes.map(b=>b.y)),maxX=Math.max(...boxes.map(b=>b.x+b.width)),maxY=Math.max(...boxes.map(b=>b.y+b.height)),sorted=[...boxes].sort((a,b)=>mode==='vertical'?a.y-b.y:a.x-b.x),gap=mode==='vertical'?(maxY-minY-boxes.reduce((sum,b)=>sum+b.height,0))/(boxes.length-1):(maxX-minX-boxes.reduce((sum,b)=>sum+b.width,0))/(boxes.length-1);let cursor=mode==='vertical'?minY:minX
  for(const b of sorted){const position={...d.presentation.positions[b.node.id],x:b.x,y:b.y};if(mode==='left')position.x=minX;if(mode==='center')position.x=(minX+maxX-b.width)/2;if(mode==='top')position.y=minY;if(mode==='middle')position.y=(minY+maxY-b.height)/2;if(mode==='horizontal'){position.x=cursor;cursor+=b.width+gap}if(mode==='vertical'){position.y=cursor;cursor+=b.height+gap}d.presentation.positions[b.node.id]=position}
}
export function placeNodes(d:DiagramDocument,scene:DiagramScene,boxes:Record<string,Partial<Box>>){
  for(const [id,box] of Object.entries(boxes)){d.presentation.positions[id]={...d.presentation.positions[id],...box};const n=d.nodes.find(n=>n.id===id)!,b=scene.nodes.find(n=>n.node.id===id)!;if(box.x===undefined&&box.y===undefined)continue;const cx=(box.x??b.x)+(box.width??b.width)/2,cy=(box.y??b.y)+(box.height??b.height)/2
    if(d.kind==='swimlane'){const vertical=d.presentation.orientation==='vertical',lane=scene.containers.filter(c=>c.kind==='lane').find(c=>vertical?cx>=c.x&&cx<=c.x+c.width:cy>=c.y&&cy<=c.y+c.height),phase=scene.containers.filter(c=>c.kind==='phase').find(c=>vertical?cy>=c.y&&cy<=c.y+c.height:cx>=c.x&&cx<=c.x+c.width);if(lane)n.laneId=lane.id;if(phase){n.phaseId=phase.id||undefined;(d.presentation.ranks??={})[id]=Math.max(0,Math.round(((vertical?cy-phase.y:cx-phase.x)-62)/(vertical?116:224)))}}
    if(d.kind==='architecture'){const g=scene.containers.find(c=>c.kind==='layer'&&cy>=c.y&&cy<=c.y+c.height);if(g)n.groupId=g.id}
  }
}
