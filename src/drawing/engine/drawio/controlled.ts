import type {DiagramNode} from '../../core/model'
import {attr,cellText,children,element,fail,setCellText,type NativeCell,type NativeDocument} from './xml'
import {DRAWIO_ADAPTER_VERSION} from '../constants'
import {FONT,textUnits} from './template'

export const CONTROLLED_ROLES=new Set(['title','body','item','badge','icon','edge-label'])
interface Fields {title:true;body?:true;items?:number;badge?:true;icon?:true}
interface Part {role:'title'|'body'|'item'|'badge';text:string;index?:number;x:number;y:number;width:number;height:number;font:number}
const role=(e:NativeCell)=>attr(e.object,'fmRole')??'main'
const kind=(e:NativeCell)=>attr(e.object,'fmType')==='annotation'?'node':attr(e.object,'fmType')
export function isControlled(e:NativeCell){return CONTROLLED_ROLES.has(role(e))&&['node','annotation','edge'].includes(attr(e.object,'fmType')??'')}
function fields(e:NativeCell):Fields|undefined{
 if(attr(e.object,'fmControlled')===undefined)return
 if(attr(e.object,'fmControlled')!=='1')fail('UNSUPPORTED_CONTROLLED_VERSION','受控可见字段版本不支持')
 let value:any;try{value=JSON.parse(attr(e.object,'fmFields')??'')}catch{fail('INVALID_CONTROLLED_FIELDS','受控字段清单无效')}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['title','body','items','badge','icon'].includes(k))||value.title!==true||value.body!==undefined&&value.body!==true||value.badge!==undefined&&value.badge!==true||value.icon!==undefined&&value.icon!==true||value.items!==undefined&&(!Number.isInteger(value.items)||value.items<0||value.items>100))fail('INVALID_CONTROLLED_FIELDS','受控字段清单无效')
 return value
}
export function controlledOwner(n:NativeDocument,e:NativeCell):NativeCell{
 let parent=attr(e.cell,'parent');while(parent){const owner=n.cells.get(parent);if(!owner)break;if(role(owner)==='main'&&['node','annotation','edge'].includes(attr(owner.object,'fmType')??''))return owner;parent=attr(owner.cell,'parent')}
 return fail('ORPHAN_CONTROLLED_ELEMENT','受控元素缺少明确主对象祖先')
}
export function controlledChildren(n:NativeDocument,owner:NativeCell){return [...n.cells.values()].filter(e=>isControlled(e)&&controlledOwner(n,e).id===owner.id)}
/** Strict projection never fills missing visible text from stale hidden metadata. */
export function readControlledNode(n:NativeDocument,owner:NativeCell):Partial<DiagramNode>|undefined{
 const manifest=fields(owner);if(!manifest)return
 if(['fmDescription','fmItems','fmBadge'].some(k=>attr(owner.object,k)!==undefined))fail('DUPLICATE_CONTROLLED_METADATA','受控可见字段不能另有隐藏副本')
 const parts=controlledChildren(n,owner),singles=new Map<string,NativeCell>(),items=new Map<number,NativeCell>()
 for(const part of parts){if(kind(part)!==kind(owner)||attr(part.object,'fmId')!==attr(owner.object,'fmId'))fail('CONTROLLED_OWNER_MISMATCH','受控业务身份与祖先不一致');const r=role(part);if(r==='item'){const index=Number(attr(part.object,'fmItemIndex'));if(attr(part.object,'fmItemIndex')===undefined||!Number.isInteger(index)||index<0||items.has(index))fail('DUPLICATE_CONTROLLED_BINDING','条目索引缺失或重复');items.set(index,part)}else{if(!['title','body','badge','icon'].includes(r)||singles.has(r))fail('DUPLICATE_CONTROLLED_BINDING','受控字段重复或不属于当前节点');singles.set(r,part)}}
 for(const r of ['title','body','badge','icon'] as const)if(!!manifest[r]!==singles.has(r))fail('MISSING_CONTROLLED_ELEMENT','受控字段清单与可见元素不一致')
 if(items.size!==(manifest.items??0)||[...items.keys()].some(index=>index>=(manifest.items??0)))fail('MISSING_CONTROLLED_ELEMENT','可见条目数量或次序不完整')
 if(cellText(owner))fail('DUPLICATE_VISIBLE_TITLE','受控节点主形状不能另有第二份标题')
 if(manifest.icon&&(!['database','network','check'].includes(attr(owner.object,'fmCardIcon')??'')||attr(singles.get('icon')!.object,'fmIcon')!==attr(owner.object,'fmCardIcon')))fail('INVALID_CONTROLLED_ICON','可见图标绑定无效')
 const result:Partial<DiagramNode>={label:cellText(singles.get('title')!)};if(manifest.body)result.description=cellText(singles.get('body')!);if(manifest.badge)result.badge=cellText(singles.get('badge')!);if(manifest.items!==undefined)result.items=Array.from({length:manifest.items},(_,i)=>cellText(items.get(i)!))
 return result
}
export function needsControlledNode(node:DiagramNode){return node.description!==undefined||node.items!==undefined||node.badge!==undefined}
export function controlledNodeMetrics(node:DiagramNode,width:number,font:number,shape:string,minHeight:number){
 const body=Math.max(10,font-3),usable=Math.max(font,(shape==='diamond'?width*.5:shape==='ellipse'?width*.72:width)-24),x=(width-usable)/2,lineHeight=(text:string,size:number)=>text.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(textUnits(line)*size/usable)),0)*size*1.45
 let y=12;const parts:Part[]=[];const add=(r:Part['role'],text:string,size:number,index?:number)=>{const height=Math.ceil(lineHeight(text,size))+8;parts.push({role:r,text,index,x,y,width:usable,height,font:size});y+=height}
 add('title',node.label,font);if(node.description!==undefined)add('body',node.description,body);node.items?.forEach((text,index)=>add('item',text,body,index));if(node.badge!==undefined)add('badge',node.badge,body)
 const height=Math.max(minHeight,Math.ceil((y+12)*(shape==='diamond'?2:shape==='ellipse'?1.4:1))),shift=(height-(y+12))/2;parts.forEach(p=>p.y+=shift);return {height,parts}
}
/** Controlled fields are native editable text shapes; old simple cells remain
 * supported. Only the explicitly affected node's subtree is reconciled. */
