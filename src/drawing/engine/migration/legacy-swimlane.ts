import {validateDocument,copy,palette,type DiagramContent,type DiagramDocument,type DiagramScene,type Box} from '../../core/model'
import {extractContent} from '../../core/layers'
import {layoutDocument} from '../../core/layout'
import {orderedNodes} from '../../core/objects'
import {nodePreset,edgePreset} from '../../core/render-config'
import {textAppearance} from '../../core/floating-text'
import {pathPoints} from '../../core/geometry'
import {edgeLabelBox} from '../../core/routing'
import {canonicalContentJson,contentHash} from '../content-hash'
import {createDrawingProject} from '../project'
import {validateProfilePreferences} from '../preferences'
import type {RenderingPreferences} from '../types'
import {DEFAULT_SWIMLANE_PROFILE,DRAWIO_VERSION,DRAWIO_ADAPTER_VERSION} from '../constants'
import {RUNTIME_FONT_FAMILY} from '../runtime-assets'
import {newDocument,element,children,serialize,parseNative,setCellText} from '../drawio/xml'
import {nodeMetadata,styleShape} from '../drawio/template'
import {LEGACY_SWIMLANE_CONVERTER_VERSION,type LegacyMigrationPreview,type LegacyMigrationOptions,type LegacyMigrationDiagnostic,type LegacyMigrationConvertOptions} from './types'

type Json=Record<string,any>
const id=(type:string,businessId:string)=>`fm:${type}:${encodeURIComponent(businessId)}`
const hash=async(value:unknown)=>{const bytes=new TextEncoder().encode(canonicalContentJson(value as DiagramContent)),digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}
const validTime=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>0&&n<=8_640_000_000_000_000
const plain=(value:unknown):value is Json=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))
const numbers=(box:Box)=>Object.values(box).every(n=>Number.isFinite(n)&&Math.abs(n)<=50000)&&box.width>0&&box.height>0
const font=(size:number)=>`fontFamily=${RUNTIME_FONT_FAMILY};fontSize=${size};html=0;whiteSpace=wrap;`
function diagnostic(list:LegacyMigrationDiagnostic[],severity:'warning'|'blocking',code:string,path:string,message:string,businessId?:string){list.push({severity,code,path,message,...(businessId?{businessId}:{})})}

