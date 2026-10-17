import {attr,children,setCellText,cellText,type NativeDocument} from './xml'
import {box,setBox,setStyle,businessType} from './state'
/** First-layout orientation adapter: transpose only freshly generated native
 * containers and business boxes. It is never applied to a saved user document. */
export function orientFreshSwimlane(n:NativeDocument){
 const table=[...n.cells.values()].find(e=>attr(e.object,'fmRole')==='table')!,b=box(table);setBox(table,{width:b.height,height:b.width});setStyle(table,{shape:'swimlane',childLayout:undefined,startSize:0,horizontal:1})
 for(const e of n.cells.values()){
  const role=attr(e.object,'fmRole'),type=businessType(e);if(e.id===table.id||attr(e.cell,'parent')==='1'||!children(e.cell,'mxGeometry').length)continue
  const g=box(e);setBox(e,{x:g.y,y:g.x,width:g.height,height:g.width})
  if(role==='header-row'||type==='phase'||role==='unphased-row')setStyle(e,{shape:'swimlane',childLayout:undefined,startSize:0,horizontal:1,swimlaneHead:0,swimlaneBody:0})
  if(type==='phase'&&role==='title'){const label=cellText(e);e.object.removeAttribute('fmTextLayout');setCellText(e,label);setStyle(e,{html:0,fontSize:24});setBox(e,{x:16,width:g.height,height:40})}
 }
 const title=[...n.cells.values()].find(e=>attr(e.object,'fmType')==='decoration'&&attr(e.object,'fmRole')==='title')!;title.object.setAttribute('fmOrientation','horizontal');setBox(title,{width:Math.max(400,b.height)})
 let x=b.x;for(const e of n.cells.values())if(businessType(e)==='node'&&attr(e.object,'fmKind')==='note'){setBox(e,{x,y:b.y+b.width+28});x+=box(e).width+24}
}