export function writeControlledNode(n:NativeDocument,owner:NativeCell,node:DiagramNode){
 if(!needsControlledNode(node)&&!fields(owner)&&!['database','network','check'].includes(attr(owner.object,'fmCardIcon')??''))return
 const g=children(owner.cell,'mxGeometry')[0],style=attr(owner.cell,'style')??'',get=(key:string)=>style.split(';').find(p=>p.startsWith(key+'='))?.slice(key.length+1),width=Number(attr(g,'width')),font=Number(get('fontSize')??16),shape=style.includes('rhombus')?'diamond':style.split(';').includes('ellipse')?'ellipse':'rectangle',metrics=controlledNodeMetrics(node,width,font,shape,Number(attr(g,'height'))),old=controlledChildren(n,owner),wanted=new Set<string>()
 const icon=attr(owner.object,'fmCardIcon'),hasIcon=!!icon&&icon!=='none';if(hasIcon){const title=metrics.parts[0],width=Math.max(24,title.width-44),height=Math.ceil(title.text.split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil(textUnits(line)*title.font/width)),0)*title.font*1.45)+8,delta=Math.max(0,height-title.height);title.x+=44;title.width=width;title.height+=delta;for(const part of metrics.parts.slice(1))part.y+=delta;metrics.height+=delta}
 const preserve=old.length===metrics.parts.length+(hasIcon?1:0)&&metrics.parts.every(p=>{const e=old.find(e=>role(e)===p.role&&(p.index===undefined||Number(attr(e.object,'fmItemIndex'))===p.index)),g=e&&children(e.cell,'mxGeometry')[0];return g&&Number(attr(g,'width'))===p.width&&Number(attr(g,'height'))>=p.height})
 if(!preserve)g.setAttribute('height',String(metrics.height));setCellText(owner,'');for(const key of ['fmDescription','fmItems','fmBadge'])owner.object.removeAttribute(key)
 const manifest:Fields={title:true,...(node.description!==undefined?{body:true as const}:{}),...(node.items!==undefined?{items:node.items.length}:{}),...(node.badge!==undefined?{badge:true as const}:{}),...(hasIcon?{icon:true as const}:{})};owner.object.setAttribute('fmControlled','1');owner.object.setAttribute('fmFields',JSON.stringify(manifest))
 for(const part of metrics.parts){const key=part.role+':'+(part.index??''),existing=old.find(e=>role(e)===part.role&&(part.index===undefined||Number(attr(e.object,'fmItemIndex'))===part.index));let entry=existing
  if(!entry){let id=owner.id+':field:'+part.role+(part.index===undefined?'':':'+part.index),suffix=0;while(n.cells.has(id))id=owner.id+':field:'+part.role+':'+(++suffix)
   const object=element(n.document,'UserObject',{id,label:part.text,fmType:attr(owner.object,'fmType'),fmId:attr(owner.object,'fmId'),fmRole:part.role,fmItemIndex:part.index,fmAdapter:DRAWIO_ADAPTER_VERSION}),cell=element(n.document,'mxCell',{vertex:1,parent:owner.id,style:`text;html=0;whiteSpace=wrap;fontFamily=${FONT};fontSize=${part.font};fontColor=${get('fontColor')??'#32495d'};align=${node.kind==='note'?'left':'center'};verticalAlign=middle;spacing=0;fillColor=none;strokeColor=none;connectable=0;${part.role==='title'?'fontStyle=1;':''}`});object.appendChild(cell);n.root.appendChild(object);entry={id,object,cell};n.cells.set(id,entry);cell.appendChild(element(n.document,'mxGeometry',{as:'geometry'}))
  }
  wanted.add(entry.id);setCellText(entry,part.text);const box=children(entry.cell,'mxGeometry')[0];if(!preserve||!existing)for(const k of ['x','y','width','height'] as const)box.setAttribute(k,String(part[k]));entry.object.setAttribute('fmId',attr(owner.object,'fmId')!);entry.object.setAttribute('fmType',attr(owner.object,'fmType')!);if(part.index!==undefined)entry.object.setAttribute('fmItemIndex',String(part.index))
 }
 if(hasIcon){const title=metrics.parts[0],entry=writeNativeIcon(n,owner,icon!,{x:title.x-44,y:title.y+(title.height-28)/2,width:28,height:28});wanted.add(entry.id)}
 for(const entry of old)if(!wanted.has(entry.id)){entry.object.parentNode?.removeChild(entry.object);n.cells.delete(entry.id)}
}
/** Acknowledgement metadata is restored by native cell identity before locks;
 * clone identity follows its actual main ancestor after new IDs are assigned. */
