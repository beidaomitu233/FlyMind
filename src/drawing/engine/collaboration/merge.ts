import {attr,children,parseNative,serialize,type NativeCell} from '../drawio/xml'
import {personalModelAttributes} from './protocol-patch'

export interface CollaborationConflict {cellId:string;field:string}
export class CollaborationMergeError extends Error {
  readonly code='COLLABORATION_CONFLICT'
  constructor(readonly conflicts:CollaborationConflict[]){super('同一元素存在并发修改，请保留草稿并选择要使用的内容')}
}
const attributes=(element:Element)=>{
  const result:Record<string,string>=Object.create(null)
  for(let i=0;i<element.attributes.length;i++){const a=element.attributes.item(i)!;result[a.name]=a.value}
  return result
}
function canonical(element:Element):string {
  return JSON.stringify([element.nodeName,Object.entries(attributes(element)).sort(([a],[b])=>a.localeCompare(b)),
    children(element).map(canonical),children(element).length?'':element.textContent??''])
}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
const childState=(element:Element)=>children(element).map(canonical)
function setAttribute(element:Element,name:string,value:string|undefined){if(value===undefined)element.removeAttribute(name);else element.setAttribute(name,value)}
function mergeValue<T>(base:T,local:T,remote:T,cellId:string,field:string,conflicts:CollaborationConflict[]):T{
  if(same(local,base)||same(local,remote))return remote
  if(same(remote,base))return local
  conflicts.push({cellId,field});return remote
}
function mergeAttributes(base:Element,local:Element,remote:Element,result:Element,cellId:string,prefix:string,conflicts:CollaborationConflict[],ignore:ReadonlySet<string>=new Set()){
  const b=attributes(base),l=attributes(local),r=attributes(remote)
  for(const key of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){
    if(ignore.has(key))continue
    if(key==='style'){
      // Named styles retain their order. Individual key=value declarations can
      // merge without a remote colour edit reverting a local font edit.
      const split=(value:string|undefined)=>{
        const entries=value?.split(';').filter(Boolean)??[],named=entries.filter(v=>!v.includes('='))
        const props:Record<string,string>=Object.create(null)
        for(const part of entries){const index=part.indexOf('=');if(index>=0)props[part.slice(0,index)]=part.slice(index+1)}
        return {named,props}
      }
      const bs=split(b[key]),ls=split(l[key]),rs=split(r[key])
      const named=mergeValue(bs.named,ls.named,rs.named,cellId,prefix+'style:named',conflicts)
      const props:Record<string,string>=Object.create(null)
      for(const property of new Set([...Object.keys(bs.props),...Object.keys(ls.props),...Object.keys(rs.props)])){
        const value=mergeValue(bs.props[property],ls.props[property],rs.props[property],cellId,prefix+'style:'+property,conflicts)
        if(value!==undefined)props[property]=value
      }
      const text=[...named,...Object.entries(props).map(([name,value])=>name+'='+value)].join(';')
      setAttribute(result,key,text?text+';':undefined)
    }else setAttribute(result,key,mergeValue(b[key],l[key],r[key],cellId,prefix+key,conflicts))
  }
}
function replaceChildren(result:Element,source:Element){
  while(result.firstChild)result.removeChild(result.firstChild)
  for(let i=0;i<source.childNodes.length;i++)result.appendChild(result.ownerDocument!.importNode(source.childNodes.item(i)!,true))
}
function mergeCell(base:NativeCell,local:NativeCell,remote:NativeCell,result:NativeCell,conflicts:CollaborationConflict[]){
  if(base.object.nodeName!==local.object.nodeName||base.object.nodeName!==remote.object.nodeName){
    conflicts.push({cellId:base.id,field:'objectType'});return
  }
  if(base.object!==base.cell)mergeAttributes(base.object,local.object,remote.object,result.object,base.id,'metadata:',conflicts)
  mergeAttributes(base.cell,local.cell,remote.cell,result.cell,base.id,'cell:',conflicts)
  const b=children(base.cell),l=children(local.cell),r=children(remote.cell),out=children(result.cell)
  if(b.length===1&&l.length===1&&r.length===1&&out.length===1&&b[0].nodeName==='mxGeometry'&&l[0].nodeName==='mxGeometry'&&r[0].nodeName==='mxGeometry'){
    mergeAttributes(b[0],l[0],r[0],out[0],base.id,'geometry:',conflicts)
    // Waypoint arrays are an atomic route; combining two independently edited
    // routes would invent geometry. Coordinates themselves merge per attribute.
    const chosen=mergeValue(childState(b[0]),childState(l[0]),childState(r[0]),base.id,'geometry:points',conflicts)
    if(same(chosen,childState(l[0])))replaceChildren(out[0],l[0])
  }else{
    const chosen=mergeValue(childState(base.cell),childState(local.cell),childState(remote.cell),base.id,'children',conflicts)
    if(same(chosen,childState(local.cell)))replaceChildren(result.cell,local.cell)
  }
}
const viewportAttributes=new Set([...personalModelAttributes,'math','shadow','fold'])

