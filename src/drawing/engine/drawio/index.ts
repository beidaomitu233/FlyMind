import type{NativeLayoutHints}from'./layout-hints'
import {orientFreshSwimlane} from './orientation'
import {routeNativeEdges} from './routing'
import {isControlled,readControlledNode,readControlledEdge,controlledOwner,needsControlledNode,controlledNodeMetrics,writeControlledNode,writeControlledEdge} from './controlled'
import {compileGeneric} from './generic'
import {defaultProfileForKind} from '../profiles'
import {validateContent} from '../../core/layers'
import {copy,palette,type DiagramContent,type DiagramNode,type DiagramEdge} from '../../core/model'
import type {DiagramOperation} from '../../core/operations'
import {defaultRendering} from '../../core/render-config'
import {swimlaneRanks} from '../../core/swimlane-ranks'
import {contentHash} from '../content-hash'
import {validateProfilePreferences} from '../preferences'
import {FONT,metaKeys,nodeMetadata,fontStyle,textUnits,dimensions,styleShape} from './template'
import {DRAWIO_VERSION,DRAWIO_ADAPTER_VERSION,DEFAULT_SWIMLANE_PROFILE} from '../constants'
import type {DrawioCompileOptions,DrawioEngineDocument,DrawioProjectionResult,DrawingProjectV3,ProjectionDiagnostic} from '../types'
import {attr,cellText,children,element,fail,newDocument,parseNative,serialize,setCellText,type NativeCell,type NativeDocument} from './xml'
export {DRAWIO_VERSION,DRAWIO_ADAPTER_VERSION,DEFAULT_SWIMLANE_PROFILE}
export {drawioRenderSignature} from './xml'
export {normalizeDrawioEdits} from './normalize'