export function restoreControlledAcknowledgements(n:NativeDocument,base:NativeDocument){for(const previous of base.cells.values()){
 const incoming=n.cells.get(previous.id);if(!incoming)continue
 if(role(previous)==='main'&&['node','annotation','edge'].includes(attr(previous.object,'fmType')??''))for(const key of ['fmControlled','fmFields','fmCardIcon']){const value=attr(previous.object,key);if(value===undefined)incoming.object.removeAttribute(key);else incoming.object.setAttribute(key,value)}
 if(isControlled(previous))for(const key of ['fmType','fmId','fmRole','fmAdapter','fmItemIndex']){const value=attr(previous.object,key);if(value!==undefined)incoming.object.setAttribute(key,value)}
}}
export function rebindControlledCopies(n:NativeDocument){for(const entry of n.cells.values())if(isControlled(entry)){const owner=controlledOwner(n,entry);entry.object.setAttribute('fmId',attr(owner.object,'fmId')!);entry.object.setAttribute('fmType',attr(owner.object,'fmType')!)}}
/** With a confirmed base, deletion is editing intent. Standalone projection
 * remains strict and cannot invent a missing slot's former text. */
export function normalizeControlledDeletions(n:NativeDocument,base:NativeDocument){
 for(const oldOwner of base.cells.values()){
  if(role(oldOwner)==='main'&&attr(oldOwner.object,'fmType')==='edge'&&attr(oldOwner.object,'fmControlled')==='1'){const owner=n.cells.get(oldOwner.id);if(owner){const oldPart=controlledChildren(base,oldOwner).find(e=>role(e)==='edge-label');if(oldPart&&!n.cells.has(oldPart.id)&&!controlledChildren(n,owner).length){owner.object.removeAttribute('fmControlled');owner.object.removeAttribute('fmFields');owner.object.removeAttribute('fmLabelPresent');setCellText(owner,'')}}continue}
  if(role(oldOwner)!=='main'||!fields(oldOwner))continue;const owner=n.cells.get(oldOwner.id);if(!owner)continue;const manifest=fields(owner);if(!manifest)fail('MISSING_CONTROLLED_FIELDS','已确认受控节点不可删除字段协议');const oldParts=controlledChildren(base,oldOwner),parts=controlledChildren(n,owner)
  for(const r of ['body','badge','icon'] as const)if(oldParts.some(e=>role(e)===r&&!n.cells.has(e.id))&&!parts.some(e=>role(e)===r)){delete manifest[r];if(r==='icon')owner.object.setAttribute('fmCardIcon','none')}
  const deletedItem=oldParts.some(e=>role(e)==='item'&&!n.cells.has(e.id)),newItems=parts.filter(e=>role(e)==='item'&&!base.cells.has(e.id));if(deletedItem||newItems.length){const items=parts.filter(e=>role(e)==='item'&&base.cells.has(e.id)).sort((a,b)=>Number(attr(a.object,'fmItemIndex'))-Number(attr(b.object,'fmItemIndex'))),seen=new Set<number>();for(const item of items){const index=Number(attr(item.object,'fmItemIndex'));if(!Number.isInteger(index)||seen.has(index))fail('DUPLICATE_CONTROLLED_BINDING','编辑条目时既有元素仍存在重复索引');seen.add(index)}items.push(...newItems);items.forEach((e,i)=>e.object.setAttribute('fmItemIndex',String(i)));manifest.items=items.length}
  owner.object.setAttribute('fmFields',JSON.stringify(manifest))
 }
}