/** Three-way merge of rendering state. Inputs are complete, validated snapshots;
 * the base comes from durable server history, never a client supplied baseline.
 * Same-field/delete-edit conflicts are explicit, never silently last-writer-wins.
 */
export function mergeNativeSnapshots(baseXML:string,localXML:string,remoteXML:string):string {
  const base=parseNative(baseXML),local=parseNative(localXML),remote=parseNative(remoteXML)
  const result=parseNative(remoteXML),conflicts:CollaborationConflict[]=[]
  if(attr(base.diagram,'id')!==attr(local.diagram,'id')||attr(base.diagram,'id')!==attr(remote.diagram,'id'))throw new CollaborationMergeError([{cellId:'',field:'pageIdentity'}])
  mergeAttributes(base.diagram,local.diagram,remote.diagram,result.diagram,'','page:',conflicts,new Set(['id']))
  mergeAttributes(base.model,local.model,remote.model,result.model,'','model:',conflicts,viewportAttributes)
  // Fixed Graph.createViewState defaults; native saves materialize these values.
  // Compare semantics so a codec-added default cannot conflict with a real edit.
  for(const [key,value] of [['math','0'],['shadow','0'],['fold','1']])setAttribute(result.model,key,mergeValue(attr(base.model,key)??value,attr(local.model,key)??value,attr(remote.model,key)??value,'','model:'+key,conflicts))
  const ids=new Set([...base.cells.keys(),...local.cells.keys(),...remote.cells.keys()])
  for(const id of ids){
    const b=base.cells.get(id),l=local.cells.get(id),r=remote.cells.get(id),out=result.cells.get(id)
    if(!b){
      if(l&&r&&canonical(l.object)!==canonical(r.object))conflicts.push({cellId:id,field:'insertIdentity'})
      else if(l&&!r)result.root.appendChild(result.document.importNode(l.object,true))
      continue
    }
    if(!l||!r){
      const survivor=l??r
      if(survivor&&canonical(survivor.object)!==canonical(b.object))conflicts.push({cellId:id,field:'delete-edit'})
      else if(!l&&out)result.root.removeChild(out.object)
      continue
    }
    mergeCell(b,l,r,out!,conflicts)
  }
  // Detect explicit stacking reorders separately from inserts/removals. Keep
  // concurrent additions; don't mistake array index shifts for a user reorder.
  const common=[...base.cells.keys()].filter(id=>local.cells.has(id)&&remote.cells.has(id))
  const order=(cells:Map<string,NativeCell>)=>[...cells.keys()].filter(id=>common.includes(id))
  const b=order(base.cells),l=order(local.cells),r=order(remote.cells)
  const chosen=mergeValue(b,l,r,'','stackingOrder',conflicts)
  if(!same(chosen,r)){
    const entries=children(result.root),lookup=new Map(entries.map(e=>[attr(e,'id')??attr(children(e,'mxCell')[0],'id'),e]))
    // Insertions keep their existing relative positions; reorder only slots
    // occupied by surviving baseline cells.
    let index=0
    for(const entry of entries){const id=attr(entry,'id')??attr(children(entry,'mxCell')[0],'id');if(id&&common.includes(id))result.root.appendChild(lookup.get(chosen[index++])!);else result.root.appendChild(entry)}
  }
  if(conflicts.length)throw new CollaborationMergeError(conflicts)
  const xml=serialize(result.document)
  try{parseNative(xml)}catch{throw new CollaborationMergeError([{cellId:'',field:'references'}])}
  return xml
}
