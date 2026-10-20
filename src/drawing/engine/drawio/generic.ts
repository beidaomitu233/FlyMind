/// <reference path="../elk-worker.d.ts" />
import type{NativeLayoutHints}from'./layout-hints'
import type {DiagramContent,DiagramNode,Box} from '../../core/model'
import {palette} from '../../core/model'
import {standardNodePresets} from '../../core/render-config'
import type {DrawioCompileOptions,DrawioEngineDocument} from '../types'
import {defaultProfileForKind} from '../profiles'
import {DRAWIO_VERSION,DRAWIO_ADAPTER_VERSION} from '../constants'
import {contentHash} from '../content-hash'
import {newDocument,element,parseNative,serialize,fail,attr} from './xml'
import {appendObject,bindingId,mainEntry,mainEntries,businessType} from './state'
import {FONT,fontStyle,nodeMetadata,styleShape,dimensions,textUnits} from './template'
import {needsControlledNode,controlledNodeMetrics,writeControlledNode,writeControlledEdge} from './controlled'
import {routeNativeEdges,assertNativeLayout} from './routing'
import type {ElkNode} from 'elkjs/lib/elk-api'
import {alignRankedLayout,compactLayoutCost} from './layout-policy'

interface Placed {node:DiagramNode;box:Box;parent?:string}
interface Region {id:string;box:Box}
/** First-layout only. Incremental patches never call this ELK adapter. */
async function elkLayout(graph:ElkNode){
 const {default:ELK}=await import('elkjs/lib/elk-api.js'),module=await import('elkjs/lib/elk-worker.min.js'),Worker=module.Worker??module.default.Worker,worker=new Worker()
 // 0.9.3's documented synchronous Worker has no terminate(), while the public
 // ELK terminateWorker() calls it unconditionally. Own this inline worker via
 // workerFactory and dispose its sole callback; no OS worker/thread is started.
 worker.terminate=()=>{worker.onmessage=null};const elk=new ELK({workerFactory:()=>worker as unknown as Worker})
 try{return await elk.layout(graph)}catch{fail('ELK_LAYOUT_FAILED','固定ELK首次布局失败，未改用旧自研layout')}finally{elk.terminateWorker()}
}
export function genericNodeSize(node:DiagramNode,options:DrawioCompileOptions,contentKind?:DiagramContent['kind']){
 const defaults=standardNodePresets[node.kind],preset=options.preferences?.nodeDefaults?.[node.kind],seed={width:defaults.width,height:defaults.height,fontSize:defaults.fontSize,shape:defaults.shape,...(node.kind==='note'?{width:320,height:48,fontSize:15}:{}),...preset},size=dimensions(node,{preferences:{...options.preferences,nodeDefaults:{...options.preferences?.nodeDefaults,[node.kind]:seed}}})
 if(needsControlledNode(node))size.height=controlledNodeMetrics(node,size.width,size.font,size.shape,size.height,contentKind==='flowchart'&&node.kind!=='note').height
 if(size.height>50000)fail('GEOMETRY_LIMIT','可见字段超出固定高度预算')
 return size
}
const boxOf=(node:ElkNode):Box=>{const box={x:node.x??0,y:node.y??0,width:node.width??0,height:node.height??0};if(Object.values(box).some(x=>!Number.isFinite(x)||Math.abs(x)>50000)||box.width<=0||box.height<=0)fail('ELK_GEOMETRY_LIMIT','ELK输出超出固定几何预算');return box}