/** Interpret the historical layout once. No v3 compile/solver/renderScene calls. */
function nativeSnapshot(d:DiagramDocument,scene:DiagramScene){
 const doc=newDocument(),file=doc.documentElement;file.setAttribute('host','FlyMind');file.setAttribute('version',DRAWIO_VERSION);file.setAttribute('compressed','false')
 const diagram=element(doc,'diagram',{id:id('page',d.id),name:d.title}),model=element(doc,'mxGraphModel',{page:0,grid:1,gridSize:10,guides:1,background:'#ffffff',math:0,shadow:0}),root=element(doc,'root');file.appendChild(diagram);diagram.appendChild(model);model.appendChild(root);root.appendChild(element(doc,'mxCell',{id:'0'}));root.appendChild(element(doc,'mxCell',{id:'1',parent:'0'}))
 const object=(cellId:string,label:string,metadata:Record<string,string|number|undefined>,style:string,box:Box,parent='1',edge?:{source:string;target:string})=>{
  const o=element(doc,'UserObject',{id:cellId,label,fmAdapter:DRAWIO_ADAPTER_VERSION,...metadata}),c=element(doc,'mxCell',{parent,style,...(edge?{edge:1,...edge}:{vertex:1})});o.appendChild(c);root.appendChild(o);c.appendChild(element(doc,'mxGeometry',edge?{relative:1,as:'geometry'}:{x:box.x,y:box.y,width:box.width,height:box.height,as:'geometry'}));return {id:cellId,object:o,cell:c}
 }
 const p=palette[d.presentation.theme],title=scene.containers.find(c=>c.kind==='title')!,lanes=scene.containers.filter(c=>c.kind==='lane'),phases=scene.containers.filter(c=>c.kind==='phase'),corner=scene.containers.find(c=>c.kind==='corner')!,left=corner.width,tableX=corner.x,tableY=corner.y,tableWidth=left+lanes.reduce((n,l)=>n+l.width,0),tableHeight=Math.max(...lanes.map(l=>l.height)),empty={x:0,y:0,width:1,height:1}
 object(id('title',d.id),d.title,{fmType:'decoration',fmId:d.id,fmRole:'title',fmDocumentId:d.id,fmKind:'swimlane',fmProfile:DEFAULT_SWIMLANE_PROFILE.id,fmProfileVersion:DEFAULT_SWIMLANE_PROFILE.version},`rounded=1;arcSize=10;fillColor=${p.dark};gradientColor=${p.brand};gradientDirection=east;strokeColor=none;${font(25)}fontStyle=1;fontColor=#ffffff;align=center;verticalAlign=middle;spacing=0;`,title)
 // Native containers deliberately have no tableLayout: replaying that layout
 // would change historical geometry on the first real load/save.
 object(id('table',d.id),'',{fmType:'decoration',fmId:d.id,fmRole:'table'},'shape=none;container=1;recursiveResize=0;collapsible=0;expand=0;connectable=0;pointerEvents=0;fillColor=none;strokeColor=none;',{x:tableX,y:tableY,width:tableWidth,height:tableHeight})
 for(const lane of lanes){const body=object(id('lane-body',lane.id),'',{fmType:'decoration',fmRole:'legacy-lane-body'},'rounded=0;fillColor=#ffffff;strokeColor=#d4ddeb;connectable=0;pointerEvents=0;',{x:lane.x,y:lane.y,width:lane.width,height:lane.height});root.insertBefore(body.object,root.childNodes.item(3))}
 object(id('header',d.id),'',{fmType:'decoration',fmId:d.id,fmRole:'header-row'},`shape=none;container=1;startSize=${left};recursiveResize=0;collapsible=0;expand=0;fillColor=none;strokeColor=none;`,{x:0,y:0,width:tableWidth,height:corner.height},id('table',d.id))
 object(id('corner',d.id),'',{fmType:'decoration',fmRole:'corner'},`rounded=0;fillColor=${p.brand};strokeColor=none;`,{x:0,y:0,width:left,height:corner.height},id('header',d.id))
 for(const [index,lane]of lanes.entries())object(id('lane',lane.id),lane.label,{fmType:'lane',fmId:lane.id,fmIndex:index},`rounded=0;fillColor=${p.brand};strokeColor=none;${font(18)}fontStyle=1;fontColor=#ffffff;align=center;verticalAlign=middle;spacing=0;`,{x:lane.x-tableX,y:0,width:lane.width,height:corner.height},id('header',d.id))
 const origins=new Map<string,Box>();
 for(const [index,phase]of phases.entries()){
  const row=id('phase',phase.id||'unphased');object(row,'',{fmType:phase.id?'phase':'decoration',fmId:phase.id||d.id,fmIndex:phase.id?index:undefined,fmRole:phase.id?'main':'unphased-row'},'shape=none;container=1;recursiveResize=0;collapsible=0;expand=0;fillColor=none;strokeColor=none;',{x:0,y:phase.y-tableY,width:tableWidth,height:phase.height},id('table',d.id))
  const phaseTitle=object(id('phase-title',phase.id||'unphased'),phase.label,{fmType:phase.id?'phase':'decoration',fmId:phase.id||d.id,fmRole:phase.id?'title':'legacy-phase-title',fmTextLayout:'phase-vertical'},`rounded=0;fillColor=${p.soft};strokeColor=#d4ddeb;fontFamily=${RUNTIME_FONT_FAMILY};fontSize=24;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;fontColor=${p.dark};fontStyle=1;spacing=0;`,{x:0,y:0,width:phase.width,height:phase.height},row);setCellText(phaseTitle,phase.label)
  for(const lane of lanes){const key=JSON.stringify([phase.id,lane.id]),intersection=id('intersection',key);object(intersection,'',{fmType:'decoration',fmId:key,fmRole:'intersection',fmLaneId:lane.id,fmPhaseId:phase.id||undefined},'swimlane;startSize=0;container=1;recursiveResize=0;collapsible=0;expand=0;connectable=0;fillColor=none;strokeColor=none;',{x:lane.x-tableX,y:0,width:lane.width,height:phase.height},row);origins.set(intersection,{x:lane.x,y:phase.y,width:lane.width,height:phase.height})}
  // The old phase separator is a visual line only, never a business edge.
  object(id('phase-line',phase.id||'unphased'),'',{fmType:'decoration',fmRole:'legacy-phase-line'},'rounded=0;fillColor=none;strokeColor=#b9c5d5;dashed=1;dashPattern=10 8;',{x:left,y:phase.height,width:tableWidth-left,height:0.01},row)
 }
 const groupFor=new Map<string,string>();
 for(const [groupId,members]of Object.entries(d.presentation.objects?.groups??{})){
  const nodes=members.map(member=>scene.nodes.find(n=>n.node.id===member)!),first=nodes[0].node,parent=id('intersection',JSON.stringify([first.phaseId??'',first.laneId])),origin=origins.get(parent)!,x=Math.min(...nodes.map(n=>n.x)),y=Math.min(...nodes.map(n=>n.y)),width=Math.max(...nodes.map(n=>n.x+n.width))-x,height=Math.max(...nodes.map(n=>n.y+n.height))-y,cellId=id('object-group',groupId)
  object(cellId,'',{fmType:'decoration',fmRole:'legacy-object-group',fmLegacyGroupId:groupId},'group;container=1;recursiveResize=0;collapsible=0;fillColor=none;strokeColor=none;',{x:x-origin.x,y:y-origin.y,width,height},parent);origins.set(cellId,{x,y,width,height});members.forEach(member=>groupFor.set(member,cellId))
 }
 for(const node of orderedNodes(d)){
  const box=scene.nodes.find(n=>n.node.id===node.id)!,note=node.kind==='note',preset=nodePreset(d,node.kind),style=d.presentation.styles?.[node.id],text=note?textAppearance(d,node):undefined,parent=groupFor.get(node.id)??(note?'1':id('intersection',JSON.stringify([node.phaseId??'',node.laneId]))),origin=origins.get(parent)??{x:0,y:0},size=style?.fontSize??preset.fontSize,shape=style?.shape??preset.shape,locked=d.presentation.objects?.locked?.includes(node.id)
  object(id('node',node.id),node.label,{...nodeMetadata(node),fmIndex:d.nodes.findIndex(n=>n.id===node.id)},`${note?'text;':styleShape(shape)}${font(note?text!.fontSize:size)}fillColor=${note?'none':node.badge==='3期'?'#fff8ec':box.fill};strokeColor=${note?'none':node.badge==='3期'?'#df913d':box.color};fontColor=${note?text!.color:box.textColor};strokeWidth=1.5;arcSize=12;spacing=0;align=${note?'left':'center'};verticalAlign=middle;${note?'spacingLeft=6;spacingRight=6;':''}${locked?'locked=1;':''}`,{x:box.x-origin.x,y:box.y-origin.y,width:box.width,height:box.height},parent)
 }
 for(const [index,e]of scene.edges.entries()){
  const style=d.presentation.edges?.[e.edge.id],defaults=edgePreset(d),points=e.points??pathPoints(e.path),source=scene.nodes.find(n=>n.node.id===e.edge.source)!,target=scene.nodes.find(n=>n.node.id===e.edge.target)!,first=points[0],last=points.at(-1)!,arrow=style?.arrow??defaults.arrow,label=e.edge.label??'',fontSize=style?.labelFontSize??13,metrics=edgeLabelBox(label,fontSize),labelBox=e.labelBox??{x:e.labelX-metrics.width/2,y:e.labelY-metrics.height/2,width:metrics.width,height:metrics.height}
  const entry=object(id('edge',e.edge.id),label,{fmType:'edge',fmId:e.edge.id,fmIndex:d.edges.findIndex(x=>x.id===e.edge.id),fmKind:e.edge.kind,fmLabelPresent:e.edge.label!==undefined?'1':undefined},`noEdgeStyle=1;rounded=0;curved=0;exitX=${(first.x-source.x)/source.width};exitY=${(first.y-source.y)/source.height};exitPerimeter=0;entryX=${(last.x-target.x)/target.width};entryY=${(last.y-target.y)/target.height};entryPerimeter=0;${font(fontSize)}labelWidth=${labelBox.width};labelBackgroundColor=#ffffff;fontColor=${style?.labelColor??e.color};strokeColor=${e.color};strokeWidth=${style?.width??defaults.width};startArrow=${arrow==='both'?'block':'none'};endArrow=${arrow==='none'?'none':'block'};dashed=${(style?.dashed??defaults.dashed)?1:0};spacing=0;align=center;verticalAlign=middle;`,empty,'1',{source:id('node',e.edge.source),target:id('node',e.edge.target)}),g=children(entry.cell,'mxGeometry')[0]
  let remaining=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0)/2,midpoint=first;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],distance=Math.hypot(b.x-a.x,b.y-a.y);if(remaining<=distance){const t=distance?remaining/distance:0;midpoint={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};break}remaining-=distance}
  if(label)g.appendChild(element(doc,'mxPoint',{x:e.labelX-midpoint.x,y:e.labelY-midpoint.y,as:'offset'}));if(points.length>2){const array=element(doc,'Array',{as:'points'});for(const p of points.slice(1,-1))array.appendChild(element(doc,'mxPoint',{x:p.x,y:p.y}));g.appendChild(array)}
 }
 // Native groups must occupy the same sibling slot as their first member.
 // Root storage order is independent of the already fixed parent coordinates.
 const order=new Map(orderedNodes(d).map((n,i)=>[n.id,i])),paint=[...children(root)].filter(o=>o.getAttribute('fmType')==='node'||o.getAttribute('fmType')==='annotation'||o.getAttribute('fmRole')==='legacy-object-group')
 const rank=(o:Element)=>o.getAttribute('fmRole')==='legacy-object-group'?Math.min(...d.presentation.objects!.groups![o.getAttribute('fmLegacyGroupId')!].map(member=>order.get(member)!)):order.get(o.getAttribute('fmId')!)!
 paint.sort((a,b)=>rank(a)-rank(b)||(a.getAttribute('fmRole')==='legacy-object-group'?-1:1));for(const o of paint)root.appendChild(o)
 return serialize(doc)
}

