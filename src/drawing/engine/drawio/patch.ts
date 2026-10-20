import {patchGeneric} from './generic-patch'
import {routeNativeEdges,absoluteRouteBox} from './routing'
import {palette,type DiagramContent,type DiagramNode} from '../../core/model'
import {applyContentOperations,composeDocument,extractContent,validateContent} from '../../core/layers'
import type {DiagramOperation} from '../../core/operations'
import type {DrawioEngineDocument,DrawingProjectV3} from '../types'
import {contentHash} from '../content-hash'
import {DRAWIO_VERSION,DRAWIO_ADAPTER_VERSION} from '../constants'
import {projectDrawio} from './index'
import {attr,cellText,children,element,fail,parseNative,serialize,setCellText,type NativeCell,type NativeDocument} from './xml'
import {ancestorIntersection,appendObject,assertNativeLocks,baseState,bindingId,box,businessType,mainEntries,mainEntry,removeEntry,setBox,setStyle,styleValue,unlocked} from './state'
import {dimensions,FONT,fontStyle,nodeMetadata,styleShape,textUnits} from './template'
import {writeControlledNode,needsControlledNode} from './controlled'

const ids=(list:Array<{id:string}>)=>JSON.stringify(list.map(x=>x.id))
const directChildren=(n:NativeDocument,id:string)=>[...n.cells.values()].filter(e=>attr(e.cell,'parent')===id)
const role=(n:NativeDocument,value:string)=>[...n.cells.values()].filter(e=>attr(e.object,'fmRole')===value)
function uniqueId(n:NativeDocument,type:string,id:string){let value=bindingId(type,id);while(n.cells.has(value))value=bindingId(type,id)+'_'+globalThis.crypto.randomUUID().slice(0,8);return value}
function plainStyle(e:NativeCell){return (attr(e.cell,'style')??'').split(';').filter(p=>!p.startsWith('locked=')&&!p.startsWith('editable=')).join(';')}
function indexFor(n:NativeDocument,type:string){return Math.max(-1,...mainEntries(n).filter(e=>businessType(e)===type).map(e=>Number(attr(e.object,'fmIndex')??0)))+1}
function absoluteBox(n:NativeDocument,e:NativeCell){const value=box(e);let parent=attr(e.cell,'parent');while(parent){const p=n.cells.get(parent);if(!p)break;const g=children(p.cell,'mxGeometry')[0];if(g){value.x+=Number(attr(g,'x')??0);value.y+=Number(attr(g,'y')??0)}parent=attr(p.cell,'parent')}return value}
function intersection(n:NativeDocument,laneId:string,phaseId?:string){const matches=role(n,'intersection').filter(e=>attr(e.object,'fmLaneId')===laneId&&(attr(e.object,'fmPhaseId')??'')===(phaseId??''));if(matches.length!==1)fail('AMBIGUOUS_OWNERSHIP','角色/阶段交叉格缺失或不唯一');return matches[0]}
function assignNodeMetadata(entry:NativeCell,node:DiagramNode){for(const key of ['fmLaneId','fmPhaseId','fmGroupId','fmParentId','fmDescription','fmItems','fmBadge','fmColor'])entry.object.removeAttribute(key);for(const [key,value] of Object.entries(nodeMetadata(node)))if(value!==undefined&&!(attr(entry.object,'fmControlled')==='1'&&['fmDescription','fmItems','fmBadge'].includes(key)))entry.object.setAttribute(key,String(value))}
function contentIndices(n:NativeDocument,next:DiagramContent){
 for(const [type,list] of [['node',next.nodes],['edge',next.edges],['lane',next.lanes],['phase',next.phases]] as const){const entries=list.map(x=>mainEntry(n,type,x.id)),order=[...entries].sort((a,b)=>Number(attr(a.object,'fmIndex')??0)-Number(attr(b.object,'fmIndex')??0));if(order.some((e,i)=>e.id!==entries[i].id))entries.forEach((e,i)=>e.object.setAttribute('fmIndex',String(i)))}
}
function neededHeight(entry:NativeCell,label:string){const b=box(entry),font=Number(styleValue(entry,'fontSize')??16),style=attr(entry.cell,'style')??'',diamond=style.includes('rhombus'),ellipse=style.split(';').includes('ellipse'),available=Math.max(font,(diamond?b.width*.5:ellipse?b.width*.72:b.width)-32),lines=label.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(textUnits(line)*font/available)),0);return Math.ceil(lines*font*1.5)*(diamond?2:ellipse?1.5:1)+32}