export function compileDrawio(input:DiagramContent,options:DrawioCompileOptions={}):Promise<DrawioEngineDocument>{return compileForRelayout(input,options)}
const PREFIX='fm:'
const cellId=(type:string,id:string)=>`${PREFIX}${type}:${encodeURIComponent(id)}`
type Attributes=Record<string,string|number|undefined>
const mainTypes=new Set(['node','annotation','edge','lane','phase','layer'])
function compatible(content:DiagramContent){
  if(!['swimlane','flowchart','architecture','mindmap','dataflow'].includes(content.kind))fail('UNSUPPORTED_DIAGRAM_KIND','当前模板批次尚未启用此类型')
  if(content.kind==='swimlane'&&content.groups.length)fail('UNSUPPORTED_SWIMLANE_GROUPS','当前泳道不接受额外业务分层')
}
function object(doc:Document,root:Element,id:string,label:string,metadata:Attributes,cellAttributes:Attributes,box?:{x:number;y:number;width:number;height:number}){
  const obj=element(doc,'UserObject',{id,label,fmAdapter:DRAWIO_ADAPTER_VERSION,...metadata}),cell=element(doc,'mxCell',cellAttributes)
  if(box)cell.appendChild(element(doc,'mxGeometry',{...box,as:'geometry'}))
  else if(cellAttributes.edge)cell.appendChild(element(doc,'mxGeometry',{relative:1,as:'geometry'}))
  obj.appendChild(cell);root.appendChild(obj);return obj
}
function onlyKeys(value:unknown,keys:string[],name:string){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('UNSUPPORTED_RENDERING_OPTION',`${name} 含未知字段或结构无效`)}
export async function compileForRelayout(input:DiagramContent,options:DrawioCompileOptions={},hints:NativeLayoutHints={}):Promise<DrawioEngineDocument>{
  const content=validateContent(input);compatible(content)
  onlyKeys(options,['preferences','profile','legacyRendering'],'编译选项')
  options={...options,profile:options.profile??defaultProfileForKind(content.kind),preferences:validateProfilePreferences(options.preferences??{},options.profile??defaultProfileForKind(content.kind))}
  if(options.legacyRendering)fail('UNSUPPORTED_LEGACY_RENDERING','D02 不迁移旧渲染覆盖')
  if(content.kind!=='swimlane'){const engine=await compileGeneric(content,options,hints),projected=await projectDrawio(engine.xml,content);if(projected.contentHash!==engine.contentHash)fail('COMPILE_PROJECTION_MISMATCH','新模板投影失配');return engine}
  const theme=options.preferences?.theme??'indigo',colors=palette[theme]
  if(!colors)fail('UNSUPPORTED_RENDERING_OPTION','未知主题')
  const doc=newDocument(),file=doc.documentElement
  for(const [key,value] of Object.entries({host:'FlyMind',version:DRAWIO_VERSION,compressed:'false',fmAdapter:DRAWIO_ADAPTER_VERSION}))file.setAttribute(key,value)
  const diagram=element(doc,'diagram',{id:cellId('page',content.id),name:content.title}),model=element(doc,'mxGraphModel',{grid:1,gridSize:10,guides:1,tooltips:1,connect:1,arrows:1,fold:1,page:0,pageScale:1,background:'#ffffff',math:0,shadow:0,fmDocumentId:content.id,fmKind:'swimlane',fmAdapter:DRAWIO_ADAPTER_VERSION,fmProfile:DEFAULT_SWIMLANE_PROFILE.id,fmProfileVersion:DEFAULT_SWIMLANE_PROFILE.version}),root=element(doc,'root')
  file.appendChild(diagram);diagram.appendChild(model);model.appendChild(root)
  root.appendChild(element(doc,'mxCell',{id:'0'}));root.appendChild(element(doc,'mxCell',{id:'1',parent:'0'}))
  const sizes=new Map(content.nodes.filter(n=>n.kind!=='note').map(n=>{const size=hints.nodes?.[n.id]?{...hints.nodes[n.id]}:dimensions(n,options);if(needsControlledNode(n))size.height=controlledNodeMetrics(n,size.width,size.font,size.shape,size.height).height;if(options.preferences?.orientation==='horizontal')[size.width,size.height]=[size.height,size.width];return [n.id,size]}))
  const laneWidths=content.lanes.map(l=>Math.max(360,...content.nodes.filter(n=>n.kind!=='note'&&n.laneId===l.id).map(n=>sizes.get(n.id)!.width+100),Math.ceil(textUnits(l.label)*18+36)))
  const left=160,totalWidth=left+laneWidths.reduce((a,b)=>a+b,0),header=64,padding=54,gap=options.preferences?.orientation==='horizontal'?144:88
  const titleLines=content.title.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(textUnits(line)*24/(totalWidth-24))),0),titleHeight=Math.max(48,titleLines*36+16),tableTop=24+titleHeight+24
  const phaseList=content.phases.length?content.phases:[{id:'',label:''}]
  const absoluteBoxes=new Map<string,{x:number;y:number;width:number;height:number}>()
  const nativePhases=phaseList.map(phase=>{
    const nodes=content.nodes.filter(n=>n.kind!=='note'&&(n.phaseId||'')===phase.id)
    const ranks=swimlaneRanks({...content,presentation:defaultRendering('swimlane'),updatedAt:0},nodes)
    const rankHeights:number[]=[]
    for(const n of nodes){const rank=hints.ranks?.[n.id]??ranks.get(n.id)!;ranks.set(n.id,rank);rankHeights[rank]=Math.max(rankHeights[rank]??0,sizes.get(n.id)!.height)}
    let height=padding;const yByRank:number[]=[]
    for(let rank=0;rank<rankHeights.length;rank++){yByRank[rank]=height;height+=(rankHeights[rank]||64)+gap}
    height=Math.max(200,height-gap+padding,[...phase.label].length*32.8+32,hints.phaseSizes?.[phase.id]??0)
    return {phase,nodes,ranks,height,yByRank}
  })
  const fullHeight=header+nativePhases.reduce((n,p)=>n+p.height,0)
  object(doc,root,cellId('title',content.id),content.title,{fmType:'decoration',fmId:content.id,fmRole:'title',fmDocumentId:content.id,fmKind:'swimlane',fmProfile:DEFAULT_SWIMLANE_PROFILE.id,fmProfileVersion:DEFAULT_SWIMLANE_PROFILE.version},{vertex:1,parent:'1',style:`text;${fontStyle(24)}align=left;verticalAlign=middle;fontStyle=1;fontColor=${colors.dark};resizable=1;spacing=0;`},{x:32,y:24,width:totalWidth,height:titleHeight})
  const table=cellId('table',content.id)
  object(doc,root,table,'',{fmType:'decoration',fmId:content.id,fmRole:'table'},{vertex:1,parent:'1',style:`shape=table;childLayout=tableLayout;startSize=0;container=1;collapsible=0;recursiveResize=0;expand=0;fixedHeader=1;rowLines=1;columnLines=1;strokeColor=#aab7ca;fillColor=#ffffff;swimlaneFillColor=#ffffff;${fontStyle()}`},{x:32,y:tableTop,width:totalWidth,height:fullHeight})
  const head=cellId('header',content.id)
  object(doc,root,head,'',{fmType:'decoration',fmId:content.id,fmRole:'header-row'},{vertex:1,parent:table,style:`shape=tableRow;horizontal=0;startSize=${left};swimlaneHead=0;swimlaneBody=0;fillColor=${colors.dark};swimlaneFillColor=${colors.dark};fontColor=#ffffff;strokeColor=inherit;collapsible=0;dropTarget=0;recursiveResize=0;expand=0;${fontStyle(17)}fontStyle=1;`},{x:0,y:0,width:totalWidth,height:header})
  let x=left
  for(let i=0;i<content.lanes.length;i++){const lane=content.lanes[i];object(doc,root,cellId('lane',lane.id),lane.label,{fmType:'lane',fmId:lane.id,fmRole:'main'},{vertex:1,parent:head,style:`shape=partialRectangle;top=0;left=0;bottom=0;right=0;fillColor=${colors.dark};fontColor=#ffffff;strokeColor=inherit;connectable=0;align=center;verticalAlign=middle;${fontStyle(18)}fontStyle=1;`},{x,y:0,width:laneWidths[i],height:header});x+=laneWidths[i]}
  // A child of the first header cell keeps the corner text inside the native
  // table's coordinate system without creating an extra native table column.
  object(doc,root,cellId('corner',content.id),'阶段 / 角色',{fmType:'decoration',fmId:content.id,fmRole:'corner'},{vertex:1,parent:cellId('lane',content.lanes[0].id),style:`text;${fontStyle(17)}align=center;verticalAlign=middle;fontStyle=1;fontColor=#ffffff;`},{x:-left,y:0,width:left,height:header})
  let phaseY=header
  for(const data of nativePhases){
    const {phase,nodes,ranks,height,yByRank}=data,row=cellId('phase',phase.id||'unphased')
    object(doc,root,row,'',{fmType:phase.id?'phase':'decoration',fmId:phase.id||content.id,fmRole:phase.id?'main':'unphased-row'},{vertex:1,parent:table,style:`shape=tableRow;horizontal=0;startSize=${left};swimlaneHead=0;swimlaneBody=0;fillColor=${colors.soft};fontColor=${colors.dark};strokeColor=inherit;collapsible=0;dropTarget=0;recursiveResize=0;expand=0;${fontStyle(18)}fontStyle=1;align=center;verticalAlign=middle;spacingLeft=12;spacingRight=12;`},{x:0,y:phaseY,width:totalWidth,height})
    x=left
    for(let i=0;i<content.lanes.length;i++){
      const lane=content.lanes[i],intersection=cellId('intersection',JSON.stringify([phase.id,lane.id]))
      object(doc,root,intersection,'',{fmType:'decoration',fmId:JSON.stringify([phase.id,lane.id]),fmRole:'intersection',fmLaneId:lane.id,fmPhaseId:phase.id||undefined},{vertex:1,parent:row,style:`swimlane;startSize=0;swimlaneHead=0;swimlaneBody=0;container=1;fillColor=#ffffff;swimlaneFillColor=#ffffff;strokeColor=inherit;collapsible=0;recursiveResize=0;expand=0;connectable=0;${fontStyle()}`},{x,y:0,width:laneWidths[i],height})
      if(i===0&&phase.id){
        const title=object(doc,root,cellId('phase-title',phase.id),phase.label,{fmType:'phase',fmId:phase.id,fmRole:'title',fmTextLayout:'phase-vertical'},{vertex:1,parent:intersection,style:`text;fontFamily=${FONT};fontSize=24;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;spacing=0;overflow=visible;fontColor=${colors.dark};fontStyle=1;`},{x:-left+(left-40)/2,y:16,width:40,height:height-32})
        const titleEntry={id:title.getAttribute('id')!,object:title,cell:children(title,'mxCell')[0]};setCellText(titleEntry,phase.label)
      }
      for(const node of nodes.filter(n=>n.laneId===lane.id)){
        const size=sizes.get(node.id)!,fill=options.preferences?.nodeDefaults?.[node.kind]?.fill??node.color??(node.kind==='decision'?'#fff8e5':colors.soft)
        const box={x:Math.round((laneWidths[i]-size.width)/2),y:yByRank[ranks.get(node.id)!],width:size.width,height:size.height}
        object(doc,root,cellId('node',node.id),node.label,nodeMetadata(node),{vertex:1,parent:intersection,style:`${styleShape(size.shape)}${fontStyle(size.font)}fillColor=${fill};strokeColor=${options.preferences?.nodeDefaults?.[node.kind]?.stroke??colors.brand};fontColor=${options.preferences?.nodeDefaults?.[node.kind]?.textColor??colors.dark};strokeWidth=1.5;spacing=12;arcSize=16;`},box)
        absoluteBoxes.set(node.id,{...box,x:32+x+box.x,y:tableTop+phaseY+box.y})
      }
      x+=laneWidths[i]
    }
    phaseY+=height
  }
  // Floating notes are individually sized and can extend outside the table;
  // their text never enlarges a phase or changes the main business ranking.
  let noteBottom=tableTop+header
  for(const note of content.nodes.filter(n=>n.kind==='note').sort((a,b)=>phaseList.findIndex(p=>p.id===a.phaseId)-phaseList.findIndex(p=>p.id===b.phaseId))){
    let phaseTop=tableTop+header
    for(const data of nativePhases){if(data.phase.id===note.phaseId)break;phaseTop+=data.height}
    if(!note.phaseId)phaseTop=tableTop+header
    const preset=options.preferences?.nodeDefaults?.note,width=preset?.width??320,font=preset?.fontSize??15,lines=note.label.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(textUnits(line)*font/Math.max(font,width-16))),0),height=Math.max(preset?.height??48,lines*font*1.5+20,needsControlledNode(note)?controlledNodeMetrics(note,width,font,'rectangle',48).height:0),y=Math.max(phaseTop+20,noteBottom+16)
    const box={x:32+totalWidth+28,y,width,height};object(doc,root,cellId('node',note.id),note.label,nodeMetadata(note),{vertex:1,parent:'1',style:`text;${fontStyle(font)}align=left;verticalAlign=top;fillColor=${preset?.fill??'none'};strokeColor=${preset?.stroke??'none'};fontColor=${preset?.textColor??note.color??colors.dark};spacing=8;`},box);noteBottom=y+height;absoluteBoxes.set(note.id,box)
  }
  for(const edge of content.edges){
    const edgeOptions=options.preferences?.edgeDefaults,route=edgeOptions?.route??'orthogonal'
    if(route!=='orthogonal')fail('UNSUPPORTED_RENDERING_OPTION','D02 使用引擎正交路由')
    const arrow=edgeOptions?.arrow??'end'
    if(!['end','both','none'].includes(arrow))fail('UNSUPPORTED_RENDERING_OPTION','未知箭头标准')
    const labelWidth=Math.min(220,Math.max(24,Math.ceil(textUnits(edge.label??'')*13)+16))
    const source=absoluteBoxes.get(edge.source)!,target=absoluteBoxes.get(edge.target)!,sourceX=source.x+source.width/2,targetX=target.x+target.width/2,sourceY=source.y+source.height/2,targetY=target.y+target.height/2,crossColumn=Math.abs(sourceX-targetX)>8
    const skipsNode=!crossColumn&&[...absoluteBoxes].some(([id,box])=>id!==edge.source&&id!==edge.target&&Math.abs(box.x+box.width/2-sourceX)<8&&box.y+box.height/2>Math.min(sourceY,targetY)&&box.y+box.height/2<Math.max(sourceY,targetY))
    // Native side ports keep handoffs in column gutters. The editor still owns
    // all bends and orthogonal routing; no waypoint path is generated here.
    const ports=crossColumn?`exitX=${targetX>sourceX?1:0};exitY=0.5;entryX=${targetX>sourceX?0:1};entryY=0.5;`:(targetY<=sourceY||skipsNode)?'exitX=1;exitY=0.5;entryX=1;entryY=0.5;':'exitX=0.5;exitY=1;entryX=0.5;entryY=0;'
    const edgeObject=object(doc,root,cellId('edge',edge.id),edge.label??'',{fmType:'edge',fmId:edge.id,fmKind:edge.kind,fmRole:'main',fmLabelPresent:edge.label!==undefined?'1':undefined},{edge:1,parent:'1',source:cellId('node',edge.source),target:cellId('node',edge.target),style:`edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=32;${ports}fontFamily=${FONT};fontSize=13;html=0;whiteSpace=wrap;labelWidth=${labelWidth};align=center;verticalAlign=middle;startArrow=${arrow==='both'?'block':'none'};startFill=1;endArrow=${arrow==='none'?'none':'block'};endFill=1;strokeWidth=${edgeOptions?.width??1.5};strokeColor=${edgeOptions?.color??(edge.kind==='feedback'?'#b77730':colors.edge)};dashed=${(edgeOptions?.dashed??edge.kind==='feedback')?1:0};labelBackgroundColor=#ffffff;spacing=6;`})
    if(edge.label)children(children(edgeObject,'mxCell')[0],'mxGeometry')[0].appendChild(element(doc,'mxPoint',{x:0,y:Math.abs(source.y-target.y)<1?(targetX>sourceX?-56:56):edge.kind==='feedback'?24:-18,as:'offset'}))
  }
  // XML hierarchy groups children by container; preserve the content array's
  // stable serialization order on each binding, without storing another content.
  for(const e of children(root)){const type=attr(e,'fmType'),collection=type==='node'||type==='annotation'?content.nodes:type==='edge'?content.edges:type==='lane'?content.lanes:type==='phase'?content.phases:undefined;if(collection)e.setAttribute('fmIndex',String(collection.findIndex(x=>x.id===attr(e,'fmId'))))}
  const native=parseNative(serialize(doc));if(options.preferences?.orientation==='horizontal')orientFreshSwimlane(native);for(const node of content.nodes)writeControlledNode(native,[...native.cells.values()].find(e=>attr(e.object,'fmId')===node.id&&attr(e.object,'fmRole')==='main'&&['node','annotation'].includes(attr(e.object,'fmType')??''))!,node);await routeNativeEdges(native,[...native.cells.values()].filter(e=>attr(e.object,'fmType')==='edge'))
  const xml=serialize(native.document)
  // Compile and projection share the same strict parser and binding rules.
  const projected=await projectDrawio(xml,content)
  if(projected.contentHash!==await contentHash(content))fail('COMPILE_PROJECTION_MISMATCH','初次编译内容往返不一致')
  return {name:'drawio',version:DRAWIO_VERSION,adapterVersion:DRAWIO_ADAPTER_VERSION,xml,contentHash:projected.contentHash}
}