export function readControlledEdge(n:NativeDocument,owner:NativeCell):string|undefined{
 if(attr(owner.object,'fmControlled')!=='1')return undefined
 let f:any;try{f=JSON.parse(attr(owner.object,'fmFields')??'')}catch{fail('INVALID_CONTROLLED_FIELDS','边标签清单无效')}
 if(!f||Object.keys(f).length!==1||f.label!==true)fail('INVALID_CONTROLLED_FIELDS','边标签清单无效')
 const parts=controlledChildren(n,owner);if(parts.length!==1||role(parts[0])!=='edge-label'||attr(parts[0].object,'fmId')!==attr(owner.object,'fmId')||cellText(owner))fail('MISSING_CONTROLLED_ELEMENT','独立边标签缺失或重复')
 return cellText(parts[0])
}
/** Route first, then transfer its native label geometry to an editable edge child. */
export function writeControlledEdge(n:NativeDocument,owner:NativeCell,label:string|undefined){
 const old=controlledChildren(n,owner);if(label===undefined){for(const e of old){e.object.parentNode?.removeChild(e.object);n.cells.delete(e.id)}owner.object.removeAttribute('fmControlled');owner.object.removeAttribute('fmFields');owner.object.removeAttribute('fmLabelPresent');setCellText(owner,'');return}
 let part=old.find(e=>role(e)==='edge-label');if(!part){let id=owner.id+':field:edge-label',i=0;while(n.cells.has(id))id=owner.id+':field:edge-label:'+(++i);const object=element(n.document,'UserObject',{id,label,fmType:'edge',fmRole:'edge-label',fmId:attr(owner.object,'fmId'),fmAdapter:DRAWIO_ADAPTER_VERSION}),cell=element(n.document,'mxCell',{vertex:1,connectable:0,parent:owner.id,style:`text;html=0;whiteSpace=wrap;${FONT?`fontFamily=${FONT};`:''}fontSize=13;align=center;verticalAlign=middle;spacing=0;fillColor=#ffffff;strokeColor=none;`}),g=children(owner.cell,'mxGeometry')[0],width=Number((attr(owner.cell,'style')??'').match(/(?:^|;)labelWidth=([^;]+)/)?.[1]??180),height=Math.ceil(Math.max(1,Math.ceil(textUnits(label)*13/width))*13*1.2)+8,geo=element(n.document,'mxGeometry',{relative:1,x:attr(g,'x')??0,y:attr(g,'y')??0,width,height,as:'geometry'}),offset=children(g,'mxPoint').find(p=>attr(p,'as')==='offset');geo.appendChild(element(n.document,'mxPoint',{x:Number(offset&&attr(offset,'x')||0)-width/2,y:Number(offset&&attr(offset,'y')||0)-height/2,as:'offset'}));cell.appendChild(geo);object.appendChild(cell);n.root.appendChild(object);part={id,object,cell};n.cells.set(id,part)}
 setCellText(part,label);setCellText(owner,'');owner.object.setAttribute('fmControlled','1');owner.object.setAttribute('fmFields',JSON.stringify({label:true}));owner.object.removeAttribute('fmLabelPresent')
}
/** Updates the affected label's native anchor only, preserving its custom text
 * style/box dimensions and all line waypoints. */
