import {validateDocument,copy,palette,cardStyle,type DiagramContent,type DiagramDocument,type DiagramScene,type Box} from '../../core/model'
import {extractContent} from '../../core/layers'
import {layoutDocument} from '../../core/layout'
import {orderedNodes} from '../../core/objects'
import {nodePreset,edgePreset} from '../../core/render-config'
import {textAppearance} from '../../core/floating-text'
import {cardMetrics} from '../../core/dataflow'
import {wrapText} from '../../core/text'
import {edgeLabelBox} from '../../core/routing'
import {canonicalContentJson,contentHash} from '../content-hash'
import {createDrawingProject} from '../project'
import {validateProfilePreferences} from '../preferences'
import {defaultProfileForKind} from '../profiles'
import {DRAWIO_VERSION,DRAWIO_ADAPTER_VERSION} from '../constants'
import {RUNTIME_FONT_FAMILY} from '../runtime-assets'
import {newDocument,element,children,serialize,parseNative} from '../drawio/xml'
import {nodeMetadata,styleShape} from '../drawio/template'
import type {LegacyMigrationPreview,LegacyMigrationOptions,LegacyMigrationConvertOptions,LegacyMigrationDiagnostic} from './types'

type Json=Record<string,any>
type Point={x:number;y:number}
interface Route {points:Point[];bezier:boolean}
const id=(type:string,key:string)=>`fm:${type}:${encodeURIComponent(key)}`
const hash=async(value:unknown)=>{const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalContentJson(value as DiagramContent)));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}
const plain=(v:unknown):v is Json=>!!v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))
const validTime=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0&&v<=8_640_000_000_000_000
const validBox=(b:Box)=>Object.values(b).every(n=>Number.isFinite(n)&&Math.abs(n)<=50000)&&b.width>0&&b.height>0
const font=(size:number)=>`fontFamily=${RUNTIME_FONT_FAMILY};fontSize=${size};html=0;whiteSpace=wrap;`

/** The legacy scene uses absolute M/L/H/V or a single cubic C. Do not pass C
 * through pathPoints(): that historical utility intentionally loses controls. */
