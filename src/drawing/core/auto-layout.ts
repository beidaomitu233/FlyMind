import type { DiagramDocument, DiagramNode } from './model'

// Derive ranks from relations. Back edges are retained for rendering but do not
// pull an entire feedback loop into one row. Cross-lane handoffs share a row.
export function automaticRanks(d:DiagramDocument,nodes:DiagramNode[]=d.nodes,swim=false):Map<string,number>{
  const ids=new Set(nodes.map(n=>n.id)),state=new Map<string,number>(),forward:typeof d.edges=[]
  const edges=d.edges.filter(e=>e.kind!=='feedback'&&ids.has(e.source)&&ids.has(e.target))
  function visit(id:string){state.set(id,1);for(const e of edges.filter(e=>e.source===id)){if(state.get(e.target)===1)continue;forward.push(e);if(!state.has(e.target))visit(e.target)}state.set(id,2)}
  for(const n of nodes)if(!state.has(n.id))visit(n.id)
  const incoming=new Map(nodes.map(n=>[n.id,0])),ranks=new Map(nodes.map(n=>[n.id,0])),occupied=new Set<string>()
  for(const e of forward)incoming.set(e.target,incoming.get(e.target)!+1)
  const queue=nodes.filter(n=>!incoming.get(n.id))
  while(queue.length){const n=queue.shift()!;let rank=d.presentation.ranks?.[n.id]??ranks.get(n.id)??0
    if(swim){while(occupied.has(`${n.laneId}:${rank}`))rank++;occupied.add(`${n.laneId}:${rank}`)}
    ranks.set(n.id,rank)
    for(const e of forward.filter(e=>e.source===n.id)){const target=nodes.find(x=>x.id===e.target)!,weight=swim&&n.laneId!==target.laneId?0:1;ranks.set(e.target,Math.max(ranks.get(e.target)!,rank+weight));incoming.set(e.target,incoming.get(e.target)!-1);if(!incoming.get(e.target))queue.push(target)}
  }
  if(!swim){const last=Math.max(0,...nodes.filter(n=>n.kind!=='note').map(n=>ranks.get(n.id)||0));nodes.filter(n=>n.kind==='note').forEach((n,i)=>ranks.set(n.id,d.presentation.ranks?.[n.id]??last+1+i))}
  return ranks
}