/** Local mutation of the saved native document. Never recompiles the full graph. */
export async function patchDrawio(input:DrawingProjectV3,rawOperations:DiagramOperation[]):Promise<DrawioEngineDocument>{
 if(!Array.isArray(rawOperations)||!rawOperations.length||rawOperations.length>500)fail('INVALID_OPERATIONS','需要 1–500 个内容操作')
 const operations=structuredClone(rawOperations),{base,content,native}=await baseState(input),original=parseNative(base.rendering.engine.xml)
 if(operations.some(o=>!o||!['add_node','update_node','remove_node','add_edge','update_edge','remove_edge','add_container','update_container','remove_container','reorder_container','set_title'].includes(o.op)))fail('UNSUPPORTED_PATCH','内容修改不接受渲染操作')
 if(content.kind!=='swimlane'||base.rendering.preferences.orientation==='horizontal'){const next=extractContent(applyContentOperations(composeDocument(content),operations));validateContent(next);return patchGeneric(base,content,next,native,original)}
 if(operations.some(o=>'collection' in o&&o.collection==='groups'))fail('UNSUPPORTED_PATCH','泳道额外业务分层暂不支持')
 const next=extractContent(applyContentOperations(composeDocument(content),operations));validateContent(next)
 if(next.groups.length)fail('UNSUPPORTED_PATCH','泳道额外业务分层暂不支持')
 const table=role(native,'table')[0]??fail('MISSING_CONTAINER','缺少原生表格'),header=role(native,'header-row')[0]??fail('MISSING_CONTAINER','缺少原生角色表头'),title=role(native,'title').find(e=>attr(e.object,'fmType')==='decoration')??fail('MISSING_TITLE','缺少文档标题')
 const colors=palette[base.rendering.preferences.theme??'indigo'],left=Number(styleValue(header,'startSize')??160),tableBefore=box(table),headerBefore=box(header)
 const originalPhaseTop=new Map<string,number>();for(const e of mainEntries(native).filter(e=>businessType(e)==='phase'))originalPhaseTop.set(attr(e.object,'fmId')!,tableBefore.y+box(e).y)
 const oldUnphased=role(native,'unphased-row')[0];if(oldUnphased)originalPhaseTop.set('',tableBefore.y+box(oldUnphased).y)
 const originalNotes=new Map(content.nodes.filter(n=>n.kind==='note').map(n=>{const e=mainEntry(native,'node',n.id);return [n.id,{phaseId:n.phaseId??'',y:box(e).y,parent:attr(e.cell,'parent')}] as const})),placedNotes=new Set<string>()
 const laneWidths=new Map(next.lanes.map(l=>[l.id,content.lanes.some(old=>old.id===l.id)?box(mainEntry(native,'lane',l.id)).width:360]))
 let columnsChanged=ids(content.lanes)!==ids(next.lanes),rowsChanged=ids(content.phases)!==ids(next.phases),headerHeight=headerBefore.height
 const laneTemplate=mainEntry(native,'lane',content.lanes[0].id),rowTemplate=mainEntries(native).find(e=>businessType(e)==='phase')??oldUnphased!,intersectionTemplate=role(native,'intersection')[0]
 // Add only missing containers, cloning the local native table grammar.
 for(const lane of next.lanes)if(!content.lanes.some(l=>l.id===lane.id))appendObject(native,uniqueId(native,'lane',lane.id),lane.label,{fmType:'lane',fmId:lane.id,fmRole:'main',fmIndex:String(indexFor(native,'lane'))},{vertex:1,parent:header.id,style:plainStyle(laneTemplate)},{x:left,y:0,width:laneWidths.get(lane.id)!,height:headerHeight})
 const phaseRows=new Map<string,NativeCell>(),wantedPhases=next.phases.length?next.phases:[{id:'',label:''}]
 for(const phase of wantedPhases){let row=phase.id?mainEntries(native).find(e=>businessType(e)==='phase'&&attr(e.object,'fmId')===phase.id):oldUnphased
  if(!row)row=appendObject(native,uniqueId(native,'phase',phase.id||'unphased'),'',{fmType:phase.id?'phase':'decoration',fmId:phase.id||content.id,fmRole:phase.id?'main':'unphased-row',fmIndex:phase.id?String(indexFor(native,'phase')):undefined},{vertex:1,parent:table.id,style:plainStyle(rowTemplate)},{x:0,y:headerHeight,width:tableBefore.width,height:Math.max(200,[...phase.label].length*32.8+32)})
  phaseRows.set(phase.id,row)
  for(const lane of next.lanes){let cell=role(native,'intersection').find(e=>attr(e.cell,'parent')===row!.id&&attr(e.object,'fmLaneId')===lane.id)
   if(!cell)cell=appendObject(native,uniqueId(native,'intersection',JSON.stringify([phase.id,lane.id])),'',{fmType:'decoration',fmId:JSON.stringify([phase.id,lane.id]),fmRole:'intersection',fmLaneId:lane.id,fmPhaseId:phase.id||undefined},{vertex:1,parent:row.id,style:plainStyle(intersectionTemplate)},{x:left,y:0,width:laneWidths.get(lane.id)!,height:box(row).height})
  }
  if(phase.id&&!role(native,'title').some(e=>attr(e.object,'fmType')==='phase'&&attr(e.object,'fmId')===phase.id)){
   const cell=intersection(native,next.lanes[0].id,phase.id),e=appendObject(native,uniqueId(native,'phase-title',phase.id),phase.label,{fmType:'phase',fmId:phase.id,fmRole:'title',fmTextLayout:'phase-vertical'},{vertex:1,parent:cell.id,style:`text;fontFamily=${FONT};fontSize=24;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;spacing=0;overflow=visible;fontColor=${colors.dark};fontStyle=1;`},{x:-left+(left-40)/2,y:16,width:40,height:box(row).height-32});setCellText(e,phase.label)
  }
 }
 const growPhase=(id:string|undefined,minHeight:number)=>{const row=phaseRows.get(id??'');if(!row)fail('UNASSIGNED_NODE','目标阶段不存在');if(minHeight>box(row).height){unlocked(native,row);setBox(row,{height:minHeight});rowsChanged=true}}
 const growLane=(id:string,minWidth:number)=>{if(minWidth>(laneWidths.get(id)??0)){unlocked(native,mainEntry(native,'lane',id));laneWidths.set(id,minWidth);columnsChanged=true}}
 const place=(entry:NativeCell,node:DiagramNode)=>{
  if(node.kind==='note'){entry.cell.setAttribute('parent','1');placedNotes.add(node.id);const row=phaseRows.get(node.phaseId??'');const y=tableBefore.y+(row?box(row).y:headerHeight)+24;setBox(entry,{x:tableBefore.x+tableBefore.width+28,y});return}
  const parent=intersection(native,node.laneId!,node.phaseId),size=box(entry);unlocked(native,parent);growLane(node.laneId!,size.width+100)
  const bottom=Math.max(-10,...directChildren(native,parent.id).filter(e=>e.id!==entry.id&&businessType(e)==='node'&&attr(e.object,'fmRole')==='main'&&attr(e.object,'fmKind')!=='note').map(e=>{const b=box(e);return b.y+b.height}))
  const y=Math.max(54,bottom+64);entry.cell.setAttribute('parent',parent.id);setBox(entry,{x:Math.round((laneWidths.get(node.laneId!)!-size.width)/2),y});growPhase(node.phaseId,y+size.height+54)
 }
 // Remove business cells and their actual native incident edges, never other cells.
 for(const old of content.nodes)if(!next.nodes.some(n=>n.id===old.id)){
  const entry=mainEntry(native,'node',old.id);unlocked(native,entry);const removedIds=new Set<string>([entry.id]);let size=0;while(size!==removedIds.size){size=removedIds.size;for(const e of native.cells.values())if(removedIds.has(attr(e.cell,'parent')??''))removedIds.add(e.id)}
  for(const e of [...native.cells.values()])if(attr(e.cell,'edge')==='1'&&(removedIds.has(attr(e.cell,'source')??'')||removedIds.has(attr(e.cell,'target')??''))){unlocked(native,e);removeEntry(native,e.id)}removeEntry(native,entry.id)
 }
 for(const old of content.edges)if(!next.edges.some(e=>e.id===old.id)){const entry=mainEntries(native).find(e=>businessType(e)==='edge'&&attr(e.object,'fmId')===old.id);if(entry){unlocked(native,entry);removeEntry(native,entry.id)}}
 // Change only affected nodes. New/moved nodes stack in their own destination.
 for(const node of next.nodes){const old=content.nodes.find(n=>n.id===node.id);let entry:NativeCell
  if(!old){const size=dimensions(node,{preferences:base.rendering.preferences}),preset=base.rendering.preferences.nodeDefaults?.[node.kind],isNote=node.kind==='note';entry=appendObject(native,uniqueId(native,'node',node.id),node.label,{...Object.fromEntries(Object.entries(nodeMetadata(node)).map(([k,v])=>[k,v===undefined?undefined:String(v)])),fmIndex:String(indexFor(native,'node'))},{vertex:1,parent:'1',style:isNote?`text;${fontStyle(preset?.fontSize??15)}align=left;verticalAlign=top;fillColor=${preset?.fill??'none'};strokeColor=${preset?.stroke??'none'};fontColor=${preset?.textColor??node.color??colors.dark};spacing=8;`:`${styleShape(size.shape)}${fontStyle(size.font)}fillColor=${preset?.fill??node.color??(node.kind==='decision'?'#fff8e5':colors.soft)};strokeColor=${preset?.stroke??colors.brand};fontColor=${preset?.textColor??colors.dark};strokeWidth=1.5;spacing=12;arcSize=16;`},{x:0,y:0,width:isNote?(preset?.width??320):size.width,height:isNote?(preset?.height??48):size.height});place(entry,node)
  }else{entry=mainEntry(native,'node',node.id);if(JSON.stringify(old)!==JSON.stringify(node)){unlocked(native,entry);assignNodeMetadata(entry,node);if(attr(entry.object,'fmControlled')!=='1')setCellText(entry,node.label)
    if(old.kind!==node.kind){const preset=base.rendering.preferences.nodeDefaults?.[node.kind],shape=preset?.shape??(node.kind==='decision'?'diamond':['start','end'].includes(node.kind)?'ellipse':'rounded');const style=(attr(entry.cell,'style')??'').split(';').filter(p=>!['rhombus','ellipse','text'].includes(p)&&!p.startsWith('shape=')&&!p.startsWith('rounded='));entry.cell.setAttribute('style',style.join(';')+';'+(node.kind==='note'?'text;':styleShape(shape)))}
    if(old.color!==node.color&&!base.rendering.preferences.nodeDefaults?.[node.kind]?.fill){const current=styleValue(entry,'fillColor'),oldFill=old.color??(old.kind==='decision'?'#fff8e5':colors.soft);if(current===oldFill)setStyle(entry,{fillColor:node.color??(node.kind==='decision'?'#fff8e5':colors.soft)})}
    if(old.laneId!==node.laneId||old.phaseId!==node.phaseId||(old.kind==='note')!==(node.kind==='note'))place(entry,node)
  }}
  if(!old||old.label!==node.label||old.kind!==node.kind||attr(entry.object,'fmControlled')==='1'&&JSON.stringify(old)!==JSON.stringify(node)){const before=box(entry);if(needsControlledNode(node)||attr(entry.object,'fmControlled')==='1')writeControlledNode(native,entry,node);const height=attr(entry.object,'fmControlled')==='1'?box(entry).height:Math.max(box(entry).height,neededHeight(entry,node.label));if(height>before.height){unlocked(native,entry);const delta=height-before.height;setBox(entry,{height});if(node.kind!=='note'){
    const parent=ancestorIntersection(native,entry)!;for(const sibling of directChildren(native,parent.id))if(sibling.id!==entry.id&&businessType(sibling)==='node'&&attr(sibling.object,'fmKind')!=='note'&&box(sibling).y>=before.y+before.height){unlocked(native,sibling);setBox(sibling,{y:box(sibling).y+delta})}
    const bottom=Math.max(...directChildren(native,parent.id).filter(e=>businessType(e)==='node'&&attr(e.object,'fmRole')==='main'&&attr(e.object,'fmKind')!=='note').map(e=>box(e).y+box(e).height));growPhase(node.phaseId,bottom+54)
   }}
  }
 }
 // Keep controlled headings attached to the first surviving native column.
 const corner=role(native,'corner')[0];if(corner)corner.cell.setAttribute('parent',mainEntry(native,'lane',next.lanes[0].id).id)
 for(const phase of next.phases){const entry=role(native,'title').find(e=>attr(e.object,'fmType')==='phase'&&attr(e.object,'fmId')===phase.id)!;entry.cell.setAttribute('parent',intersection(native,next.lanes[0].id,phase.id).id);if(cellText(entry)!==phase.label){unlocked(native,entry);setCellText(entry,phase.label);growPhase(phase.id,[...phase.label].length*32.8+32)}}
 // Decorations inside an explicitly removed container are preserved in the root
 // at their absolute position; no business ownership is inferred for them.
 const preserveChildren=(container:NativeCell)=>{for(const child of directChildren(native,container.id)){
   if(attr(child.object,'fmRole')==='intersection'){preserveChildren(child);removeEntry(native,child.id);continue}
   if(attr(child.object,'fmType')==='phase'&&attr(child.object,'fmRole')==='title'){removeEntry(native,child.id);continue}
   if(mainEntries(native).includes(child)&&businessType(child)!=='edge')fail('CONTAINER_NOT_EMPTY','容器仍含未迁移业务对象')
   unlocked(native,child);if(attr(child.cell,'vertex')==='1'){const b=absoluteBox(native,child);child.cell.setAttribute('parent','1');setBox(child,{x:b.x,y:b.y})}else if(attr(child.cell,'edge')==='1'){
    const origin=absoluteBox(native,container);const g=children(child.cell,'mxGeometry')[0];if(g)for(const item of children(g)){if(item.nodeName==='Array'&&attr(item,'as')==='points'){for(const p of children(item,'mxPoint')){p.setAttribute('x',String(Number(attr(p,'x')??0)+origin.x));p.setAttribute('y',String(Number(attr(p,'y')??0)+origin.y))}}else if(item.nodeName==='mxPoint'&&['sourcePoint','targetPoint'].includes(attr(item,'as')??'')){item.setAttribute('x',String(Number(attr(item,'x')??0)+origin.x));item.setAttribute('y',String(Number(attr(item,'y')??0)+origin.y))}}
    child.cell.setAttribute('parent','1')
   }else fail('UNSUPPORTED_CONTAINER_CHILD','无法安全保留容器内未知对象')
  }}
 for(const old of content.lanes)if(!next.lanes.some(l=>l.id===old.id)){for(const cell of role(native,'intersection').filter(e=>attr(e.object,'fmLaneId')===old.id)){preserveChildren(cell);removeEntry(native,cell.id)}const e=mainEntry(native,'lane',old.id);preserveChildren(e);removeEntry(native,e.id)}
 for(const old of content.phases)if(!next.phases.some(p=>p.id===old.id)){const e=mainEntry(native,'phase',old.id);preserveChildren(e);removeEntry(native,e.id)}
 if(oldUnphased&&next.phases.length){preserveChildren(oldUnphased);removeEntry(native,oldUnphased.id)}
 for(const lane of next.lanes){const entry=mainEntry(native,'lane',lane.id);if(cellText(entry)!==lane.label){unlocked(native,entry);setCellText(entry,lane.label)}const font=Number(styleValue(entry,'fontSize')??18),needed=Math.ceil(textUnits(lane.label)*font/Math.max(font,laneWidths.get(lane.id)!-24))*font*1.5+24;if(needed>headerHeight){headerHeight=needed;rowsChanged=true}}
 if(content.title!==next.title){unlocked(native,title);setCellText(title,next.title);native.diagram.setAttribute('name',next.title);const font=Number(styleValue(title,'fontSize')??24),lines=next.title.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(textUnits(line)*font/Math.max(font,box(title).width-24))),0),h=Math.max(box(title).height,lines*font*1.5+16);if(h>box(title).height){setBox(title,{height:h});const y=Math.max(tableBefore.y,box(title).y+h+24);setBox(table,{y})}}
 const totalWidth=left+[...laneWidths.values()].reduce((a,b)=>a+b,0)
 if(columnsChanged){setBox(header,{width:totalWidth});let x=left;for(const lane of next.lanes){setBox(mainEntry(native,'lane',lane.id),{x,width:laneWidths.get(lane.id)!});for(const p of wantedPhases)setBox(intersection(native,lane.id,p.id||undefined),{x,width:laneWidths.get(lane.id)!});x+=laneWidths.get(lane.id)!}for(const row of phaseRows.values())setBox(row,{width:totalWidth});setBox(table,{width:totalWidth})}
 if(rowsChanged){setBox(header,{height:headerHeight});for(const lane of next.lanes)setBox(mainEntry(native,'lane',lane.id),{height:headerHeight});if(corner)setBox(corner,{height:headerHeight});let y=headerHeight;for(const phase of wantedPhases){const row=phaseRows.get(phase.id)!,height=box(row).height;setBox(row,{y});for(const lane of next.lanes)setBox(intersection(native,lane.id,phase.id||undefined),{height});const phaseTitle=role(native,'title').find(e=>attr(e.object,'fmType')==='phase'&&attr(e.object,'fmId')===phase.id);if(phaseTitle)setBox(phaseTitle,{height:height-32});y+=height}setBox(table,{height:y})}
 // Native tableLayout follows actual sibling order, not our fmIndex metadata.
 // Move only the affected parent's entries; other parents retain their z-order.
 if(ids(content.lanes)!==ids(next.lanes)){for(const lane of next.lanes)native.root.appendChild(mainEntry(native,'lane',lane.id).object);for(const phase of wantedPhases)for(const lane of next.lanes)native.root.appendChild(intersection(native,lane.id,phase.id||undefined).object)}
 if(ids(content.phases)!==ids(next.phases)){native.root.appendChild(header.object);for(const phase of wantedPhases)native.root.appendChild(phaseRows.get(phase.id)!.object)}
 const noteBoxes:Array<ReturnType<typeof box>>=[]
 for(const node of next.nodes.filter(n=>n.kind==='note'&&!placedNotes.has(n.id))){const entry=mainEntry(native,'node',node.id),old=originalNotes.get(node.id),row=phaseRows.get(node.phaseId??''),newTop=box(table).y+(row?box(row).y:headerHeight);if(old&&old.parent==='1'&&old.phaseId===(node.phaseId??'')){const oldTop=originalPhaseTop.get(old.phaseId)??tableBefore.y+headerBefore.height;const delta=newTop-oldTop;if(delta)setBox(entry,{y:old.y+delta})}if(attr(entry.cell,'parent')==='1')noteBoxes.push(box(entry))}
 for(const node of next.nodes.filter(n=>n.kind==='note'&&placedNotes.has(n.id))){const entry=mainEntry(native,'node',node.id),row=phaseRows.get(node.phaseId??''),b=box(entry),x=box(table).x+box(table).width+28;let y=box(table).y+(row?box(row).y:headerHeight)+24,changed=true;while(changed){changed=false;for(const other of noteBoxes)if(x<other.x+other.width&&x+b.width>other.x&&y<other.y+other.height+16&&y+b.height+16>other.y){y=other.y+other.height+16;changed=true}}setBox(entry,{x,y});noteBoxes.push(box(entry))}
 for(const edge of next.edges){const old=content.edges.find(e=>e.id===edge.id);let entry=mainEntries(native).find(e=>businessType(e)==='edge'&&attr(e.object,'fmId')===edge.id)
  if(!entry){const defaults=base.rendering.preferences.edgeDefaults,arrow=defaults?.arrow??'end';entry=appendObject(native,uniqueId(native,'edge',edge.id),edge.label??'',{fmType:'edge',fmId:edge.id,fmRole:'main',fmKind:edge.kind,fmLabelPresent:edge.label!==undefined?'1':undefined,fmIndex:String(indexFor(native,'edge'))},{edge:1,parent:'1',source:mainEntry(native,'node',edge.source).id,target:mainEntry(native,'node',edge.target).id,style:`edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=32;${fontStyle(13)}labelWidth=${Math.max(24,Math.min(180,Math.ceil(textUnits(edge.label??'')*13)+8))};labelBackgroundColor=#ffffff;startArrow=${arrow==='both'?'block':'none'};endArrow=${arrow==='none'?'none':'block'};strokeWidth=${defaults?.width??1.5};strokeColor=${defaults?.color??colors.edge};dashed=${(defaults?.dashed??edge.kind==='feedback')?1:0};`})}
  else if(JSON.stringify(old)!==JSON.stringify(edge)){unlocked(native,entry);setCellText(entry,edge.label??'');entry.cell.setAttribute('source',mainEntry(native,'node',edge.source).id);entry.cell.setAttribute('target',mainEntry(native,'node',edge.target).id);if(edge.kind===undefined)entry.object.removeAttribute('fmKind');else entry.object.setAttribute('fmKind',edge.kind);if(edge.label===undefined)entry.object.removeAttribute('fmLabelPresent');else entry.object.setAttribute('fmLabelPresent','1')}
 }
 const reroute=next.edges.filter(edge=>{const old=content.edges.find(e=>e.id===edge.id);return !old||old.source!==edge.source||old.target!==edge.target||[edge.source,edge.target].some(id=>{const current=mainEntry(native,'node',id),previous=mainEntries(original).find(e=>businessType(e)==='node'&&attr(e.object,'fmId')===id);return !previous||JSON.stringify(absoluteRouteBox(native,current))!==JSON.stringify(absoluteRouteBox(original,previous))})}).map(edge=>mainEntry(native,'edge',edge.id));await routeNativeEdges(native,reroute)
 contentIndices(native,next);assertNativeLocks(native,original)
 const xml=serialize(native.document),hash=await contentHash(next),projection=await projectDrawio(xml,next),standalone=await projectDrawio(xml)
 if(projection.contentHash!==hash||standalone.contentHash!==hash)fail('PATCH_PROJECTION_MISMATCH','增量修改后的原生内容不一致')
 return {name:'drawio',version:DRAWIO_VERSION,adapterVersion:DRAWIO_ADAPTER_VERSION,xml,contentHash:hash}
}