export async function compileGeneric(content:DiagramContent,options:DrawioCompileOptions,hints:NativeLayoutHints={}):Promise<DrawioEngineDocument>{
 if(!['flowchart','architecture','mindmap','dataflow'].includes(content.kind))fail('UNSUPPORTED_DIAGRAM_KIND','当前模板批次未实现此类型')
 if(content.lanes.length||content.phases.length||content.kind!=='architecture'&&content.groups.length)fail('UNSUPPORTED_CONTAINER_KIND','此模板不接受泳道/阶段或额外业务分层')
 const preferences=options.preferences??{},profile=options.profile??defaultProfileForKind(content.kind),p=palette[preferences.theme??'indigo'],nodes=content.nodes.filter(n=>n.kind!=='note'),sizes=new Map(content.nodes.map(n=>[n.id,hints.nodes?.[n.id]?{...hints.nodes[n.id]}:genericNodeSize(n,options,content.kind)])),placed:Placed[]=[],regions:Region[]=[]
 let orientation=preferences.orientation??'vertical'
 if(content.kind!=='architecture'){
  const layout=async(direction:'vertical'|'horizontal')=>alignRankedLayout(await elkLayout({id:'root',layoutOptions:{'elk.algorithm':'layered','elk.direction':direction==='horizontal'?'RIGHT':'DOWN','elk.spacing.nodeNode':content.kind==='dataflow'?'112':content.kind==='mindmap'?'32':'72','elk.layered.spacing.nodeNodeBetweenLayers':String(Math.max(content.kind==='dataflow'?160:96,direction==='horizontal'?Math.max(0,...content.edges.map(e=>Math.min(180,Math.ceil(textUnits(e.label??'')*13)+8)))+40:0)),'elk.layered.nodePlacement.bk.fixedAlignment':'BALANCED',...(content.kind==='mindmap'?{'elk.layered.considerModelOrder.strategy':'NODES_AND_EDGES','elk.layered.crossingMinimization.forceNodeModelOrder':'true','elk.layered.crossingMinimization.strategy':'LAYER_SWEEP','elk.layered.nodePlacement.strategy':'BRANDES_KOEPF'}:{}),'elk.padding':'[top=0,left=0,bottom=0,right=0]'},children:nodes.map(n=>({id:bindingId('node',n.id),width:sizes.get(n.id)!.width,height:sizes.get(n.id)!.height})),edges:(content.kind==='mindmap'?nodes.filter(n=>n.parentId).map(n=>({id:'parent-'+n.id,source:n.parentId!,target:n.id})):content.edges).filter(e=>(!('kind' in e)||e.kind!=='feedback')&&e.source!==e.target&&nodes.some(n=>n.id===e.source)&&nodes.some(n=>n.id===e.target)).map(e=>({id:bindingId('edge',e.id),sources:[bindingId('node',e.source)],targets:[bindingId('node',e.target)]}))}),content,direction==='horizontal')
  let graph=await layout(orientation)
  if(content.kind==='mindmap'&&preferences.orientation===undefined){const other=await layout('horizontal');if(compactLayoutCost(other)<compactLayoutCost(graph)){graph=other;orientation='horizontal'}}
  for(const node of nodes){const b=boxOf(graph.children!.find(e=>e.id===bindingId('node',node.id))!);placed.push({node,box:{...b,x:b.x+64,y:b.y+128}})}
 }else{
  let y=128,maxWidth=0;const regular=content.groups.filter(g=>g.kind!=='governance'),governance=content.groups.filter(g=>g.kind==='governance'),largest=Math.max(1,...regular.map(g=>nodes.filter(n=>n.groupId===g.id).length)),columns=Math.min(6,Math.max(4,Math.ceil(largest/2))),cardWidth=Math.max(300,...nodes.filter(n=>regular.some(g=>g.id===n.groupId)).map(n=>sizes.get(n.id)!.width)),bandWidth=48+columns*cardWidth+(columns-1)*24
  // Group order is business layer order. ELK packs each layer's module shapes;
  // the fixed layer stack / governance strip is a business template constraint.
  for(const group of [...regular,...governance]){
   const members=nodes.filter(n=>n.groupId===group.id),isGovernance=group.kind==='governance'
   let layout:ElkNode
   if(isGovernance)layout=await elkLayout({id:bindingId('layer',group.id),layoutOptions:{'elk.algorithm':'layered','elk.direction':'DOWN','elk.spacing.nodeNode':'24','elk.padding':'[top=72,left=24,bottom=24,right=24]'},children:members.map(n=>({id:bindingId('node',n.id),width:sizes.get(n.id)!.width,height:sizes.get(n.id)!.height})),edges:members.slice(1).map((n,i)=>({id:'order-'+i,sources:[bindingId('node',members[i].id)],targets:[bindingId('node',n.id)]}))})
   else{layout={id:bindingId('layer',group.id),children:[],width:48,height:96};let rowY=72;for(let start=0;start<members.length;start+=(hints.groupColumns?.[group.id]??columns)){const row=await elkLayout({id:'row-'+start,layoutOptions:{'elk.algorithm':'box','elk.aspectRatio':'1000','elk.box.packingMode':'SIMPLE','elk.spacing.nodeNode':'24','elk.padding':'[top=0,left=0,bottom=0,right=0]'},children:members.slice(start,start+(hints.groupColumns?.[group.id]??columns)).map(n=>({id:bindingId('node',n.id),width:cardWidth,height:sizes.get(n.id)!.height}))});for(const child of row.children??[])layout.children!.push({...child,x:(child.x??0)+24,y:(child.y??0)+rowY});rowY+=(row.height??0)+24;layout.width=Math.max(layout.width!,48+(row.width??0))}layout.height=Math.max(120,rowY)}
   const bounds=layout.children?.length?boxOf({...layout,x:0,y:0}):{x:0,y:0,width:360,height:120},x=isGovernance?maxWidth+112:64,top=isGovernance?128:y
   regions.push({id:group.id,box:{x,y:top,width:bounds.width,height:bounds.height}});for(const node of members){const b=boxOf(layout.children!.find(e=>e.id===bindingId('node',node.id))!),saved=hints.nodes?.[node.id];placed.push({node,parent:group.id,box:saved?{...b,x:b.x+(b.width-saved.width)/2,width:saved.width}:b})}
   if(!isGovernance){maxWidth=Math.max(maxWidth,bounds.width);y+=bounds.height+40}else maxWidth+=bounds.width+48
  }
  const band=Math.max(360,...regions.filter(r=>regular.some(g=>g.id===r.id)).map(r=>r.box.width));for(const r of regions)if(regular.some(g=>g.id===r.id))r.box.width=band
  if(preferences.orientation==='horizontal'){let x=64;for(const group of regular){const region=regions.find(r=>r.id===group.id)!;region.box.x=x;region.box.y=128;x+=region.box.width+48}let gx=64;const bottom=Math.max(128,...regions.filter(r=>regular.some(g=>g.id===r.id)).map(r=>r.box.y+r.box.height))+48;for(const group of governance){const region=regions.find(r=>r.id===group.id)!;region.box.x=gx;region.box.y=bottom;gx+=region.box.width+48}}
 }
 const document=newDocument(),file=document.documentElement;file.setAttribute('host','FlyMind');file.setAttribute('version',DRAWIO_VERSION);file.setAttribute('compressed','false');const diagram=element(document,'diagram',{id:bindingId('page',content.id),name:content.title}),model=element(document,'mxGraphModel',{page:0,grid:1,gridSize:10,guides:1,background:'#ffffff',math:0,shadow:0}),root=element(document,'root');file.appendChild(diagram);diagram.appendChild(model);model.appendChild(root);root.appendChild(element(document,'mxCell',{id:'0'}));root.appendChild(element(document,'mxCell',{id:'1',parent:'0'}));const native=parseNative(serialize(document)),right=Math.max(800,...placed.filter(x=>!x.parent).map(x=>x.box.x+x.box.width),...regions.map(r=>r.box.x+r.box.width))
 appendObject(native,bindingId('title',content.id),content.title,{fmType:'decoration',fmRole:'title',fmId:content.id,fmDocumentId:content.id,fmKind:content.kind,fmOrientation:orientation,fmAutoOrientation:content.kind==='mindmap'&&preferences.orientation===undefined?'1':undefined,fmProfile:profile.id,fmProfileVersion:profile.version},{vertex:1,parent:'1',style:`text;${fontStyle(25)}fontStyle=1;fontColor=${p.dark};align=left;verticalAlign=middle;spacing=0;`},{x:64,y:24,width:right-64,height:64})
 for(const [index,group]of content.groups.entries()){const region=regions.find(r=>r.id===group.id)!;appendObject(native,bindingId('layer',group.id),group.label,{fmType:'layer',fmRole:'main',fmId:group.id,fmKind:group.kind,fmColor:group.color,fmIndex:String(index)},{vertex:1,parent:'1',style:`swimlane;horizontal=1;startSize=48;container=1;collapsible=0;recursiveResize=0;expand=0;fillColor=${group.color??p.dark};swimlaneFillColor=${p.soft};strokeColor=${p.brand};${fontStyle(19)}fontStyle=1;fontColor=#ffffff;align=left;spacingLeft=20;`},region.box)}
 for(const item of placed){const {node,box,parent}=item,size=sizes.get(node.id)!,preset=preferences.nodeDefaults?.[node.kind];appendObject(native,bindingId('node',node.id),node.label,{...Object.fromEntries(Object.entries(nodeMetadata(node)).map(([k,v])=>[k,v===undefined?undefined:String(v)])),fmIndex:String(content.nodes.findIndex(n=>n.id===node.id))},{vertex:1,parent:parent?bindingId('layer',parent):'1',style:`${styleShape(size.shape)}${fontStyle(size.font)}fillColor=${preset?.fill??node.color??(node.kind==='decision'?p.accentSoft:p.soft)};strokeColor=${preset?.stroke??p.brand};fontColor=${preset?.textColor??p.dark};strokeWidth=1.5;arcSize=12;spacing=10;`},box)}
 let noteY=128;for(const node of content.nodes.filter(n=>n.kind==='note')){const size=sizes.get(node.id)!,entry=appendObject(native,bindingId('node',node.id),node.label,{...Object.fromEntries(Object.entries(nodeMetadata(node)).map(([k,v])=>[k,v===undefined?undefined:String(v)])),fmIndex:String(content.nodes.findIndex(n=>n.id===node.id))},{vertex:1,parent:'1',style:`text;${fontStyle(size.font)}fillColor=none;strokeColor=none;fontColor=${preferences.nodeDefaults?.note?.textColor??node.color??p.dark};align=left;verticalAlign=middle;spacing=0;`},{x:right+48,y:noteY,width:Math.max(240,size.width),height:size.height});noteY+=size.height+24;writeControlledNode(native,entry,node)}
 for(const node of nodes)writeControlledNode(native,mainEntry(native,'node',node.id),node)
 for(const [index,edge]of content.edges.entries()){const defaults=preferences.edgeDefaults,arrow=defaults?.arrow??'end';appendObject(native,bindingId('edge',edge.id),edge.label??'',{fmType:'edge',fmRole:'main',fmId:edge.id,fmKind:edge.kind,fmIndex:String(index),fmLabelPresent:edge.label!==undefined?'1':undefined},{edge:1,parent:'1',source:mainEntry(native,'node',edge.source).id,target:mainEntry(native,'node',edge.target).id,style:`edgeStyle=orthogonalEdgeStyle;rounded=0;ignoreEdge=1;jettySize=32;${fontStyle(13)}labelWidth=${Math.max(24,Math.min(180,Math.ceil(textUnits(edge.label??'')*13)+8))};labelBackgroundColor=#ffffff;startArrow=${arrow==='both'?'block':'none'};endArrow=${arrow==='none'?'none':'block'};strokeColor=${defaults?.color??(edge.kind==='feedback'?'#b77730':p.edge)};strokeWidth=${defaults?.width??1.5};dashed=${(defaults?.dashed??edge.kind==='feedback')?1:0};`})}
 if(content.kind==='mindmap')for(const node of nodes.filter(n=>n.parentId))appendObject(native,bindingId('parent-edge',node.id),'',{fmType:'decoration',fmRole:'parent-edge',fmChildId:node.id},{edge:1,parent:'1',source:mainEntry(native,'node',node.parentId!).id,target:mainEntry(native,'node',node.id).id,style:`edgeStyle=orthogonalEdgeStyle;rounded=0;endArrow=none;strokeColor=${p.edge};strokeWidth=1.5;ignoreEdge=0;`})
 await routeNativeEdges(native,[...mainEntries(native).filter(e=>businessType(e)==='edge'),...[...native.cells.values()].filter(e=>attr(e.object,'fmRole')==='parent-edge')])
 for(const edge of content.edges)if(edge.label!==undefined)writeControlledEdge(native,mainEntry(native,'edge',edge.id),edge.label)
 assertNativeLayout(native,content.kind==='mindmap')
 return {name:'drawio',version:DRAWIO_VERSION,adapterVersion:DRAWIO_ADAPTER_VERSION,xml:serialize(native.document),contentHash:await contentHash(content)}
}
