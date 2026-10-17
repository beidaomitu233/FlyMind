import type {DiagramDocument,DiagramNode} from './model'

// A handoff is a dependency, even when it changes roles. Only independent
// branches may share a step. Ranks are derived here, never supplied as content.
export function swimlaneRanks(d:DiagramDocument,nodes:DiagramNode[]):Map<string,number>{
  const byId=new Map(nodes.map(n=>[n.id,n])),ids=new Set(byId.keys())
  const edges=d.edges.filter(e=>e.kind!=='feedback'&&ids.has(e.source)&&ids.has(e.target))
  const entries=new Set(d.edges.filter(e=>e.kind!=='feedback'&&!ids.has(e.source)&&ids.has(e.target)).map(e=>e.target))
  const priority=(n:DiagramNode)=>n.kind==='start'?0:entries.has(n.id)?1:n.kind==='note'?3:2
  const compare=(a:DiagramNode,b:DiagramNode)=>priority(a)-priority(b)||d.lanes.findIndex(l=>l.id===a.laneId)-d.lanes.findIndex(l=>l.id===b.laneId)||(a.id<b.id?-1:a.id>b.id?1:0)
  const ordered=[...nodes].sort(compare)
  const outgoing=new Map(nodes.map(n=>[n.id,edges.filter(e=>e.source===n.id).sort((a,b)=>compare(byId.get(a.target)!,byId.get(b.target)!))]))
  const degree=new Map(nodes.map(n=>[n.id,0]))
  for(const e of edges)degree.set(e.target,degree.get(e.target)!+1)

  // Explicit feedback is excluded above. For legacy unmarked cycles, keep a
  // deterministic spanning DAG, beginning at real entries rather than JSON order.
  const state=new Map<string,number>(),forward:typeof edges=[]
  function visit(id:string){
    state.set(id,1)
    for(const e of outgoing.get(id)!){
      if(state.get(e.target)===1)continue
      forward.push(e)
      if(!state.has(e.target))visit(e.target)
    }
    state.set(id,2)
  }
  for(const n of [...ordered.filter(n=>degree.get(n.id)===0),...ordered])if(!state.has(n.id))visit(n.id)

  const incoming=new Map(nodes.map(n=>[n.id,0])),ranks=new Map(nodes.map(n=>[n.id,0]))
  const next=new Map(nodes.map(n=>[n.id,forward.filter(e=>e.source===n.id)]))
  const occupied=new Map<string,Set<number>>()
  for(const e of forward)incoming.set(e.target,incoming.get(e.target)!+1)
  const queue=ordered.filter(n=>incoming.get(n.id)===0)
  const earliest=(n:DiagramNode)=>Math.max(ranks.get(n.id)!,d.presentation.ranks?.[n.id]??0)
  while(queue.length){
    // Process each frontier before the next, preserving parallel alignment.
    queue.sort((a,b)=>earliest(a)-earliest(b)||compare(a,b))
    const n=queue.shift()!,lane=n.laneId||'',used=occupied.get(lane)||new Set<number>()
    let rank=earliest(n)
    while(used.has(rank))rank++
    used.add(rank);occupied.set(lane,used);ranks.set(n.id,rank)
    for(const e of next.get(n.id)!){
      ranks.set(e.target,Math.max(ranks.get(e.target)!,rank+1))
      incoming.set(e.target,incoming.get(e.target)!-1)
      if(incoming.get(e.target)===0)queue.push(byId.get(e.target)!)
    }
  }
  return ranks
}