export function legacyNativeRoute(path:string):Route {
 const tokens=path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)??[]
 if(tokens.join('')!==path.replace(/[\s,]/g,''))throw new Error('UNSUPPORTED_EDGE_PATH')
 const points:Point[]=[];let i=0,command='',bezier=false
 const number=()=>{const token=tokens[i++],n=Number(token);if(token===undefined||!Number.isFinite(n)||Math.abs(n)>50000)throw new Error('UNSUPPORTED_EDGE_PATH');return n}
 while(i<tokens.length){if(/^[a-zA-Z]$/.test(tokens[i]))command=tokens[i++];if(!['M','L','H','V','C'].includes(command))throw new Error('UNSUPPORTED_EDGE_PATH')
  if(command==='M'||command==='L'){if(bezier||command==='M'&&points.length)throw new Error('UNSUPPORTED_EDGE_PATH');points.push({x:number(),y:number()});if(command==='M')command='L'}
  else if(command==='H'||command==='V'){if(!points.length||bezier)throw new Error('UNSUPPORTED_EDGE_PATH');const p={...points.at(-1)!};p[command==='H'?'x':'y']=number();points.push(p)}
  else {if(points.length!==1||bezier)throw new Error('UNSUPPORTED_EDGE_PATH');for(let p=0;p<3;p++)points.push({x:number(),y:number()});bezier=true}
 }
 if(points.length<2)throw new Error('UNSUPPORTED_EDGE_PATH');return {points,bezier}
}
function midpoint(route:Route):Point {
 const p=route.points;if(route.bezier)return {x:(p[0].x+3*p[1].x+3*p[2].x+p[3].x)/8,y:(p[0].y+3*p[1].y+3*p[2].y+p[3].y)/8}
 let remain=p.slice(1).reduce((sum,b,i)=>sum+Math.hypot(b.x-p[i].x,b.y-p[i].y),0)/2
 for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i],length=Math.hypot(b.x-a.x,b.y-a.y);if(remain<=length){const t=length?remain/length:0;return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}}remain-=length}return p[0]
}
function iconSVG(icon:string,color:string){
 const paths:Record<string,string>={database:'<ellipse cx="18" cy="7" rx="13" ry="5"/><path d="M5 7v22c0 7 26 7 26 0V7 M5 15c0 7 26 7 26 0 M5 23c0 7 26 7 26 0"/>',network:'<path d="M7 7l22-2-10 13 12 12-25-1 13-11z M7 7l24 23 M6 29L29 5"/><circle cx="7" cy="7" r="3" fill="white"/><circle cx="29" cy="5" r="3" fill="white"/><circle cx="19" cy="18" r="3" fill="white"/><circle cx="31" cy="30" r="3" fill="white"/><circle cx="6" cy="29" r="3" fill="white"/>',check:'<circle cx="18" cy="18" r="15"/><path d="M10 18l6 6 11-13"/>'}
 return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><g fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[icon]??''}</g></svg>`
}

/** Materialize explicit historical boxes. No ELK, compileGeneric, or controlled
 * node writer: all three would reinterpret/reflow the stored visual document. */
function nativeSnapshot(d:DiagramDocument,scene:DiagramScene){
 const doc=newDocument(),file=doc.documentElement,profile=defaultProfileForKind(d.kind);file.setAttribute('host','FlyMind');file.setAttribute('version',DRAWIO_VERSION);file.setAttribute('compressed','false')
 const diagram=element(doc,'diagram',{id:id('page',d.id),name:d.title}),model=element(doc,'mxGraphModel',{page:0,grid:1,gridSize:10,guides:1,background:'#ffffff',math:0,shadow:0}),root=element(doc,'root');file.appendChild(diagram);diagram.appendChild(model);model.appendChild(root);root.appendChild(element(doc,'mxCell',{id:'0'}));root.appendChild(element(doc,'mxCell',{id:'1',parent:'0'}))
 const object=(cellId:string,label:string,metadata:Record<string,string|number|undefined>,style:string,box:Box,parent='1',edge?:{source:string;target:string})=>{const o=element(doc,'UserObject',{id:cellId,label,fmAdapter:DRAWIO_ADAPTER_VERSION,...metadata}),c=element(doc,'mxCell',{parent,style,...(edge?{edge:1,...edge}:{vertex:1})});o.appendChild(c);root.appendChild(o);c.appendChild(element(doc,'mxGeometry',edge?{relative:1,as:'geometry'}:{x:box.x,y:box.y,width:box.width,height:box.height,as:'geometry'}));return {id:cellId,object:o,cell:c}}
 const p=palette[d.presentation.theme],origins=new Map<string,Point>([['1',{x:0,y:0}]]),title=scene.containers.find(c=>c.kind==='title')
 // Old non-architecture scenes have no visible document title. Put the required
 // editable identity outside their extents; never shift existing content.
 const titleBox=title??{x:40,y:Math.max(scene.height,...scene.nodes.map(n=>n.y+n.height))+24,width:Math.max(400,scene.width-80),height:48}
 object(id('title',d.id),d.title,{fmType:'decoration',fmRole:'title',fmId:d.id,fmDocumentId:d.id,fmKind:d.kind,fmProfile:profile.id,fmProfileVersion:profile.version},`${title?'rounded=1;fillColor='+p.dark+';gradientColor='+p.brand+';gradientDirection=east;':'text;fillColor=none;'}strokeColor=none;${font(title?31:25)}fontStyle=1;fontColor=${title?'#ffffff':p.dark};align=center;verticalAlign=middle;spacing=0;`,titleBox)
 for(const [index,group]of d.groups.entries()){
  const box=scene.containers.find(c=>c.id===group.id)!,governance=group.kind==='governance',color=group.color??(box.tone==='green'?p.accent:box.tone==='amber'?'#d9933f':p.dark),cellId=id('layer',group.id)
  object(cellId,group.label,{fmType:'layer',fmRole:'main',fmId:group.id,fmKind:group.kind,fmColor:group.color,fmIndex:index},`rounded=1;container=1;collapsible=0;recursiveResize=0;expand=0;${font(governance?13:20)}fontStyle=1;fillColor=${governance?'#eef1fa':color};strokeColor=${governance?'#bbc5e0':'none'};fontColor=${governance?'#465473':'#ffffff'};align=center;verticalAlign=${governance?'top':'middle'};spacing=0;${governance?'spacingTop=16;':''}`,box);origins.set(cellId,{x:box.x,y:box.y})
 }
 const parents=new Map<string,string>();for(const node of d.nodes)parents.set(node.id,node.kind!=='note'&&d.kind==='architecture'?id('layer',node.groupId!):'1')
 for(const [groupId,members]of Object.entries(d.presentation.objects?.groups??{})){
  const boxes=members.map(member=>scene.nodes.find(n=>n.node.id===member)!),parent=parents.get(members[0])!,origin=origins.get(parent)!,x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y)),width=Math.max(...boxes.map(b=>b.x+b.width))-x,height=Math.max(...boxes.map(b=>b.y+b.height))-y,cellId=id('object-group',groupId)
  object(cellId,'',{fmType:'decoration',fmRole:'legacy-object-group',fmLegacyGroupId:groupId},'group;container=1;recursiveResize=0;collapsible=0;fillColor=none;strokeColor=none;',{x:x-origin.x,y:y-origin.y,width,height},parent);origins.set(cellId,{x,y});members.forEach(member=>parents.set(member,cellId))
 }
 // Native main-edge labels keep formal binding and an explicit legacy-center
 // offset. Ambiguous label/shape occlusion is blocked by the preview below.

 for(const e of scene.edges){
  const route=legacyNativeRoute(e.path),points=route.points,first=points[0],last=points.at(-1)!,source=scene.nodes.find(n=>n.node.id===e.edge.source)!,target=scene.nodes.find(n=>n.node.id===e.edge.target)!,preset=edgePreset(d),style=d.presentation.edges?.[e.edge.id],arrow=style?.arrow??preset.arrow,implicit=d.kind==='mindmap'&&!d.edges.some(edge=>edge.id===e.edge.id),size=style?.labelFontSize??(d.kind==='dataflow'?22:13),label=e.edge.label??'',metrics=e.labelBox??{x:e.labelX-edgeLabelBox(label,size).width/2,y:e.labelY-edgeLabelBox(label,size).height/2,...edgeLabelBox(label,size)},m=midpoint(route)
  const entry=object(id(implicit?'parent-edge':'edge',e.edge.id),label,implicit?{fmType:'decoration',fmRole:'parent-edge',fmChildId:e.edge.target}:{fmType:'edge',fmRole:'main',fmId:e.edge.id,fmIndex:d.edges.findIndex(edge=>edge.id===e.edge.id),fmKind:e.edge.kind,fmLabelPresent:e.edge.label!==undefined?'1':undefined},`noEdgeStyle=1;ignoreEdge=${implicit?0:1};rounded=0;curved=0;bezier=${route.bezier?1:0};exitX=${(first.x-source.x)/source.width};exitY=${(first.y-source.y)/source.height};exitPerimeter=0;entryX=${(last.x-target.x)/target.width};entryY=${(last.y-target.y)/target.height};entryPerimeter=0;${font(size)}labelWidth=${metrics.width};labelBackgroundColor=#ffffff;fontColor=${style?.labelColor??e.color};strokeColor=${e.color};strokeWidth=${style?.width??preset.width};startArrow=${arrow==='both'?'block':'none'};endArrow=${arrow==='none'?'none':'block'};dashed=${(style?.dashed??preset.dashed)?1:0};spacing=0;align=center;verticalAlign=middle;`,{x:0,y:0,width:1,height:1},'1',{source:id('node',e.edge.source),target:id('node',e.edge.target)}),g=children(entry.cell,'mxGeometry')[0]
  if(label)g.appendChild(element(doc,'mxPoint',{x:e.labelX-m.x,y:e.labelY-m.y,as:'offset'}))
  if(points.length>2){const array=element(doc,'Array',{as:'points'});for(const point of points.slice(1,-1))array.appendChild(element(doc,'mxPoint',point));g.appendChild(array)}
 }
 const paintNodes=(notes:boolean)=>{for(const node of orderedNodes(d).filter(n=>(n.kind==='note')===notes)){
  const box=scene.nodes.find(n=>n.node.id===node.id)!,parent=parents.get(node.id)!,origin=origins.get(parent)!,preset=nodePreset(d,node.kind),style=d.presentation.styles?.[node.id],note=node.kind==='note',size=note?textAppearance(d,node).fontSize:style?.fontSize??preset.fontSize,shape=style?.shape??preset.shape,rich=node.description!==undefined||node.items!==undefined||node.badge!==undefined||node.kind==='module'||d.kind==='dataflow'&&!note,metadata=nodeMetadata(node),locked=d.presentation.objects?.locked?.includes(node.id),border=d.kind==='dataflow'&&!note?(style?.stroke??d.presentation.nodeDefaults?.[node.kind]?.stroke??'#ccdee7'):node.badge==='3期'?'#df913d':box.color
  if(rich){for(const key of ['fmDescription','fmItems','fmBadge'])delete metadata[key];Object.assign(metadata,{fmControlled:'1',fmFields:JSON.stringify({title:true,...(node.description!==undefined?{body:true}:{}),...(node.items!==undefined?{items:node.items.length}:{}),...(node.badge!==undefined?{badge:true}:{})})})}
  const owner=object(id('node',node.id),rich?'':node.label,{...metadata,fmIndex:d.nodes.findIndex(n=>n.id===node.id)},`${note?'text;':styleShape(shape)}${font(size)}fillColor=${note?'none':node.badge==='3期'?'#fff8ec':box.fill};strokeColor=${note?'none':border};fontColor=${note?textAppearance(d,node).color:box.textColor};strokeWidth=1.5;absoluteArcSize=1;arcSize=${d.kind==='dataflow'?28:d.kind==='mindmap'?20:12};${node.kind==='topic'&&!node.parentId?'fontStyle=1;':''}spacing=0;align=${note?'left':'center'};verticalAlign=middle;${note?'spacingLeft=6;spacingRight=6;':''}${locked?'locked=1;':''}`,{x:box.x-origin.x,y:box.y-origin.y,width:box.width,height:box.height},parent)
  const part=(role:string,text:string,b:Box,partSize:number,extra='',index?:number)=>object(owner.id+':field:'+role+(index===undefined?'':':'+index),text,{fmType:metadata.fmType,fmId:node.id,fmRole:role,fmItemIndex:index},`text;${font(partSize)}fillColor=none;strokeColor=none;fontColor=${box.textColor};align=center;verticalAlign=middle;spacing=0;connectable=0;${extra}`,b,owner.id)
  if(!rich)continue
  if(note){const line=size*1.45,lines=(text:string)=>wrapText(text,Math.max(1,(box.width-12)/size)).length,titleHeight=lines(node.label)*line,bodyHeight=node.description?lines(node.description)*line:0,top=(box.height-titleHeight-bodyHeight)/2;part('title',node.label,{x:6,y:top,width:box.width-12,height:titleHeight},size,`align=left;fontColor=${textAppearance(d,node).color};`);if(node.description!==undefined)part('body',node.description,{x:6,y:top+titleHeight,width:box.width-12,height:Math.max(1,bodyHeight)},size,`align=left;fontColor=${textAppearance(d,node).color};`)}
  else if(d.kind==='dataflow'){
   const m=cardMetrics(d,node,box.width),top=m.pad+m.iconHeight,align=m.centered?'center':'left';part('title',node.label,{x:m.pad,y:top,width:box.width-m.pad*2,height:m.titleHeight},m.titleSize,`align=${align};fontStyle=1;`);if(node.description!==undefined)part('body',node.description,{x:m.pad,y:top+m.titleHeight+14,width:box.width-m.pad*2,height:Math.max(1,m.bodyHeight)},m.bodySize,`align=${align};fontColor=#657e8d;`)
   if(!m.centered)object(owner.id+':accent','',{fmType:'decoration',fmRole:'legacy-card-accent'},`fillColor=${box.color};strokeColor=none;connectable=0;`,{x:12,y:18,width:4,height:box.height-36},owner.id)
   if(m.iconHeight)object(owner.id+':icon','',{fmType:'decoration',fmRole:'legacy-card-icon'},`shape=image;image=data:image/svg+xml,${encodeURIComponent(iconSVG(cardStyle(d,node.id).icon??'none',box.color))};connectable=0;`,{x:m.pad,y:m.pad,width:36,height:36},owner.id)
  }else if(node.kind==='module'){
   const governance=d.groups.find(group=>group.id===node.groupId)?.kind==='governance',cols=box.width<260?1:2,cellWidth=(box.width-24-8*(cols-1))/cols
   part('title',node.label,governance?{x:0,y:14,width:box.width,height:20}:{x:12,y:22-size*1.45/2,width:box.width-24-(node.badge?36:0),height:size*1.45},governance?13:size,`fontStyle=1;${governance?'':'align=left;'}`)
   node.items?.forEach((text,index)=>part('item',text,governance?{x:0,y:46+index*24,width:box.width,height:20}:{x:12+(index%cols)*(cellWidth+8),y:44+Math.floor(index/cols)*28,width:cellWidth,height:22},governance?10:Math.min(12,cellWidth/(text.length||1)),governance?'':`rounded=1;arcSize=14;fillColor=#ffffff;strokeColor=${border};strokeOpacity=22;align=left;spacingLeft=7;`,index))
   if(node.badge!==undefined)part('badge',node.badge,{x:box.width-46,y:10,width:34,height:20},10,`rounded=1;arcSize=100;fillColor=${border};fontColor=#ffffff;`)
  }else part('title',node.label,{x:0,y:0,width:box.width,height:box.height},size,node.kind==='topic'&&!node.parentId?'fontStyle=1;':'')
 }}
 paintNodes(false);paintNodes(true)
 // Native groups occupy the same sibling slot as their first member, not a
 // global front layer. Child coordinates stay relative to the original box.
 for(const [groupId,members]of Object.entries(d.presentation.objects?.groups??{})){const group=[...children(root)].find(e=>e.getAttribute('id')===id('object-group',groupId))!,first=[...children(root)].find(e=>e.getAttribute('id')===id('node',orderedNodes(d).find(n=>members.includes(n.id))!.id))!;root.insertBefore(group,first)}
 return serialize(doc)
}

