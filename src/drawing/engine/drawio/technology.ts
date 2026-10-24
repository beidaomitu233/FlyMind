import type {DiagramNode} from '../../core/model'
import {appendObject} from './state'
import {attr,children,element,type NativeCell,type NativeDocument} from './xml'
import {TECHNOLOGY_ICONS} from './technology-icons-data'
/** Native movable/resizable image child, never an external image request. */
export function writeTechnologyIcon(n:NativeDocument,owner:NativeCell,node:DiagramNode){
 const slug=node.technology??'generic',icon=Object.hasOwn(TECHNOLOGY_ICONS,slug)?TECHNOLOGY_ICONS[slug]:undefined,id=owner.id+':technology-icon',existing=n.cells.get(id)
 if(existing&&attr(existing.object,'fmTechnology')===slug)return
 const style=icon?`shape=image;imageAspect=1;aspect=fixed;image=data:image/svg+xml,${encodeURIComponent(icon.svg)};`:'shape=hexagon;fillColor=none;strokeColor=#0ea5e9;strokeWidth=2;'
 if(existing){existing.cell.setAttribute('style',style+'resizable=1;connectable=0;');existing.object.setAttribute('fmTechnology',slug);return}
 const e=appendObject(n,id,'',{fmType:'decoration',fmRole:'technology-icon',fmTechnology:slug},{vertex:1,parent:owner.id,connectable:0,style:style+'resizable=1;movable=1;resizeWidth=0;resizeHeight=0;'},undefined)
 const old=children(e.cell,'mxGeometry')[0];if(old)e.cell.removeChild(old)
 const geo=element(n.document,'mxGeometry',{x:.5,y:0,width:72,height:72,relative:1,as:'geometry'});geo.appendChild(element(n.document,'mxPoint',{x:-36,y:12,as:'offset'}));e.cell.appendChild(geo)
}
