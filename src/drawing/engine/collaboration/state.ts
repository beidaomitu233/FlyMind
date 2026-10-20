import {attr,children,parseNative} from '../drawio/xml'
import {codecModelAttributes} from './protocol-patch'

const personalView=new Set(['dx','dy','scrollTop','scrollLeft','scale','translate','grid','gridSize','guides','connect','arrows','tooltips',...codecModelAttributes])
function attributes(element:Element,ignore:ReadonlySet<string>=new Set()){
 const result:Array<[string,string]>=[]
 for(let i=0;i<element.attributes.length;i++){const a=element.attributes.item(i)!;if(ignore.has(a.name))continue;if(element.nodeName==='mxGraphModel'&&({math:'0',shadow:'0',fold:'1'} as Record<string,string>)[a.name]===a.value)continue;const numeric=['mxGeometry','mxPoint','mxRectangle'].includes(element.nodeName)&&['x','y','width','height','relative'].includes(a.name);if(numeric&&Number(a.value)===0)continue;result.push([a.name,numeric&&Number.isFinite(Number(a.value))?String(Number(a.value)):a.value])}
 return result.sort(([a],[b])=>a.localeCompare(b))
}
function canonical(element:Element):unknown{return [element.nodeName,attributes(element),children(element).map(canonical),children(element).length?'':element.textContent??'']}
/** Drawing state only: local scroll/export envelope changes are not edits. */
export function nativeStateSignature(xml:string):string{
 const document=parseNative(xml)
 return JSON.stringify([attr(document.diagram,'id'),attributes(document.diagram),attributes(document.model,personalView),children(document.root).map(canonical)])
}
export function sameNativeState(left:string,right:string):boolean{return left===right||nativeStateSignature(left)===nativeStateSignature(right)}
