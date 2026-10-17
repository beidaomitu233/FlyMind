import type {DiagramDocument,DiagramScene,SceneContainer,Point} from './model'
import {phaseLabelMinimumHeight} from './phase-label'

export function phaseMinimum(d:DiagramDocument,scene:DiagramScene,phase:SceneContainer){
  const vertical=d.presentation.orientation==='vertical',axis=vertical?'y':'x',extent=vertical?'height':'width'
  const members=scene.nodes.filter(n=>(n.node.phaseId||'')===phase.id&&(n.node.kind!=='note'||n[axis]>=phase[axis]&&n[axis]+n[extent]<=phase[axis]+phase[extent]))
  const label=vertical?phaseLabelMinimumHeight(phase.label):80
  return Math.ceil(Math.max(56,label,...members.map(n=>n[axis]+n[extent]-phase[axis]+24)))
}

// Resize a region as one canvas operation. Content and node sizes stay intact;
// the paper after the boundary translates, including hand-edited routes/text.
export function resizeSwimlanePhase(d:DiagramDocument,scene:DiagramScene,id:string,size:number){
  if(d.kind!=='swimlane'||!Number.isFinite(size))throw new Error('阶段尺寸无效')
  const phases=scene.containers.filter(c=>c.kind==='phase'),index=phases.findIndex(c=>c.id===id),phase=phases[index]
  if(!phase||!d.phases.some(p=>p.id===id))throw new Error('阶段不存在')
  const vertical=d.presentation.orientation==='vertical',axis=vertical?'y':'x',extent=vertical?'height':'width'
  const actual=Math.max(phaseMinimum(d,scene,phase),Math.min(50000,Math.round(size))),delta=actual-phase[extent],cut=phase[axis]+phase[extent]
  const following=new Set(phases.slice(index+1).map(c=>c.id))
  if(Math.abs(delta)>.001&&d.nodes.some(n=>following.has(n.phaseId||'')&&d.presentation.objects?.locked?.includes(n.id)))throw new Error('后续阶段存在锁定节点，请先解锁再调整高度')
  d.presentation.phases=Object.fromEntries(phases.filter(c=>c.id).map(c=>[c.id,{size:c.id===id?actual:c[extent]}]))
  for(const n of scene.nodes){const box={x:n.x,y:n.y,width:n.width,height:n.height,...d.presentation.positions[n.node.id]};if(following.has(n.node.phaseId||''))box[axis]+=delta;d.presentation.positions[n.node.id]=box}
  const translate=(p:Point):Point=>({...p,[axis]:p[axis]+(p[axis]>=cut-.001?delta:0)})
  for(const e of scene.edges){
    const style=(d.presentation.edges??={})[e.edge.id]??={}
    if(style.points)style.points=style.points.map(translate)
    if(e.edge.label)style.labelPosition=translate(style.labelPosition||{x:e.labelX,y:e.labelY})
  }
  return actual
}