export async function previewLegacySwimlane(input:unknown,options:LegacyMigrationOptions={}):Promise<LegacyMigrationPreview>{
 // Reject non-JSON/cycles before cloning. No user-owned object is normalized in place.
 const canonical=canonicalContentJson(input as DiagramContent),raw=JSON.parse(canonical) as Json,diagnostics:LegacyMigrationDiagnostic[]=[],counts={nodes:0,edges:0,lanes:0,phases:0,groups:0,nativeCells:0,mapped:0,unmapped:0}
 const result:LegacyMigrationPreview={status:'blocked',sourceHash:await hash({source:raw,sourceCreatedAt:options.sourceCreatedAt}),converterVersion:LEGACY_SWIMLANE_CONVERTER_VERSION,counts,diagnostics}
 const block=(code:string,path:string,message:string,businessId?:string)=>diagnostic(diagnostics,'blocking',code,path,message,businessId)
 if(!plain(raw)||raw.schemaVersion!==2||!plain(raw.content)||!plain(raw.rendering)){block('INVALID_LEGACY_PROJECT','$','需要v2 content/rendering项目');return result}
 const createdAt=raw.createdAt??options.sourceCreatedAt,updatedAt=raw.updatedAt
 if(!validTime(createdAt)||!validTime(updatedAt)||updatedAt<createdAt!){block('INVALID_SOURCE_TIME','createdAt/updatedAt','需要明确有效源时间，禁止迁移时生成时间');return result}
 if(typeof raw.content.id!=='string'||!raw.content.id){block('MISSING_SOURCE_ID','content.id','来源ID缺失，不自动生成身份');return result}
 let d:DiagramDocument
 try{d=validateDocument({...copy(raw),createdAt})}catch(error){block('INVALID_LEGACY_DOCUMENT','$',String(error));return result}
 const content=extractContent(d);result.sourceHash=await hash({source:raw,normalizedContent:content,sourceTimes:{createdAt,updatedAt}});result.contentHash=await contentHash(content)
 const keys=(value:unknown,allowed:string[],path:string)=>{if(plain(value))for(const key of Object.keys(value))if(!allowed.includes(key))block('UNMAPPED_FIELD',`${path}.${key}`,'未知源字段不可静默丢弃')}
 keys(raw,['schemaVersion','content','rendering','createdAt','updatedAt'],'$');keys(raw.content,['schemaVersion','id','title','kind','nodes','edges','lanes','phases','groups'],'content')
 for(const node of raw.content.nodes??[])keys(node,['id','label','kind','laneId','phaseId','groupId','parentId','color','description','items','badge'],`content.nodes.${node.id}`)
 for(const edge of raw.content.edges??[])keys(edge,['id','source','target','label','kind'],`content.edges.${edge.id}`)
 for(const section of ['lanes','phases'])for(const item of raw.content[section]??[])keys(item,['id','label'],`content.${section}.${item.id}`)
 for(const group of raw.content.groups??[])keys(group,['id','label','kind','color'],`content.groups.${group.id}`)
 for(const key of ['nodes','edges','lanes','phases','groups'] as const)counts[key]=content[key].length
 if(content.kind!=='swimlane')block('UNSUPPORTED_DIAGRAM_KIND','content.kind','其他图形类型等待D07')
 if(d.presentation.orientation!=='vertical')block('UNSUPPORTED_ORIENTATION','rendering.orientation','横向泳道等待D07')
 if(content.groups.length)block('UNSUPPORTED_BUSINESS_GROUPS','content.groups','业务分层等待D07')
 for(const node of content.nodes){if(!['task','decision','start','end','note'].includes(node.kind))block('UNSUPPORTED_NODE_KIND',`content.nodes.${node.id}.kind`,'复杂节点视觉等待D07',node.id);if(node.kind==='note'&&node.description)block('UNSUPPORTED_COMPOSITE_NOTE',`content.nodes.${node.id}.description`,'旧说明把description绘成正文，当前投影不能无损区分显示部分，保留原文并阻断',node.id)}
 const allowedRendering=['theme','orientation','positions','ranks','phases','texts','groups','cards','styles','edges','objects','nodeDefaults','edgeDefaults'];for(const key of Object.keys(raw.rendering))if(!allowedRendering.includes(key))block('UNMAPPED_RENDERING_FIELD',`rendering.${key}`,'未知旧渲染字段不可静默丢弃')
 const renderingFields:Record<string,string[]>={positions:['x','y','width','height'],phases:['size'],texts:['width','fontSize','color'],groups:['tone','columns'],cards:['icon','tone','variant'],styles:['fill','stroke','textColor','fontSize','shape'],edges:['color','width','sourcePort','targetPort','points','labelPosition','labelColor','labelFontSize','arrow','dashed','route'],nodeDefaults:['width','height','fontSize','shape','fill','stroke','textColor']}
 for(const [section,allowed]of Object.entries(renderingFields))for(const [key,value]of Object.entries(raw.rendering[section]??{}))keys(value,allowed,`rendering.${section}.${key}`)
 for(const [edgeId,value]of Object.entries(raw.rendering.edges??{}) as Array<[string,Json]>){keys(value.labelPosition,['x','y'],`rendering.edges.${edgeId}.labelPosition`);for(const [i,point]of (value.points??[]).entries())keys(point,['x','y'],`rendering.edges.${edgeId}.points.${i}`)}
 keys(raw.rendering.edgeDefaults,['route','color','width','arrow','dashed'],'rendering.edgeDefaults');keys(raw.rendering.objects,['groups','locked','order'],'rendering.objects')
 for(const key of ['theme','orientation'])if(raw.rendering[key]!==undefined&&raw.rendering[key]!==d.presentation[key as 'theme'|'orientation'])block('DEFAULTED_RENDERING_FIELD',`rendering.${key}`,'旧校验会默认替换此配置，需明确处理后迁移')
 if(raw.rendering.objects&&canonicalContentJson(raw.rendering.objects)!==canonicalContentJson(d.presentation.objects as any))block('NORMALIZED_OBJECT_BINDINGS','rendering.objects','旧校验改变了组合/锁/顺序引用，不能静默迁移')
 // The old validator removes stale bindings. Retain them in sourceHash and make
 // that loss explicit instead of treating its sanitized result as the source.
 for(const section of ['positions','ranks','phases','texts','groups','cards','styles','edges'])for(const key of Object.keys(raw.rendering[section]??{}))if(!Object.hasOwn((d.presentation as Json)[section]??{},key))block('STALE_RENDERING_REFERENCE',`rendering.${section}.${key}`,'旧校验会移除此渲染引用，需明确处理后迁移')
 if(Object.keys(d.presentation.cards??{}).length)block('UNSUPPORTED_CARD_RENDERING','rendering.cards','卡片专属视觉等待D07')
 let preferences:RenderingPreferences={theme:d.presentation.theme,orientation:'vertical'}
 try{preferences=validateProfilePreferences({...preferences,...(d.presentation.nodeDefaults?{nodeDefaults:d.presentation.nodeDefaults}:{}),...(d.presentation.edgeDefaults?{edgeDefaults:d.presentation.edgeDefaults}:{})})}catch(error){block('UNMAPPED_DEFAULT_POLICY','rendering.nodeDefaults/edgeDefaults',`旧默认策略无法由当前profile继续表达：${String(error)}`)}
 for(const [groupId,members]of Object.entries(d.presentation.objects?.groups??{})){const nodes=members.map(member=>content.nodes.find(n=>n.id===member)!);if(nodes.some(n=>n.kind==='note')||new Set(nodes.map(n=>JSON.stringify([n.laneId,n.phaseId]))).size!==1)block('CROSS_CONTAINER_GROUP',`rendering.objects.groups.${groupId}`,'跨角色/阶段或含浮动文字的组合暂不能安全映射原生parent',groupId)
  else{const sequence=orderedNodes(d).filter(n=>n.kind!=='note'&&n.laneId===nodes[0].laneId&&n.phaseId===nodes[0].phaseId),indices=members.map(member=>sequence.findIndex(n=>n.id===member));if(Math.max(...indices)-Math.min(...indices)+1!==members.length)block('INTERLEAVED_GROUP_ORDER',`rendering.objects.groups.${groupId}`,'成员与非成员穿插叠放，原生组合不能保持此顺序',groupId)}
 }
 if(diagnostics.some(d=>d.severity==='blocking')){counts.unmapped=diagnostics.filter(d=>d.severity==='blocking').length;return result}
 let scene:DiagramScene
 try{scene=layoutDocument(d)}catch(error){block('LEGACY_SCENE_FAILED','rendering',String(error));counts.unmapped++;return result}
 for(const node of scene.nodes)if(!numbers({x:node.x,y:node.y,width:node.width,height:node.height}))block('UNSAFE_SCENE_GEOMETRY',`scene.nodes.${node.node.id}`,'旧场景尺寸超限',node.node.id)
 for(let i=0;i<scene.nodes.length;i++)for(let j=i+1;j<scene.nodes.length;j++){const a=scene.nodes[i],b=scene.nodes[j];if(a.node.kind==='note'||b.node.kind==='note'||a.node.laneId===b.node.laneId&&a.node.phaseId===b.node.phaseId)continue;if(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y)block('CROSS_CONTAINER_OVERLAP',`scene.nodes.${a.node.id}`,'跨容器业务节点互相覆盖，当前原生parent顺序不能保证原叠放',a.node.id)}
 for(const edge of scene.edges){const points=pathPoints(edge.path);if(points.length<2||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>50000||Math.abs(p.y)>50000))block('UNSUPPORTED_EDGE_PATH',`scene.edges.${edge.edge.id}`,'旧路径不是可原样映射的有限直线/折线；曲线等待D07',edge.edge.id)}
 for(const container of scene.containers)if(!numbers({x:container.x,y:container.y,width:container.width,height:container.height}))block('UNSAFE_SCENE_GEOMETRY',`scene.containers.${container.id}`,'旧容器尺寸超限',container.id)
 if(scene.nodes.length!==content.nodes.length||scene.edges.length!==content.edges.length)block('SCENE_OBJECT_MISMATCH','scene','旧布局未呈现全部业务对象，不可静默遗漏')
 if(diagnostics.some(d=>d.severity==='blocking')){counts.unmapped=diagnostics.filter(d=>d.severity==='blocking').length;return result}
 diagnostic(diagnostics,'warning','FIXED_FONT_SUBSTITUTION','rendering.font','旧浏览器字体栈统一替换为固定Noto Sans CJK SC；保持字号/几何，不承诺旧字形逐像素相同')
 try{
  const xml=nativeSnapshot(d,scene),engine={name:'drawio' as const,version:DRAWIO_VERSION,adapterVersion:DRAWIO_ADAPTER_VERSION,xml,contentHash:result.contentHash!}
  result.project=await createDrawingProject(content,engine,{createdAt,updatedAt,preferences});counts.nativeCells=parseNative(xml).cells.size;counts.mapped=counts.nodes+counts.edges+counts.lanes+counts.phases+Object.keys(d.presentation.objects?.groups??{}).length
  result.geometryDigest=await hash({nodes:scene.nodes.map(n=>({id:n.node.id,x:n.x,y:n.y,width:n.width,height:n.height,color:n.color,fill:n.fill,textColor:n.textColor})),edges:scene.edges.map(e=>({id:e.edge.id,path:e.path,points:e.points,labelX:e.labelX,labelY:e.labelY,labelBox:e.labelBox})),containers:scene.containers});result.status='ready'
 }catch(error){delete result.project;block('NATIVE_MAPPING_FAILED','engine.xml',String(error));counts.unmapped++}
 return result
}

export async function convertLegacySwimlane(input:unknown,options:LegacyMigrationConvertOptions):Promise<LegacyMigrationPreview>{
 if(!options||typeof options.expectedSourceHash!=='string'||!/^[a-f0-9]{64}$/.test(options.expectedSourceHash))throw new Error('EXPECTED_SOURCE_HASH_REQUIRED')
 const preview=await previewLegacySwimlane(input,{sourceCreatedAt:options.sourceCreatedAt});if(preview.sourceHash!==options.expectedSourceHash)throw new Error('LEGACY_SOURCE_CHANGED');return preview
}
