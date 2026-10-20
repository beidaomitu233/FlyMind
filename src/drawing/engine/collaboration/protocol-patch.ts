import {attr,children,parseNative,serialize,type NativeCell} from '../drawio/xml'

type Fields=Record<string,string|number|null>
/** Personal editor controls, never shared drawing state. Paper/fold are NOT here. */
export const personalModelAttributes=new Set(['dx','dy','grid','gridSize','guides','tooltips','connect','arrows','scrollTop','scrollLeft','scale','translate'])
/** Historical compile mirrors; native codec drops them. Business identity is on
 * the title UserObject, never these non-authoritative model attributes. */
export const codecModelAttributes=new Set(['fmDocumentId','fmKind','fmAdapter','fmProfile','fmProfileVersion'])
const supportedModelAttributes=new Set(['background','page','pageScale','pageWidth','pageHeight','shadow','fold','math','adaptiveColors'])
export class CollaborationProtocolError extends Error {
 readonly status=422;readonly code='COLLABORATION_VIEW_UNSUPPORTED'
 constructor(readonly attribute:string){super('协同暂不支持此页面属性的变更：'+attribute+'；请保留本地草稿')}
}
function viewPatch(from:Element,to:Element):Record<string,string>{
 const changed=new Set<string>()
 for(const element of [from,to])for(let i=0;i<element.attributes.length;i++){const name=element.attributes.item(i)!.name;if(attr(from,name)!==attr(to,name))changed.add(name)}
 for(const name of changed)if(!personalModelAttributes.has(name)&&!codecModelAttributes.has(name)&&!supportedModelAttributes.has(name))throw new CollaborationProtocolError(name)
 const view:Record<string,string>=Object.create(null)
 const emit=(name:string,value:unknown)=>{view[name]=JSON.stringify(value)}
 for(const [attribute,property,defaultValue] of [['page','pageVisible',true],['shadow','shadowVisible',false],['fold','foldingEnabled',true],['math','mathEnabled',false]] as const){
  if(changed.has(attribute)){const value=attr(to,attribute);if(value!==undefined&&value!=='0'&&value!=='1')throw new CollaborationProtocolError(attribute);emit(property,value===undefined?defaultValue:value==='1')}
 }
 if(changed.has('background'))emit('background',attr(to,'background')||null)
 if(changed.has('adaptiveColors'))emit('adaptiveColors',attr(to,'adaptiveColors')??null)
 if(changed.has('pageScale')){const value=Number(attr(to,'pageScale'));if(!Number.isFinite(value)||value<=0)throw new CollaborationProtocolError('pageScale');emit('pageScale',value)}
 if(changed.has('pageWidth')||changed.has('pageHeight')){
  const width=Number(attr(to,'pageWidth')),height=Number(attr(to,'pageHeight'))
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new CollaborationProtocolError('pageFormat')
  emit('pageFormat',{x:0,y:0,width,height})
 }
 return view
}
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
  const native=parseNative(xml),entries=new Map<string,Fields>(),siblings=new Map<string,string>(),geometries=new Map<string,string>()
  const describe=(e:Element):unknown=>{
    const pairs:Array<[string,string]>=[]
    for(let i=0;i<e.attributes.length;i++){const a=e.attributes.item(i)!;const numeric=['mxGeometry','mxPoint','mxRectangle'].includes(e.nodeName)&&['x','y','width','height','relative'].includes(a.name);if(numeric&&Number(a.value)===0)continue;pairs.push([a.name,numeric&&Number.isFinite(Number(a.value))?String(Number(a.value)):a.value])}
    pairs.sort(([a],[b])=>a.localeCompare(b));return [e.nodeName,pairs,children(e).map(describe),children(e).length?'':e.textContent?.trim()??'']
  }
  for(const entry of native.cells.values()){
    const parent=attr(entry.cell,'parent')??'',previous=siblings.get(parent)??''
    entries.set(entry.id,cellState(entry,previous));siblings.set(parent,entry.id)
    const geometry=children(entry.cell,'mxGeometry')[0];if(geometry)geometries.set(entry.id,JSON.stringify(describe(geometry)))
  }
  return {native,entries,geometries}
}
/** Draw.io 31.5.3 public embed `patch` format (DiffSync.js). This computes a
 * delta between visible snapshots; it doesn't depend on the editor's advanced
 * autosave shadow and therefore doesn't drop Undo or unacknowledged changes.
 * Callers must keep native input stable only during capture/apply, not over HTTP.
 */
export function nativeProtocolPatch(fromXML:string,toXML:string):Record<string,unknown>{
  const from=states(fromXML),to=states(toXML),pageId=attr(to.native.diagram,'id')
  if(!pageId||attr(from.native.diagram,'id')!==pageId)throw new Error('COLLABORATION_PAGE_IDENTITY_CHANGED')
  for(const e of [from.native.diagram,to.native.diagram])for(let i=0;i<e.attributes.length;i++){const name=e.attributes.item(i)!.name;if(!['id','name','viewBox'].includes(name)&&attr(from.native.diagram,name)!==attr(to.native.diagram,name))throw new CollaborationProtocolError('diagram.'+name)}
  const updates:Record<string,Fields>=Object.create(null),inserts:Fields[]=[],removes:string[]=[]
  for(const [id,next] of to.entries){
    const prior=from.entries.get(id)
    if(!prior){inserts.push(next);continue}
    const delta:Fields=Object.create(null)
    for(const key of new Set([...Object.keys(prior),...Object.keys(next)])){
      if(key==='id'||prior[key]===next[key])continue
      // XML codec formatting/default zero is not a geometry edit. Rewriting it
      // needlessly invokes native table layout and can synthesize alternateBounds.
      if(key==='geometry'&&from.geometries.get(id)===to.geometries.get(id))continue
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
  const view=viewPatch(from.native.model,to.native.model)
  if(Object.keys(view).length)page.view=view
  if(attr(from.native.diagram,'viewBox')!==attr(to.native.diagram,'viewBox'))page.viewBox=attr(to.native.diagram,'viewBox')??''
  if(attr(from.native.diagram,'name')!==attr(to.native.diagram,'name'))page.name=attr(to.native.diagram,'name')??''
  return Object.keys(page).length?{u:{[pageId]:page}}:{}
}
