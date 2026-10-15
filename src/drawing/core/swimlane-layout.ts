import type {DiagramDocument,DiagramScene} from './model'
import {palette} from './model'
import {nodeDimensions} from './render-config'
import {automaticRanks} from './auto-layout'
import {textUnits} from './text'

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
    const members=d.nodes.filter(n=>(n.phaseId||'')===phase.id),ranks=automaticRanks(d,members,true),last=Math.max(0,...ranks.values()),rows:number[]=[]
    for(let rank=0;rank<=last;rank++){
      const row=members.filter(n=>ranks.get(n.id)===rank),labels=d.edges.filter(e=>row.some(n=>n.id===e.source||n.id===e.target)&&e.label)
      const labelSpace=Math.max(0,...labels.map(e=>Math.ceil(textUnits(e.label!)/12)*19+20))
      rows.push(Math.max(vertical?72:160,...row.map(n=>vertical?dimensions.get(n.id)!.height:dimensions.get(n.id)!.width))+Math.max(84,labelSpace+36)+Math.min(4,labels.length)*10)
    }
    return {members,ranks,rows,size:rows.reduce((a,b)=>a+b,0)+72}
  })
  const laneTotal=laneSizes.reduce((a,b)=>a+b,0),phaseTotal=phaseRows.reduce((sum,ph)=>sum+ph.size,0)
  const scene:DiagramScene={width:vertical?152+laneTotal:200+phaseTotal,height:vertical?144+phaseTotal+40:144+laneTotal+40,nodes:[],edges:[],containers:[]}
  scene.containers.push({id:'title',label:d.title,kind:'title',x:40,y:24,width:scene.width-80,height:64})
  let laneOffset=0
  d.lanes.forEach((l,i)=>{scene.containers.push({id:l.id,label:l.label,kind:'lane',vertical,x:vertical?112+laneOffset:40,y:vertical?88:144+laneOffset,width:vertical?laneSizes[i]:scene.width-80,height:vertical?56+phaseTotal:laneSizes[i]});laneOffset+=laneSizes[i]})
  let phaseOffset=0
  phases.forEach((ph,i)=>{
    const layout=phaseRows[i]
    scene.containers.push({id:ph.id,label:ph.label,kind:'phase',vertical,x:vertical?40:160+phaseOffset,y:vertical?144+phaseOffset:88,width:vertical?72:layout.size,height:vertical?layout.size:56})
    for(const n of layout.members){
      const lane=Math.max(0,d.lanes.findIndex(l=>l.id===n.laneId)),rank=layout.ranks.get(n.id)||0,{width,height}=dimensions.get(n.id)!,laneStart=laneSizes.slice(0,lane).reduce((a,b)=>a+b,0)
      const rowStart=layout.rows.slice(0,rank).reduce((a,b)=>a+b,0),rowNodes=layout.members.filter(m=>layout.ranks.get(m.id)===rank),extent=Math.max(...rowNodes.map(m=>vertical?dimensions.get(m.id)!.height:dimensions.get(m.id)!.width))
      const decision=n.kind==='decision'
      scene.nodes.push({node:n,x:vertical?112+laneStart+(laneSizes[lane]-width)/2:160+phaseOffset+36+rowStart+(extent-width)/2,y:vertical?144+phaseOffset+36+rowStart+(extent-height)/2:144+laneStart+(laneSizes[lane]-height)/2,width,height,color:decision?p.accent:p.brand,fill:decision?p.accentSoft:'#ffffff',textColor:'#32495d',...d.presentation.positions[n.id]})
    }
    phaseOffset+=layout.size
  })
  return scene
}
