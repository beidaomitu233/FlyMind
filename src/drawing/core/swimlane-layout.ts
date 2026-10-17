import type {DiagramDocument,DiagramScene} from './model'
import {palette} from './model'
import {nodeDimensions} from './render-config'
import {automaticRanks} from './auto-layout'
import {textUnits} from './text'
import {fitManualSwimlanePhases,applySwimlanePhaseSizes} from './swimlane-containers'
import {phaseLabelMinimumHeight} from './phase-label'

// Rows use actual node extents; long labels expand only their own row/lane.
export function layoutSwimlane(d:DiagramDocument):DiagramScene{
  const vertical=d.presentation.orientation==='vertical',phases=d.phases.length?d.phases:[{id:'',label:'流程'}],p=palette[d.presentation.theme]
  const dimensions=new Map(d.nodes.map(n=>[n.id,{...nodeDimensions(d,n),...d.presentation.positions[n.id]}]))
  const laneSizes=d.lanes.map(l=>{
    const members=d.nodes.filter(n=>n.laneId===l.id),traffic=d.edges.filter(e=>members.some(n=>n.id===e.source||n.id===e.target)).length
    const gutter=52+Math.min(5,Math.floor(traffic/3))*10
    return Math.max(vertical?260:190,textUnits(l.label)*(vertical?18:8)+32,...members.map(n=>(vertical?dimensions.get(n.id)!.width:dimensions.get(n.id)!.height)+gutter*2))
  })
  const phaseRows=phases.map(phase=>{
    const members=d.nodes.filter(n=>(n.phaseId||'')===phase.id),axis=vertical?'y':'x',connected=new Set(d.edges.flatMap(e=>[e.source,e.target]))
    const flow=members.filter(n=>n.kind!=='note'||connected.has(n.id))
    // A dragged node has concrete geometry; stale row hints must not allocate
    // invisible empty rows. Standalone pinned text is not a workflow step.
    const automatic={...d,presentation:{...d.presentation,ranks:Object.fromEntries(Object.entries(d.presentation.ranks||{}).filter(([id])=>d.presentation.positions[id]?.[axis]===undefined))}}
    const ranks=automaticRanks(automatic,flow,true)
    for(const n of members.filter(n=>n.kind==='note'&&!connected.has(n.id)&&d.presentation.positions[n.id]?.[axis]===undefined)){
      let rank=0;while(members.some(m=>m.id!==n.id&&m.laneId===n.laneId&&ranks.get(m.id)===rank))rank++
      ranks.set(n.id,rank)
    }
    const steps=[...new Set(ranks.values())].sort((a,b)=>a-b),rows:number[]=[],gaps:number[]=[]
    if(!steps.length)steps.push(0)
    for(const rank of steps){
      const row=members.filter(n=>ranks.get(n.id)===rank),labels=d.edges.filter(e=>row.some(n=>n.id===e.source||n.id===e.target)&&e.label)
      const labelSpace=Math.max(0,...labels.map(e=>Math.ceil(textUnits(e.label!)/12)*19+20))
      rows.push(Math.max(vertical?72:160,...row.map(n=>vertical?dimensions.get(n.id)!.height:dimensions.get(n.id)!.width)))
      gaps.push(Math.max(84,labelSpace+36)+Math.min(4,labels.length)*10)
    }
    const natural=rows.reduce((a,b)=>a+b,0)+gaps.slice(0,-1).reduce((a,b)=>a+b,0)+72
    return {members,ranks,steps,rows,gaps,size:Math.max(natural,vertical?phaseLabelMinimumHeight(phase.label):56,d.presentation.phases?.[phase.id]?.size??0)}
  })
  const laneTotal=laneSizes.reduce((a,b)=>a+b,0),phaseTotal=phaseRows.reduce((sum,ph)=>sum+ph.size,0)
  const scene:DiagramScene={width:vertical?152+laneTotal:200+phaseTotal,height:vertical?144+phaseTotal+40:144+laneTotal+40,nodes:[],edges:[],containers:[]}
  scene.containers.push({id:'title',label:d.title,kind:'title',x:40,y:24,width:scene.width-80,height:64})
  scene.containers.push({id:'swimlane-corner',label:'',kind:'corner',x:40,y:88,width:vertical?72:120,height:56})
  let laneOffset=0
  d.lanes.forEach((l,i)=>{scene.containers.push({id:l.id,label:l.label,kind:'lane',vertical,x:vertical?112+laneOffset:40,y:vertical?88:144+laneOffset,width:vertical?laneSizes[i]:scene.width-80,height:vertical?56+phaseTotal:laneSizes[i]});laneOffset+=laneSizes[i]})
  let phaseOffset=0
  phases.forEach((ph,i)=>{
    const layout=phaseRows[i]
    scene.containers.push({id:ph.id,label:ph.label,kind:'phase',vertical,x:vertical?40:160+phaseOffset,y:vertical?144+phaseOffset:88,width:vertical?72:layout.size,height:vertical?layout.size:56})
    for(const n of layout.members){
      const lane=Math.max(0,d.lanes.findIndex(l=>l.id===n.laneId)),rank=layout.ranks.get(n.id)??layout.steps[0],row=Math.max(0,layout.steps.indexOf(rank)),{width,height}=dimensions.get(n.id)!,laneStart=laneSizes.slice(0,lane).reduce((a,b)=>a+b,0)
      const rowStart=layout.rows.slice(0,row).reduce((sum,size,i)=>sum+size+layout.gaps[i],0),extent=layout.rows[row]
      const decision=n.kind==='decision'
      scene.nodes.push({node:n,x:vertical?112+laneStart+(laneSizes[lane]-width)/2:160+phaseOffset+36+rowStart+(extent-width)/2,y:vertical?144+phaseOffset+36+rowStart+(extent-height)/2:144+laneStart+(laneSizes[lane]-height)/2,width,height,color:decision?p.accent:p.brand,fill:decision?p.accentSoft:'#ffffff',textColor:'#32495d',...d.presentation.positions[n.id]})
    }
    phaseOffset+=layout.size
  })
  fitManualSwimlanePhases(scene,d)
  applySwimlanePhaseSizes(scene,d)
  return scene
}
