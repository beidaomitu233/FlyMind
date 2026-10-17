import type {DiagramDocument,DiagramScene} from './model'

// Manual geometry is authoritative. Do not leave phase bars sized by a second,
// hypothetical automatic layout beneath a canvas of pinned nodes.
export function fitManualSwimlanePhases(scene:DiagramScene,d:DiagramDocument){
  const vertical=d.presentation.orientation==='vertical',axis=vertical?'y':'x',extent=vertical?'height':'width'
  if(!d.nodes.some(n=>n.kind!=='note'&&d.presentation.positions[n.id]?.[axis]!==undefined))return
  const phases=scene.containers.filter(c=>c.kind==='phase'),start=vertical?144:160
  const connected=new Set(d.edges.flatMap(e=>[e.source,e.target]))
  const ranges=phases.map(ph=>{
    const nodes=scene.nodes.filter(n=>(n.node.phaseId||'')===ph.id&&(n.node.kind!=='note'||connected.has(n.node.id)))
    return nodes.length?{min:Math.min(...nodes.map(n=>n[axis])),max:Math.max(...nodes.map(n=>n[axis]+n[extent]))}:undefined
  })
  if(!ranges.some(Boolean))return
  let last=0;ranges.forEach((r,i)=>{if(r)last=i})
  const end=Math.max(start+72,...ranges.filter(Boolean).map(r=>r!.max))+36+(phases.length-1-last)*48
  const boundaries=[start]
  for(let i=1;i<phases.length;i++){
    let left=i-1,right=i
    while(left>=0&&!ranges[left])left--
    while(right<ranges.length&&!ranges[right])right++
    const lo=left>=0?ranges[left]!.max:start,hi=right<ranges.length?ranges[right]!.min:end
    const fraction=(i-left-.5)/(right-left)
    const boundary=left>=0&&right<ranges.length?lo+(hi-lo)*fraction:left<0?start+(hi-start)*i/Math.max(1,right):lo+(end-lo)*(i-left)/(phases.length-left)
    boundaries.push(Math.max(boundaries.at(-1)!+1,boundary))
  }
  boundaries.push(Math.max(end,boundaries.at(-1)!+1))
  phases.forEach((ph,i)=>{ph[axis]=boundaries[i];ph[extent]=boundaries[i+1]-boundaries[i]})
  for(const lane of scene.containers.filter(c=>c.kind==='lane'))lane[extent]=boundaries.at(-1)!-lane[axis]
  scene[extent]=boundaries.at(-1)!+40
}

export function applySwimlanePhaseSizes(scene:DiagramScene,d:DiagramDocument){
  if(!Object.keys(d.presentation.phases||{}).length)return
  const vertical=d.presentation.orientation==='vertical',axis=vertical?'y':'x',extent=vertical?'height':'width'
  let cursor=vertical?144:160
  for(const phase of scene.containers.filter(c=>c.kind==='phase')){
    const members=scene.nodes.filter(n=>(n.node.phaseId||'')===phase.id&&n.node.kind!=='note')
    const required=Math.max(56,...members.map(n=>n[axis]+n[extent]-cursor+24))
    phase[extent]=Math.max(required,d.presentation.phases?.[phase.id]?.size??phase[extent]);phase[axis]=cursor;cursor+=phase[extent]
  }
  for(const lane of scene.containers.filter(c=>c.kind==='lane'))lane[extent]=cursor-lane[axis]
  scene[extent]=cursor+40
}
