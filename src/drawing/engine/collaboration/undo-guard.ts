import {attr,children,parseNative} from '../drawio/xml'
import {personalModelAttributes,codecModelAttributes} from './protocol-patch'
type State=Map<string,string>
function properties(element:Element,prefix:string,result:State,ignore:ReadonlySet<string>=new Set()){
 for(let i=0;i<element.attributes.length;i++){const a=element.attributes.item(i)!;if(ignore.has(a.name)||a.name.startsWith('fm'))continue
  if(a.name==='style'){for(const part of a.value.split(';').filter(Boolean)){const equal=part.indexOf('=');if(equal>=0)result.set(prefix+'style:'+part.slice(0,equal),part.slice(equal+1));else result.set(prefix+'style:named:'+part,'1')}}
  else {const geometry=element.nodeName==='mxGeometry'&&['x','y','width','height','relative'].includes(a.name);if(geometry&&Number(a.value)===0)continue;result.set(prefix+a.name,geometry?String(Number(a.value)):a.value)}
 }
}
function canonical(element:Element):unknown{const state:State=new Map();properties(element,'',state);return [element.nodeName,[...state].sort(([a],[b])=>a.localeCompare(b)),children(element).map(canonical),children(element).length?'':element.textContent??'']}
function state(xml:string):State{
 const n=parseNative(xml),result:State=new Map();properties(n.model,'model:',result,new Set([...personalModelAttributes,...codecModelAttributes]));properties(n.diagram,'page:',result,new Set(['id']))
 for(const cell of n.cells.values()){
  const prefix=JSON.stringify(cell.id)+':';result.set(prefix+'exists','1')
  if(cell.object!==cell.cell)properties(cell.object,prefix+'metadata:',result,new Set(['id']))
  properties(cell.cell,prefix+'cell:',result,new Set(['id']))
  const geometry=children(cell.cell,'mxGeometry')[0]
  if(geometry){properties(geometry,prefix+'geometry:',result);result.set(prefix+'geometry:children',JSON.stringify(children(geometry).map(canonical)))}
 }
 return result
}
export class RemoteUndoConflict extends Error {readonly code='REMOTE_UNDO_CONFLICT';constructor(){super('这次撤销会覆盖其他成员的后续修改，已保留当前图形。')}}
/** Track only fields actually applied by remote patches, not the whole document.
 * A later local edit can still be undone back to the peer's value. An older Undo
 * cannot cross that value and erase the peer's subsequent work. */
export class NativeRemoteUndoGuard {
 private readonly remote=new Map<string,string|undefined>()
 private overflow=false
 observe(before:string,after:string){const a=state(before),b=state(after);for(const key of new Set([...a.keys(),...b.keys()]))if(a.get(key)!==b.get(key)){this.remote.set(key,b.get(key));if(this.remote.size>250_000){this.overflow=true;return}}}
 assertSafe(before:string,after:string){if(this.overflow)throw new RemoteUndoConflict();const a=state(before),b=state(after);for(const key of this.remote.keys())if(a.get(key)!==b.get(key)&&a.get(key)===this.remote.get(key))throw new RemoteUndoConflict()}
}
