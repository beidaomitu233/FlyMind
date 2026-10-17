import {copy,type DiagramContent} from '../../core/model'
import {validateContent} from '../../core/layers'
import {contentHash} from '../content-hash'
import {validateProfilePreferences} from '../preferences'
import {DRAWIO_VERSION,DRAWIO_ADAPTER_VERSION} from '../constants'
import type {DrawingProjectV3} from '../types'
import {projectDrawio} from './index'
import {attr,children,element,fail,parseNative,type NativeCell,type NativeDocument} from './xml'

export const businessType=(entry:NativeCell)=>{const type=attr(entry.object,'fmType');return type==='annotation'?'node':type}
export const primary=(entry:NativeCell)=>['node','annotation','edge','lane','phase','layer'].includes(attr(entry.object,'fmType')??'')&&(attr(entry.object,'fmRole')??'main')==='main'
export const businessKey=(type:string,id:string)=>`${type}\0${id}`
export const bindingId=(type:string,id:string)=>`fm:${type}:${encodeURIComponent(id)}`
export function mainEntries(native:NativeDocument){return [...native.cells.values()].filter(primary)}
export function mainEntry(native:NativeDocument,type:string,id:string):NativeCell{
  const list=mainEntries(native).filter(e=>businessType(e)===type&&attr(e.object,'fmId')===id)
  if(list.length!==1)fail('AMBIGUOUS_BINDING','业务对象缺失或不唯一')
  return list[0]
}
export function geometry(entry:NativeCell):Element{return children(entry.cell,'mxGeometry')[0]??fail('MISSING_GEOMETRY','原生对象缺少几何')}
export function box(entry:NativeCell){const g=geometry(entry);return {x:Number(attr(g,'x')??0),y:Number(attr(g,'y')??0),width:Number(attr(g,'width')??0),height:Number(attr(g,'height')??0)}}
export function setBox(entry:NativeCell,values:Partial<ReturnType<typeof box>>){const g=geometry(entry);for(const [key,value] of Object.entries(values)){if(!Number.isFinite(value)||Math.abs(value)>50000)fail('GEOMETRY_LIMIT','局部扩容超出几何范围');g.setAttribute(key,String(value))}}
export function setStyle(entry:NativeCell,changes:Record<string,string|number|undefined>){
  const parts=(attr(entry.cell,'style')??'').split(';').filter(Boolean),next=parts.filter(p=>!Object.hasOwn(changes,p.split('=')[0]))
  for(const [k,v] of Object.entries(changes))if(v!==undefined)next.push(`${k}=${v}`)
  entry.cell.setAttribute('style',next.join(';')+';')
}
export function styleValue(entry:NativeCell,key:string):string|undefined{return (attr(entry.cell,'style')??'').split(';').filter(p=>p.startsWith(key+'=')).at(-1)?.slice(key.length+1)}
export function ancestorIntersection(native:NativeDocument,entry:NativeCell):NativeCell|undefined{
  let current:NativeCell|undefined=entry
  while(current){if(attr(current.object,'fmRole')==='intersection')return current;const parent=attr(current.cell,'parent');current=parent?native.cells.get(parent):undefined}
}
export function isLocked(native:NativeDocument,entry:NativeCell):boolean{
  let current:NativeCell|undefined=entry
  while(current){if(styleValue(current,'locked')==='1'||styleValue(current,'editable')==='0')return true;const parent=attr(current.cell,'parent');current=parent?native.cells.get(parent):undefined}
  return false
}
export function unlocked(native:NativeDocument,entry:NativeCell){if(isLocked(native,entry))fail('LOCKED_OBJECT','锁定对象及其后代不能修改')}
export function cellSignature(entry:NativeCell):string{
  const describe=(e:Element):unknown=>{const attrs:Array<[string,string]>=[];for(let i=0;i<e.attributes.length;i++){const a=e.attributes.item(i)!,numeric=['mxGeometry','mxPoint','mxRectangle'].includes(e.nodeName)&&['x','y','width','height','relative'].includes(a.name);if(numeric&&Number(a.value)===0)continue;attrs.push([a.name,numeric&&Number.isFinite(Number(a.value))?String(Number(a.value)):a.value])}return [e.nodeName,attrs.sort(([a],[b])=>a<b?-1:a>b?1:0),children(e).map(describe)]}
  return JSON.stringify(describe(entry.object))
}
export function assertNativeLocks(native:NativeDocument,base:NativeDocument,allowExplicitUnlock=false){
  const explicitlyUnlocked=(entry:NativeCell)=>{let current:NativeCell|undefined=entry;while(current){if(styleValue(current,'locked')==='1'||styleValue(current,'editable')==='0'){const edited=native.cells.get(current.id);if(!edited||styleValue(edited,'locked')==='1'||styleValue(edited,'editable')==='0')return false}const parent=attr(current.cell,'parent');current=parent?base.cells.get(parent):undefined}return true}
  for(const entry of base.cells.values())if(isLocked(base,entry)){
    const incoming=native.cells.get(entry.id)
    if(allowExplicitUnlock&&incoming&&!isLocked(native,incoming)&&explicitlyUnlocked(entry))continue
    if(!incoming||cellSignature(entry)!==cellSignature(incoming))fail('LOCKED_OBJECT','原生编辑改变或删除了锁定对象')
  }
  for(const entry of native.cells.values())if(!base.cells.has(entry.id)){
    let parent=attr(entry.cell,'parent')
    while(parent){const existing=base.cells.get(parent);if(existing&&isLocked(base,existing)&&!(allowExplicitUnlock&&explicitlyUnlocked(existing)&&!isLocked(native,native.cells.get(parent)!)))fail('LOCKED_OBJECT','不能向锁定容器新增对象');const p=native.cells.get(parent);parent=p?attr(p.cell,'parent'):undefined}
  }
}
export async function baseState(input:DrawingProjectV3){
  const base=copy(input)
  if(base.schemaVersion!==3||base.rendering?.engine?.name!=='drawio'||base.rendering.engine.version!==DRAWIO_VERSION||base.rendering.engine.adapterVersion!==DRAWIO_ADAPTER_VERSION)fail('UNSUPPORTED_ENGINE','工作区引擎版本不支持')
  validateProfilePreferences(base.rendering.preferences,base.rendering.profile)
  const content=validateContent(base.content),projection=await projectDrawio(base.rendering.engine.xml,content),hash=await contentHash(content)
  if(projection.contentHash!==hash||base.rendering.engine.contentHash!==hash)fail('CONTENT_XML_MISMATCH','基础文档与内容不同步')
  return {base,content,native:parseNative(base.rendering.engine.xml)}
}
export function appendObject(native:NativeDocument,id:string,label:string,metadata:Record<string,string|undefined>,cellAttrs:Record<string,string|number|undefined>,shape?:{x:number;y:number;width:number;height:number}):NativeCell{
  if(native.cells.has(id))fail('DUPLICATE_CELL_ID','新 cell ID 已存在')
  const object=element(native.document,'UserObject',{id,label,fmAdapter:DRAWIO_ADAPTER_VERSION,...metadata}),cell=element(native.document,'mxCell',cellAttrs)
  if(shape)cell.appendChild(element(native.document,'mxGeometry',{...shape,as:'geometry'}));else if(cellAttrs.edge)cell.appendChild(element(native.document,'mxGeometry',{relative:1,as:'geometry'}))
  object.appendChild(cell);native.root.appendChild(object);const entry={id,object,cell};native.cells.set(id,entry);return entry
}
export function removeEntry(native:NativeDocument,id:string){const e=native.cells.get(id);if(!e)return;for(const child of [...native.cells.values()])if(attr(child.cell,'parent')===id)removeEntry(native,child.id);e.object.parentNode?.removeChild(e.object);native.cells.delete(id)}
export function rewriteIndices(native:NativeDocument,content:DiagramContent){
  for(const entry of mainEntries(native)){const type=businessType(entry),list=type==='node'?content.nodes:type==='edge'?content.edges:type==='lane'?content.lanes:content.phases;const index=list.findIndex(x=>x.id===attr(entry.object,'fmId'));if(index<0)fail('CONTENT_XML_MISMATCH','原生业务对象不在目标内容中');entry.object.setAttribute('fmIndex',String(index))}
}