interface Bindings {main:Map<string,NativeCell>;titles:Map<string,NativeCell>;title:NativeCell;diagnostics:ProjectionDiagnostic[]}
const bindingKey=(type:string,id:string)=>`${type}\0${id}`
function bindings(native:NativeDocument):Bindings{
  const main=new Map<string,NativeCell>(),titles=new Map<string,NativeCell>(),diagnostics:ProjectionDiagnostic[]=[];let title:NativeCell|undefined
  for(const entry of native.cells.values()){
    const type=attr(entry.object,'fmType'),role=attr(entry.object,'fmRole')??'main',id=attr(entry.object,'fmId')
    if(!type){if(entry.id!=='0'&&entry.id!=='1')diagnostics.push({code:'DECORATION_PRESERVED',message:'无业务绑定元素保留为画布装饰',cellId:entry.id});continue}
    if(attr(entry.object,'fmAdapter')!==DRAWIO_ADAPTER_VERSION)fail('UNSUPPORTED_ADAPTER','对象绑定版本不支持')
    if(type==='decoration'){if(role==='title'){if(title)fail('DUPLICATE_BINDING','文档标题重复绑定');title=entry}continue}
    if(!mainTypes.has(type))fail('UNKNOWN_BINDING','未知业务绑定类型')
    if(!id)fail('INVALID_BINDING','业务对象缺少 fmId')
    const index=attr(entry.object,'fmIndex');if(index!==undefined&&(!Number.isInteger(Number(index))||Number(index)<0||Number(index)>10000))fail('INVALID_BINDING','业务序列索引无效')
    const key=bindingKey(type==='annotation'?'node':type,id)
    if(role==='title'&&type==='phase'){if(attr(entry.cell,'vertex')!=='1')fail('INVALID_BINDING','受控标题必须为顶点');if(titles.has(key))fail('DUPLICATE_BINDING','受控阶段标题重复');titles.set(key,entry);continue}
    if(isControlled(entry)){if(attr(entry.cell,'vertex')!=='1')fail('INVALID_BINDING','受控文本必须是原生顶点');continue}
    if(role!=='main')fail('INVALID_BINDING','未知业务子元素角色')
    if(main.has(key))fail('DUPLICATE_BINDING','同类业务 ID 重复主绑定')
    if(type==='edge'?attr(entry.cell,'edge')!=='1':attr(entry.cell,'vertex')!=='1')fail('INVALID_BINDING','业务对象与原生 cell 类型不符')
    main.set(key,entry)
  }
  if(!title)fail('MISSING_TITLE','缺少可见文档标题绑定')
  for(const [key,child] of titles){const owner=main.get(key);if(!owner)fail('BROKEN_REFERENCE','受控标题缺少主对象');let current:NativeCell|undefined=child;const visited=new Set<string>();while(current&&current.id!==owner.id){if(visited.has(current.id))fail('CYCLIC_PARENT','受控标题 parent 循环');visited.add(current.id);const parent=attr(current.cell,'parent');current=parent?native.cells.get(parent):undefined}if(!current)fail('INVALID_BINDING','受控标题不在对应主对象内')}
  for(const child of native.cells.values())if(isControlled(child)){const owner=controlledOwner(native,child);if(attr(owner.object,'fmControlled')!=='1'||attr(child.object,'fmId')!==attr(owner.object,'fmId')||attr(child.object,'fmType')!==attr(owner.object,'fmType'))fail('CONTROLLED_OWNER_MISMATCH','受控子元素必须位于声明的同一主对象内');}
  return {main,titles,title,diagnostics}
}
function sorted<T extends {id:string}>(items:T[],map:Bindings,type:string,base?:T[]):T[]{const order=new Map(base?.map((x,i)=>[x.id,i]));const index=(x:T)=>{const raw=attr(map.main.get(bindingKey(type,x.id))!.object,'fmIndex');return raw!==undefined?Number(raw):order.get(x.id)??1e6};return items.sort((a,b)=>index(a)-index(b))}
function optionalNode(entry:NativeCell,node:DiagramNode){
  for(const key of ['laneId','phaseId',...metaKeys] as const){const raw=attr(entry.object,`fm${key[0].toUpperCase()+key.slice(1)}`);if(raw!==undefined){if(key==='items'){try{node.items=JSON.parse(raw)}catch{fail('INVALID_METADATA','模块条目不是有效 JSON')}}else (node as unknown as Record<string,unknown>)[key]=raw}}
}
export async function projectDrawio(xml:string,baseContent?:DiagramContent):Promise<DrawioProjectionResult>{
  const base=baseContent?validateContent(baseContent):undefined,native=parseNative(xml),map=bindings(native)
  // Custom mxGraphModel attributes are not a dependable native-save contract.
  // Document identity lives on the visible title UserObject, not a hidden JSON copy.
  const id=attr(map.title.object,'fmDocumentId'),kind=attr(map.title.object,'fmKind')
  if(!id||!['swimlane','flowchart','architecture','mindmap','dataflow'].includes(kind??''))fail('UNSUPPORTED_DIAGRAM_KIND','缺少受支持的文档业务身份')
  if(base&&(base.id!==id||base.kind!==kind))fail('DOCUMENT_IDENTITY_MISMATCH','XML 与内容不属于同一图形')
  const content:DiagramContent={schemaVersion:1,id,title:cellText(map.title),kind:kind as DiagramContent['kind'],nodes:[],edges:[],lanes:[],phases:[],groups:[]}
  const nodeByCell=new Map<string,string>()
  for(const entry of map.main.values()){
    const type=attr(entry.object,'fmType')!,businessId=attr(entry.object,'fmId')!,label=cellText(entry)
    if(type==='node'||type==='annotation'){
      const node={id:businessId,label,kind:attr(entry.object,'fmKind')} as DiagramNode
      if((type==='annotation')!==(node.kind==='note'))fail('INVALID_BINDING','批注类型与 fmKind 不一致')
      optionalNode(entry,node);const visible=readControlledNode(native,entry);if(visible)Object.assign(node,visible);content.nodes.push(node);nodeByCell.set(entry.id,businessId)
    }else if(type==='lane')content.lanes.push({id:businessId,label})
    else if(type==='phase')content.phases.push({id:businessId,label:map.titles.has(bindingKey('phase',businessId))?cellText(map.titles.get(bindingKey('phase',businessId))!):label})
    else if(type==='layer'){const group:DiagramContent['groups'][number]={id:businessId,label};for(const key of ['kind','color'] as const){const value=attr(entry.object,key==='kind'?'fmKind':'fmColor');if(value!==undefined)(group as unknown as Record<string,unknown>)[key]=value}content.groups.push(group)}
  }
  for(const entry of map.main.values())if(attr(entry.object,'fmType')==='edge'){
    const source=nodeByCell.get(attr(entry.cell,'source')??''),target=nodeByCell.get(attr(entry.cell,'target')??'')
    if(!source||!target)fail('BROKEN_BUSINESS_REFERENCE','业务连线端点没有节点主绑定')
    const edge:DiagramEdge={id:attr(entry.object,'fmId')!,source,target},label=readControlledEdge(native,entry)??cellText(entry),kind=attr(entry.object,'fmKind')
    if(label||attr(entry.object,'fmLabelPresent')==='1'||attr(entry.object,'fmControlled')==='1')edge.label=label
    if(kind!==undefined)edge.kind=kind as DiagramEdge['kind']
    content.edges.push(edge)
  }
  for(const entry of native.cells.values())if(attr(entry.object,'fmRole')==='intersection'){
    const laneId=attr(entry.object,'fmLaneId'),phaseId=attr(entry.object,'fmPhaseId'),row=native.cells.get(attr(entry.cell,'parent')??'')
    if(!laneId||!map.main.has(bindingKey('lane',laneId)))fail('OWNERSHIP_MISMATCH','交叉格缺少对应角色')
    if(phaseId?(!row||attr(row.object,'fmType')!=='phase'||attr(row.object,'fmId')!==phaseId):content.phases.length>0)fail('OWNERSHIP_MISMATCH','交叉格与原生阶段行不一致')
  }
  // The binding determines semantic ownership; the intersection parent is checked
  // as additional evidence. A manual move is never silently guessed from pixels.
  for(const node of content.kind==='swimlane'?content.nodes:[]){
    if(node.kind==='note')continue
    const entry=map.main.get(bindingKey('node',node.id))!;let ancestor=attr(entry.cell,'parent'),intersection:NativeCell|undefined
    while(ancestor){const p=native.cells.get(ancestor)!;if(attr(p.object,'fmRole')==='intersection'){intersection=p;break}ancestor=attr(p.cell,'parent')}
    if(!intersection)fail('UNASSIGNED_NODE','业务节点须在明确的角色/阶段交叉容器内')
    if(node.laneId!==attr(intersection.object,'fmLaneId')||(node.phaseId??'')!==(attr(intersection.object,'fmPhaseId')??''))fail('OWNERSHIP_MISMATCH','节点业务归属与原生交叉容器不一致')
  }
  if(content.kind==='architecture')for(const node of content.nodes.filter(n=>n.kind!=='note')){const entry=map.main.get(bindingKey('node',node.id))!;let parent=attr(entry.cell,'parent'),groupId:string|undefined;while(parent){const p=native.cells.get(parent)!;if(attr(p.object,'fmType')==='layer'&&(attr(p.object,'fmRole')??'main')==='main'){groupId=attr(p.object,'fmId');break}parent=attr(p.cell,'parent')}if(groupId!==node.groupId)fail('OWNERSHIP_MISMATCH','架构模块归层与原生容器不一致')}
  content.nodes=sorted(content.nodes,map,'node',base?.nodes);content.edges=sorted(content.edges,map,'edge',base?.edges);content.lanes=sorted(content.lanes,map,'lane',base?.lanes);content.phases=sorted(content.phases,map,'phase',base?.phases);content.groups=sorted(content.groups,map,'layer',base?.groups)
  if(content.kind==='mindmap'){const expected=content.nodes.filter(n=>n.parentId),derived=[...native.cells.values()].filter(e=>attr(e.object,'fmRole')==='parent-edge');if(derived.length!==expected.length)fail('MISSING_PARENT_EDGE','脑图派生父子线数量不一致');const seen=new Set<string>();for(const e of derived){const child=attr(e.object,'fmChildId'),node=expected.find(n=>n.id===child);if(!node||seen.has(child!)||nodeByCell.get(attr(e.cell,'source')??'')!==node.parentId||nodeByCell.get(attr(e.cell,'target')??'')!==node.id)fail('PARENT_EDGE_MISMATCH','脑图派生线与父子语义不一致');seen.add(child!)}}
  const checked=validateContent(content);compatible(checked)
  return {content:checked,xml,contentHash:await contentHash(checked),diagnostics:map.diagnostics}
}

export {patchDrawio} from './patch'

/** This delivery exposes only explicit layout/direction, not unfinished visual options. */
export async function configureDrawio(base:DrawingProjectV3,changes:import('../types').DrawioRenderingChanges):Promise<import('../types').DrawioConfigureResult>{
 if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).some(key=>!['orientation','relayout'].includes(key)))fail('UNSUPPORTED_RENDERING_OPTION','当前仅支持显式自动排版 relayout 与横竖方向 orientation，其他配置尚未开放')
 if(changes.relayout!==true)fail('RELAYOUT_REQUIRED','自动排版或切换方向需要显式 relayout=true；会重置人工位置与连线路径，保留样式和业务关系')
 return (await import('./configure')).configureDrawio(base,changes)
}
