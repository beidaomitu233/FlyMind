import {attr,children,parseNative,serialize,type NativeCell} from '../drawio/xml'

type Fields=Record<string,string|number|null>
function cellState(entry:NativeCell,previous:string):Fields {
  const state:Fields=Object.create(null)
  state.id=entry.id
  for(let i=0;i<entry.cell.attributes.length;i++){
    const a=entry.cell.attributes.item(i)!;if(a.name==='id'||a.name==='value')continue
    state[a.name]=['vertex','edge','connectable','visible','collapsed'].includes(a.name)?Number(a.value):a.value
  }
  if(entry.object===entry.cell)state.value=attr(entry.cell,'value')??null
  else{
    const value=entry.object.cloneNode(false) as Element
    value.removeAttribute('id');state.xmlValue=serialize(value)
  }
  const geometry=children(entry.cell,'mxGeometry')[0]
  if(geometry)state.geometry=serialize(geometry)
  if(children(entry.cell).some(e=>e.nodeName!=='mxGeometry'))throw new Error('COLLABORATION_UNSUPPORTED_CELL_CHILD')
  state.previous=previous
  return state
}
function states(xml:string){
  const native=parseNative(xml),entries=new Map<string,Fields>(),siblings=new Map<string,string>()
  for(const entry of native.cells.values()){
    const parent=attr(entry.cell,'parent')??'',previous=siblings.get(parent)??''
    entries.set(entry.id,cellState(entry,previous));siblings.set(parent,entry.id)
  }
  return {native,entries}
}
/** Draw.io 31.5.3 public embed `patch` format (DiffSync.js). This computes a
 * delta between visible snapshots; it doesn't depend on the editor's advanced
 * autosave shadow and therefore doesn't drop Undo or unacknowledged changes.
 * Callers must keep native input stable only during capture/apply, not over HTTP.
 */
export function nativeProtocolPatch(fromXML:string,toXML:string):Record<string,unknown>{
  const from=states(fromXML),to=states(toXML),pageId=attr(to.native.diagram,'id')
  if(!pageId||attr(from.native.diagram,'id')!==pageId)throw new Error('COLLABORATION_PAGE_IDENTITY_CHANGED')
  const updates:Record<string,Fields>=Object.create(null),inserts:Fields[]=[],removes:string[]=[]
  for(const [id,next] of to.entries){
    const prior=from.entries.get(id)
    if(!prior){inserts.push(next);continue}
    const delta:Fields=Object.create(null)
    for(const key of new Set([...Object.keys(prior),...Object.keys(next)])){
      if(key==='id'||prior[key]===next[key])continue
      const defaults:Fields={vertex:0,edge:0,connectable:1,visible:1,collapsed:0,parent:'',source:'',target:'',previous:''}
      delta[key]=next[key]??defaults[key]??null
    }
    if(Object.keys(delta).length)updates[id]=delta
  }
  for(const id of from.entries.keys())if(!to.entries.has(id))removes.push(id)
  const cells:Record<string,unknown>=Object.create(null)
  if(Object.keys(updates).length)cells.u=updates
  if(inserts.length)cells.i=inserts
  if(removes.length)cells.r=removes
  const page:Record<string,unknown>=Object.create(null)
  if(Object.keys(cells).length)page.cells=cells
  if(attr(from.native.diagram,'name')!==attr(to.native.diagram,'name'))page.name=attr(to.native.diagram,'name')??''
  return Object.keys(page).length?{u:{[pageId]:page}}:{}
}
