import { newId,type DiagramDocument,type DiagramScene,type Box } from './model'
import { nodePreset } from './render-config'
import { layoutDocument } from './layout'
import { selectionBounds,type ResizeHandle } from './canvas-geometry'
import {textAppearance} from './floating-text'

export function expandGroups(d:DiagramDocument,ids:string[]){
  const set=new Set(ids)
  for(const members of Object.values(d.presentation.objects?.groups||{}))if(members.some(id=>set.has(id)))members.forEach(id=>set.add(id))
  return d.nodes.filter(n=>set.has(n.id)).map(n=>n.id)
}
export function isLocked(d:DiagramDocument,id:string){return !!d.presentation.objects?.locked?.includes(id)}
export function fullHex(value:string){return /^#[0-9a-f]{3}$/i.test(value)?'#'+value.slice(1).split('').map(c=>c+c).join(''):value}
export function editableSelection(d:DiagramDocument,ids:string[]){return expandGroups(d,ids).filter(id=>!isLocked(d,id))}
function sameValue(a:unknown,b:unknown):boolean{
  if(a===b)return true
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&sameValue((a as any)[k],(b as any)[k]))
}
export function assertLockedObjects(before:DiagramDocument,after:DiagramDocument,visual=true){
  for(const id of before.presentation.objects?.locked||[]){
    // An explicit unlock can be undone/redone with the preceding visual state.
    // Deleting an object cannot implicitly unlock it through ID cleanup.
    if(visual&&after.nodes.some(n=>n.id===id)&&!isLocked(after,id))continue
    if(before.kind!==after.kind)throw new Error('图形中存在锁定节点，请先解锁')
    const changed=!sameValue(before.nodes.find(n=>n.id===id),after.nodes.find(n=>n.id===id))
    const appearance=visual&&(['positions','styles','cards','ranks','texts'] as const).some(k=>!sameValue(before.presentation[k]?.[id],after.presentation[k]?.[id]))
    if(changed||appearance)throw new Error(`节点 ${id} 已锁定，请先解锁`)
  }
}
export function groupObjects(d:DiagramDocument,ids:string[]){
  const members=expandGroups(d,ids);if(members.length<2)throw new Error('至少选择两个节点进行组合')
  if(members.some(id=>isLocked(d,id)))throw new Error('请先解锁所选节点')
  ungroupObjects(d,members)
  const id=newId('canvas_group');((d.presentation.objects??={}).groups??={})[id]=members;return members
}
export function ungroupObjects(d:DiagramDocument,ids:string[]){
  const groups=d.presentation.objects?.groups;if(!groups)return
  if(ids.some(id=>isLocked(d,id)))throw new Error('请先解锁所选节点')
  for(const [id,members] of Object.entries(groups))if(members.some(n=>ids.includes(n)))delete groups[id]
}
function freezeAppearance(d:DiagramDocument,scene:DiagramScene,ids:string[]){
  for(const id of ids){
    const box=scene.nodes.find(n=>n.node.id===id);if(!box)continue
    d.presentation.positions[id]={x:box.x,y:box.y,width:box.width,height:box.height}
    if(box.node.kind==='note'){(d.presentation.texts??={})[id]={...textAppearance(d,box.node),width:box.width};continue}
    const preset=nodePreset(d,box.node.kind)
    ;(d.presentation.styles??={})[id]={shape:preset.shape,fontSize:preset.fontSize,...d.presentation.styles?.[id],fill:fullHex(box.fill),stroke:fullHex(box.color),textColor:fullHex(box.textColor)}
  }
}
export function freezeNewLocks(d:DiagramDocument,before?:DiagramDocument){
  const added=(d.presentation.objects?.locked||[]).filter(id=>!before?.presentation.objects?.locked?.includes(id))
  if(added.length)freezeAppearance(d,layoutDocument(d),added)
}
export function lockObjects(d:DiagramDocument,scene:DiagramScene,ids:string[],lock:boolean){
  const members=expandGroups(d,ids),objects=d.presentation.objects??={},set=new Set(objects.locked||[])
  if(lock)freezeAppearance(d,scene,members)
  for(const id of members)lock?set.add(id):set.delete(id)
  objects.locked=[...set]
}
export function orderedNodes(d:DiagramDocument){
  const order=d.presentation.objects?.order||[],index=new Map(order.map((id,i)=>[id,i]))
  return [...d.nodes].sort((a,b)=>Number(a.kind==='note')-Number(b.kind==='note')||(index.get(a.id)??-1)-(index.get(b.id)??-1))
}
export function reorderObjects(d:DiagramDocument,ids:string[],direction:'front'|'back'|'forward'|'backward'){
  const selected=new Set(editableSelection(d,ids)),order=orderedNodes(d).map(n=>n.id)
  if(!selected.size)throw new Error('请先解锁所选节点')
  let next=order
  if(direction==='front'||direction==='back'){
    const a=order.filter(id=>selected.has(id)),b=order.filter(id=>!selected.has(id));next=direction==='front'?[...b,...a]:[...a,...b]
  }else if(direction==='forward'){for(let i=order.length-2;i>=0;i--)if(selected.has(order[i])&&!selected.has(order[i+1]))[order[i],order[i+1]]=[order[i+1],order[i]]}
  else {for(let i=1;i<order.length;i++)if(selected.has(order[i])&&!selected.has(order[i-1]))[order[i],order[i-1]]=[order[i-1],order[i]]}
  ;(d.presentation.objects??={}).order=next
}
export function scaleSelection(boxes:Array<Box&{node:{id:string}}>,target:Box,handle?:ResizeHandle,proportional=false){
  const bounds=selectionBounds(boxes);if(!bounds)return {}
  // Preserve every object's relative position and minimum size as one gesture.
  let sx=Math.max(target.width/bounds.width,...boxes.map(b=>32/b.width)),sy=Math.max(target.height/bounds.height,...boxes.map(b=>32/b.height))
  if(proportional)sx=sy=Math.max(sx,sy)
  const width=bounds.width*sx,height=bounds.height*sy
  const x=handle?.includes('w')?bounds.x+bounds.width-width:proportional&&handle&&!handle.includes('e')?bounds.x+(bounds.width-width)/2:target.x
  const y=handle?.includes('n')?bounds.y+bounds.height-height:proportional&&handle&&!handle.includes('s')?bounds.y+(bounds.height-height)/2:target.y
  return Object.fromEntries(boxes.map(b=>[b.node.id,{x:x+(b.x-bounds.x)*sx,y:y+(b.y-bounds.y)*sy,width:b.width*sx,height:b.height*sy}]))
}