export async function previewLegacyGeneric(input:unknown,options:LegacyMigrationOptions={}):Promise<LegacyMigrationPreview>{
 const raw=JSON.parse(canonicalContentJson(input as DiagramContent)) as Json,diagnostics:LegacyMigrationDiagnostic[]=[],counts={nodes:0,edges:0,lanes:0,phases:0,groups:0,nativeCells:0,mapped:0,unmapped:0},result:LegacyMigrationPreview={status:'blocked',sourceHash:await hash({source:raw,sourceCreatedAt:options.sourceCreatedAt}),converterVersion:'1',counts,diagnostics}
 const block=(code:string,path:string,message:string,businessId?:string)=>diagnostics.push({severity:'blocking',code,path,message,...(businessId?{businessId}:{})}),blocked=()=>{counts.unmapped=diagnostics.filter(d=>d.severity==='blocking').length;return counts.unmapped>0}
 if(!plain(raw)||raw.schemaVersion!==2||!plain(raw.content)||!plain(raw.rendering)){block('INVALID_LEGACY_PROJECT','$','需要v2 content/rendering项目');return result}
 const createdAt=raw.createdAt??options.sourceCreatedAt,updatedAt=raw.updatedAt;if(!validTime(createdAt)||!validTime(updatedAt)||updatedAt<createdAt){block('INVALID_SOURCE_TIME','createdAt/updatedAt','需要明确源时间');return result}
 if(!raw.content.id){block('MISSING_SOURCE_ID','content.id','不自动生成身份');return result}
 let d:DiagramDocument;try{d=validateDocument({...copy(raw),createdAt})}catch(error){block('INVALID_LEGACY_DOCUMENT','$',String(error));return result}
 const content=extractContent(d),profile=defaultProfileForKind(content.kind);result.sourceHash=await hash({source:raw,normalizedContent:content,sourceTimes:{createdAt,updatedAt}});result.contentHash=await contentHash(content)
 for(const key of ['nodes','edges','lanes','phases','groups'] as const)counts[key]=content[key].length
 const keys=(value:unknown,allowed:string[],path:string)=>{if(plain(value))for(const key of Object.keys(value))if(!allowed.includes(key))block('UNMAPPED_FIELD',`${path}.${key}`,'未知源字段不可静默丢弃')}
 keys(raw,['schemaVersion','content','rendering','createdAt','updatedAt'],'$');keys(raw.content,['schemaVersion','id','title','kind','nodes','edges','lanes','phases','groups'],'content');keys(raw.rendering,['theme','orientation','positions','ranks','phases','texts','groups','cards','styles','edges','objects','nodeDefaults','edgeDefaults'],'rendering')
 for(const node of raw.content.nodes??[])keys(node,['id','label','kind','laneId','phaseId','groupId','parentId','color','description','items','badge'],`content.nodes.${node.id}`)
 for(const edge of raw.content.edges??[])keys(edge,['id','source','target','label','kind'],`content.edges.${edge.id}`)
 for(const group of raw.content.groups??[])keys(group,['id','label','kind','color'],`content.groups.${group.id}`)
 if(!['flowchart','architecture','mindmap','dataflow'].includes(content.kind))block('UNSUPPORTED_DIAGRAM_KIND','content.kind','此转换器仅处理四类非泳道业务图')
 if(content.lanes.length||content.phases.length||content.kind!=='architecture'&&content.groups.length)block('UNSUPPORTED_BUSINESS_CONTAINER','content','旧场景无法表达此归属')
 const fields:Record<string,string[]>={positions:['x','y','width','height'],phases:['size'],texts:['width','fontSize','color'],groups:['tone','columns'],cards:['icon','tone','variant'],styles:['fill','stroke','textColor','fontSize','shape'],edges:['color','width','sourcePort','targetPort','points','labelPosition','labelColor','labelFontSize','arrow','dashed','route'],nodeDefaults:['width','height','fontSize','shape','fill','stroke','textColor']}
 for(const [section,allowed]of Object.entries(fields))for(const [key,value]of Object.entries(raw.rendering[section]??{}))keys(value,allowed,`rendering.${section}.${key}`)
 for(const [key,value]of Object.entries(raw.rendering.edges??{}) as Array<[string,Json]>){keys(value.labelPosition,['x','y'],`rendering.edges.${key}.labelPosition`);for(const [i,point]of (value.points??[]).entries())keys(point,['x','y'],`rendering.edges.${key}.points.${i}`)}
 keys(raw.rendering.edgeDefaults,['route','color','width','arrow','dashed'],'rendering.edgeDefaults');keys(raw.rendering.objects,['groups','locked','order'],'rendering.objects')
 for(const key of ['theme','orientation'])if(raw.rendering[key]!==undefined&&raw.rendering[key]!==d.presentation[key as 'theme'|'orientation'])block('DEFAULTED_RENDERING_FIELD',`rendering.${key}`,'旧校验改变此配置')
 for(const section of ['positions','ranks','phases','texts','groups','cards','styles','edges'])for(const key of Object.keys(raw.rendering[section]??{}))if(!Object.hasOwn((d.presentation as Json)[section]??{},key))block('STALE_RENDERING_REFERENCE',`rendering.${section}.${key}`,'旧校验移除源引用')
 if(raw.rendering.objects&&canonicalContentJson(raw.rendering.objects)!==canonicalContentJson(d.presentation.objects as any))block('NORMALIZED_OBJECT_BINDINGS','rendering.objects','旧校验改变组合/锁/顺序')
 for(const node of content.nodes){
  if(node.description!==undefined&&node.kind!=='note'&&content.kind!=='dataflow')block('UNRENDERED_SOURCE_FIELD',`content.nodes.${node.id}.description`,'旧场景未显示此正文，不能伪造旧几何',node.id)
  if(node.items!==undefined&&node.kind!=='module'||node.badge!==undefined&&node.kind!=='module')block('UNRENDERED_SOURCE_FIELD',`content.nodes.${node.id}`,'旧场景未呈现这些字段',node.id)
  if(node.kind==='module'&&content.groups.find(g=>g.id===node.groupId)?.kind==='governance'&&node.badge!==undefined)block('UNRENDERED_SOURCE_FIELD',`content.nodes.${node.id}.badge`,'旧治理模块未显示徽标',node.id)
 }
 let preferences;try{preferences=validateProfilePreferences({theme:d.presentation.theme,orientation:d.presentation.orientation,...(d.presentation.nodeDefaults?{nodeDefaults:d.presentation.nodeDefaults}:{}),...(d.presentation.edgeDefaults?{edgeDefaults:d.presentation.edgeDefaults}:{})},profile)}catch(error){block('UNMAPPED_DEFAULT_POLICY','rendering.nodeDefaults/edgeDefaults',String(error))}
 for(const [groupId,members]of Object.entries(d.presentation.objects?.groups??{})){const nodes=members.map(member=>content.nodes.find(n=>n.id===member)!),parent=(n:typeof nodes[number])=>n.kind==='note'?'notes':content.kind==='architecture'?n.groupId:'1';if(new Set(nodes.map(parent)).size!==1)block('CROSS_CONTAINER_GROUP',`rendering.objects.groups.${groupId}`,'组合不能跨原绘制层/业务容器',groupId);const sequence=orderedNodes(d).filter(n=>parent(n)===parent(nodes[0])),indices=members.map(member=>sequence.findIndex(n=>n.id===member));if(Math.max(...indices)-Math.min(...indices)+1!==members.length)block('INTERLEAVED_GROUP_ORDER',`rendering.objects.groups.${groupId}`,'组合成员与非成员穿插叠放',groupId)}
 if(blocked())return result
 let scene:DiagramScene;try{scene=layoutDocument(d)}catch(error){block('LEGACY_SCENE_FAILED','rendering',String(error));blocked();return result}
 for(const node of scene.nodes)if(!validBox({x:node.x,y:node.y,width:node.width,height:node.height}))block('UNSAFE_SCENE_GEOMETRY',`scene.nodes.${node.node.id}`,'旧绝对几何超限',node.node.id)
 if(content.kind==='architecture')for(let i=0;i<scene.nodes.length;i++)for(let j=i+1;j<scene.nodes.length;j++){const a=scene.nodes[i],b=scene.nodes[j];if(a.node.kind!=='note'&&b.node.kind!=='note'&&a.node.groupId!==b.node.groupId&&a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y)block('CROSS_CONTAINER_OVERLAP',`scene.nodes.${a.node.id}`,'跨分层重叠不能保证原绘制顺序',a.node.id)}
 for(const c of scene.containers)if(!validBox({x:c.x,y:c.y,width:c.width,height:c.height}))block('UNSAFE_SCENE_GEOMETRY',`scene.containers.${c.id}`,'旧容器几何超限',c.id)
 for(const edge of scene.edges)try{legacyNativeRoute(edge.path)}catch{block('UNSUPPORTED_EDGE_PATH',`scene.edges.${edge.edge.id}`,'不能精确表示旧路径',edge.edge.id)}
 for(const edge of scene.edges)if(edge.edge.label){const size=d.presentation.edges?.[edge.edge.id]?.labelFontSize??(d.kind==='dataflow'?22:13),metrics=edgeLabelBox(edge.edge.label,size),box=edge.labelBox??{x:edge.labelX-metrics.width/2,y:edge.labelY-metrics.height/2,...metrics};if(scene.nodes.some(n=>n.node.kind!=='note'&&box.x<n.x+n.width&&box.x+box.width>n.x&&box.y<n.y+n.height&&box.y+box.height>n.y))block('LABEL_OCCLUSION_ORDER',`scene.edges.${edge.edge.id}.labelBox`,'旧标签叠在节点前方，原生主边标签不能保证同样遮挡顺序',edge.edge.id)}
 const implicit=content.kind==='mindmap'?content.nodes.filter(n=>n.parentId).length:0;if(scene.nodes.length!==content.nodes.length||scene.edges.length!==content.edges.length+implicit)block('SCENE_OBJECT_MISMATCH','scene','旧场景遗漏或重复业务对象')
 if(blocked())return result
 diagnostics.push({severity:'warning',code:'FIXED_FONT_SUBSTITUTION',path:'rendering.font',message:'旧字体统一为固定Noto Sans CJK SC，保留字号与几何，不承诺旧字形逐像素相同'})
 if(!scene.containers.some(c=>c.kind==='title'))diagnostics.push({severity:'warning',code:'DOCUMENT_TITLE_ADDED_OUTSIDE_SCENE',path:'scene.containers',message:'在旧场景下方新增可编辑文档标题身份，不移动旧业务对象'})
 try{const xml=nativeSnapshot(d,scene);result.project=await createDrawingProject(content,{name:'drawio',version:DRAWIO_VERSION,adapterVersion:DRAWIO_ADAPTER_VERSION,xml,contentHash:result.contentHash!},{profile,preferences,createdAt,updatedAt});counts.nativeCells=parseNative(xml).cells.size;counts.mapped=counts.nodes+counts.edges+counts.groups+implicit+Object.keys(d.presentation.objects?.groups??{}).length;result.geometryDigest=await hash({nodes:scene.nodes.map(n=>({id:n.node.id,x:n.x,y:n.y,width:n.width,height:n.height,color:n.color,fill:n.fill,textColor:n.textColor})),edges:scene.edges.map(e=>({id:e.edge.id,path:e.path,labelX:e.labelX,labelY:e.labelY,labelBox:e.labelBox})),containers:scene.containers});result.status='ready'}catch(error){block('NATIVE_MAPPING_FAILED','engine.xml',String(error));blocked();delete result.project}
 return result
}
export async function convertLegacyGeneric(input:unknown,options:LegacyMigrationConvertOptions):Promise<LegacyMigrationPreview>{if(!options||!/^[a-f0-9]{64}$/.test(options.expectedSourceHash))throw new Error('EXPECTED_SOURCE_HASH_REQUIRED');const preview=await previewLegacyGeneric(input,{sourceCreatedAt:options.sourceCreatedAt});if(preview.sourceHash!==options.expectedSourceHash)throw new Error('LEGACY_SOURCE_CHANGED');return preview}