export function reanchorControlledEdge(n:NativeDocument,owner:NativeCell){const part=controlledChildren(n,owner).find(e=>role(e)==='edge-label');if(!part)return;const g=children(owner.cell,'mxGeometry')[0],old=children(part.cell,'mxGeometry')[0],width=Number(attr(old,'width')??180),font=Number((attr(part.cell,'style')??'').match(/(?:^|;)fontSize=([^;]+)/)?.[1]??13),height=Math.max(Number(attr(old,'height')??0),Math.ceil(Math.max(1,Math.ceil(textUnits(cellText(part))*font/width))*font*1.2)+8),geo=element(n.document,'mxGeometry',{relative:1,x:attr(g,'x')??0,y:attr(g,'y')??0,width,height,as:'geometry'}),offset=children(g,'mxPoint').find(p=>attr(p,'as')==='offset');geo.appendChild(element(n.document,'mxPoint',{x:Number(offset&&attr(offset,'x')||0)-width/2,y:Number(offset&&attr(offset,'y')||0)-height/2,as:'offset'}));part.cell.replaceChild(geo,old)}
function writeNativeIcon(n:NativeDocument,owner:NativeCell,kind:string,b:{x:number;y:number;width:number;height:number}){
 if(!['database','network','check'].includes(kind))fail('UNSUPPORTED_ICON','未知原生图标')
 let entry=controlledChildren(n,owner).find(e=>role(e)==='icon')
 if(entry&&attr(entry.object,'fmIcon')!==kind){const remove=(id:string)=>{for(const e of [...n.cells.values()].filter(e=>attr(e.cell,'parent')===id))remove(e.id);const old=n.cells.get(id);old?.object.parentNode?.removeChild(old.object);n.cells.delete(id)};remove(entry.id);entry=undefined}
 if(entry)return entry
 let id=owner.id+':field:icon',suffix=0;while(n.cells.has(id))id=owner.id+':field:icon:'+(++suffix)
 const object=element(n.document,'UserObject',{id,label:'',fmType:attr(owner.object,'fmType'),fmRole:'icon',fmId:attr(owner.object,'fmId'),fmIcon:kind,fmAdapter:DRAWIO_ADAPTER_VERSION}),cell=element(n.document,'mxCell',{vertex:1,parent:owner.id,style:kind==='database'?'shape=cylinder;fillColor=#edf7f5;strokeColor=#27867e;':'group;container=1;collapsible=0;recursiveResize=0;fillColor=none;strokeColor=none;'});cell.appendChild(element(n.document,'mxGeometry',{...b,as:'geometry'}));object.appendChild(cell);n.root.appendChild(object);entry={id,object,cell};n.cells.set(id,entry)
 const shape=(name:string,attrs:Record<string,string|number>,geometry:Record<string,string|number>,points?:Array<{x:number;y:number;as:string}>)=>{const child=element(n.document,'mxCell',{id:id+':'+name,parent:id,...attrs}),geo=element(n.document,'mxGeometry',{...geometry,as:'geometry'});for(const p of points??[])geo.appendChild(element(n.document,'mxPoint',p));child.appendChild(geo);n.root.appendChild(child);n.cells.set(id+':'+name,{id:id+':'+name,object:child,cell:child})}
 const segment=(name:string,x:number,y:number,x2:number,y2:number)=>shape(name,{edge:1,style:'endArrow=none;startArrow=none;strokeColor=#27867e;strokeWidth=2;noEdgeStyle=1;'}, {relative:1},[{x,y,as:'sourcePoint'},{x:x2,y:y2,as:'targetPoint'}])
 if(kind==='check'){segment('left',3,14,11,22);segment('right',11,22,26,4)}
 if(kind==='network'){segment('first',14,6,5,23);segment('second',14,6,23,23);segment('third',5,23,23,23);for(const[name,x,y]of [['a',10,0],['b',0,19],['c',20,19]]as const)shape(name,{vertex:1,style:'ellipse;fillColor=#edf7f5;strokeColor=#27867e;strokeWidth=1.5;'}, {x,y,width:8,height:8})}
 return entry
}
