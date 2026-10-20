<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,ref,shallowRef,reactive,nextTick} from 'vue'
import {onBeforeRouteLeave,useRoute,useRouter} from 'vue-router'
import DrawioViewport from './DrawioViewport.vue'
import NativeImportDialog from './NativeImportDialog.vue'
import NativeActivityDialog from './NativeActivityDialog.vue'
import {NativeClient} from '../services/native-client'
import {IndexedDbDraftRepository,NativeDraftError,draftKey,recoveryDownload} from '../services/native-drafts'
import {NativeSaveSession,type NativeSessionOptions} from '../state/native-session'
import {NativeApiError,nativeRecordIdentity,type NativeDraft,type NativeMetadata,type NativeRecoveryDownload,type NativeSessionSnapshot,type NativeExportJob,type NativeImportRequest,type NativeImportPreview} from '../services/native-types'
import type {DiagramContent,DiagramKind,NodeKind} from '../core/model'
import type {NativeCanvasCell,NativeBusinessMapping} from '../engine/types'
import {sampleFor,blankDocument} from '../core/samples'
import {extractContent} from '../core/layers'
import {MAX_IMPORT_SOURCE_BYTES,MAX_NATIVE_REQUEST_BYTES} from '../services/native-capabilities'
import './native-studio.css'
import './studio.css'
import './studio-appearance.css'
import {readStudioAppearance,persistStudioAppearance,type StudioAppearance} from '../state/studio-appearance'
import WorkspaceSidebar from './WorkspaceSidebar.vue'
import Icon from './Icon.vue'
import {layoutDocument} from '../core/layout'
import {renderScene} from '../core/render'
import type {DiagramOperation} from '../core/operations'
import type {SidebarAdapter,SidebarTrash} from '../services/sidebar-adapter'
import {commitCloudCollaboration,subscribeCloudCollaboration} from '../services/cloud-collaboration'
import {mergeNativeSnapshots} from '../engine/collaboration/merge'
import {sameNativeState} from '../engine/collaboration/state'
import type {NativeDrawingRecord,NativeTransport} from '../services/native-types'

const props=withDefaults(defineProps<{apiBase?:string;clientOptions?:{fetch?:typeof fetch;bootstrapSession?:boolean};draftRepository?:IndexedDbDraftRepository;readOnly?:boolean;interactionLocked?:boolean;collaborationUserId?:string}>(),{apiBase:'',readOnly:false})
const identitySuspended=ref(false)
let suspension:Promise<void>|undefined
const collaborationApplying=ref(false),collaborationState=ref('')
let collaborationAbort:AbortController|undefined,remotePending:NativeDrawingRecord|undefined,remoteTimer:ReturnType<typeof setTimeout>|undefined
let lastCloudRecovery=0
const appearance=ref<StudioAppearance>(readStudioAppearance())
function setAppearance(value:StudioAppearance){appearance.value=value;persistStudioAppearance(value)}
const newOpen=ref(false),useExample=ref(false),newGroupId=ref<string|null>(null),exportOpen=ref(false),recoveriesOpen=ref(false)
const requestedFormat=ref<string>(),sidebarGroups=ref<Array<{id:string;name:string;revision?:number}>>([]),sidebarTrash=ref<SidebarTrash[]>([])
const repository=props.draftRepository??new IndexedDbDraftRepository()
const route=useRoute(),router=useRouter()
let client:NativeClient|undefined,session:NativeSaveSession|undefined,timer:ReturnType<typeof setTimeout>|undefined,draftTimer:ReturnType<typeof setTimeout>|undefined
const rootId=ref(''),items=ref<NativeMetadata[]>([]),drafts=shallowRef<NativeDraft[]>([]),snapshot=shallowRef<NativeSessionSnapshot>(),host=ref<InstanceType<typeof DrawioViewport>>()
const switching=ref(false),viewportLoading=ref(true),displayTarget=shallowRef<NativeMetadata>()
let pendingOpen:NativeMetadata|undefined,openWorker:Promise<void>|undefined
let activeReadyWaiter:{key:string;resolve:()=>void;reject:(error:Error)=>void}|undefined
let viewDisposed=false,transitionGeneration=0
let cancelTargetPaint:(()=>void)|undefined
const sessionKey=ref(''),initialXML=ref(''),title=ref(''),message=ref(''),busy=ref(false),enabled=ref(false),ready=ref(false),captureFailed=ref(false)
const kindLabels:Record<DiagramKind,string>={swimlane:'泳道',flowchart:'流程图',architecture:'架构图',mindmap:'脑图',dataflow:'数据流图'}
const supportedKinds=ref<DiagramKind[]>([]),createKind=ref<DiagramKind>('swimlane'),importsDialog=ref<InstanceType<typeof NativeImportDialog>>(),importPending=ref(false)
const activityDialog=ref<InstanceType<typeof NativeActivityDialog>>()
function openImport(group:string|null=null){if(!props.readOnly)importsDialog.value?.show(group)}
function dropImport(event:DragEvent,group:string|null){if(!props.readOnly)void importsDialog.value?.dropped(event,group)}
async function openImported(id:string){await refreshList();const item=items.value.find(i=>i.id===id);if(item)await open(item)}
const currentId=computed(()=>snapshot.value?.diagramId)
const currentKind=computed(()=>items.value.find(item=>item.id===currentId.value)?.kind),deletingBranch=ref(false)
const currentMode=computed(()=>items.value.find(item=>item.id===currentId.value)?.mode)
const displayId=computed(()=>displayTarget.value?.id??currentId.value),displayKind=computed(()=>displayTarget.value?.kind??(!displayTarget.value?currentKind.value:undefined)),displayMode=computed(()=>displayTarget.value?.mode??(!displayTarget.value?currentMode.value:undefined)),displayTitle=computed(()=>displayTarget.value?.title??title.value)
type MappingRole=''|'decoration'|'title'|'node'|'edge'|'parent-edge'|'lane'|'phase'|'group'
type MappingRow=NativeCanvasCell&{role:MappingRole;businessId:string;nodeKind:NodeKind|'';label:string;laneId:string;phaseId:string;groupId:string;parentId:string;sourceId:string;targetId:string;childId:string;edgeKind:'flow'|'feedback';groupKind:'layer'|'governance'}
const mappingOpen=ref(false),mappingEnabled=ref(false),mappingRows=ref<MappingRow[]>([]),mappingKind=ref<DiagramKind>('flowchart'),mappingRevision=ref(0),mappingPreview=shallowRef<{nodes:number;edges:number;quality:{score:number;passed:boolean;issues:unknown[]}}>(),mappingSubmitted=ref(false)
const mappingNodeKinds:NodeKind[]=['task','decision','start','end','module','topic','card','note']
let pendingMapping:{id:string;input:{mapping:NativeBusinessMapping;expectedRevision:number;requestId:string}}|undefined

const exportJob=shallowRef<NativeExportJob>(),exportSubmitting=ref(false)
let exportTimer:ReturnType<typeof setTimeout>|undefined
let exportDisposed=false
let pendingExport:{sessionKey:string;diagramId:string;input:{expectedRevision:number;requestId:string}}|{sessionKey:string;sourceJobId:string;input:{requestId:string}}|undefined
const exportFormats=computed(()=>items.value.find(i=>i.id===currentId.value)?.mode==='canvas-only'?['png','svg','drawio','project.json'] as const:['png','svg','drawio','json','project.json'] as const)
const exportStatus=computed(()=>exportJob.value?`r${exportJob.value.revision}${snapshot.value&&exportJob.value.revision!==snapshot.value.baseRevision?' · 历史修订':''}${snapshot.value?.dirty?' · 不含未保存编辑':''} · ${({queued:'等待导出',running:'后台生成中',succeeded:'导出完成',failed:'导出失败'})[exportJob.value.status]}`:'')
const layoutEnabled=ref(false),orientation=ref<'vertical'|'horizontal'>('vertical'),groupMenuOpen=ref(false)
const layoutConfirmation=shallowRef<{sessionKey:string;orientation?:'vertical'|'horizontal'}>()
let pendingRendering:{id:string;rendering:{relayout:true;orientation?:'vertical'|'horizontal'};expectedRevision:number;requestId:string;record?:import('../services/native-types').NativeRecord}|undefined
async function updateOrientation(){if(!client||!session)return;const active=session;try{const record=await client.get(active.diagramId);if(active===session&&record.revision===active.snapshot().baseRevision&& !('mode' in record.document))orientation.value=record.document.rendering.preferences.orientation??'vertical'}catch(error){if(active===session)fail(error)}}
function changeOrientation(event:Event){
  const select=event.target as HTMLSelectElement,next=select.value as 'vertical'|'horizontal'
  select.value=orientation.value
  requestLayout(next)
}
function requestLayout(nextOrientation?:'vertical'|'horizontal'){
  if(!session||!ready.value||busy.value||!layoutEnabled.value||layoutConfirmation.value)return
  if(nextOrientation&&nextOrientation===orientation.value)return
  if(pendingRendering){void configureLayout();return}
  layoutConfirmation.value={sessionKey:sessionKey.value,...(nextOrientation?{orientation:nextOrientation}:{})}
}
async function confirmLayout(){
  const request=layoutConfirmation.value
  if(!request||busy.value)return
  layoutConfirmation.value=undefined
  if(request.sessionKey!==sessionKey.value){message.value='当前图形已改变，请重新选择排版操作。';return}
  await configureLayout(request.orientation)
}
async function configureLayout(nextOrientation?:'vertical'|'horizontal'){
  if(pendingContent){message.value='请先确认当前属性修改，再自动排版。';return}
  if(!client||!session||!host.value||busy.value||!ready.value||!layoutEnabled.value)return
  const active=session,bridge=host.value;busy.value=true
  try{if(!pendingRendering){await capture(true);await active.flush();pendingRendering={id:active.diagramId,rendering:{relayout:true,...(nextOrientation?{orientation:nextOrientation}:{})},expectedRevision:active.snapshot().baseRevision,requestId:crypto.randomUUID()}}const request=pendingRendering;if(request.id!==active.diagramId)throw new Error('请先确认上一图形的排版结果');request.record??=await client.configureRendering(request.id,{rendering:request.rendering,expectedRevision:request.expectedRevision,requestId:request.requestId});await bridge.mergeXML(request.record.document.rendering.engine.xml);await active.adoptCommitted(request.record,request.expectedRevision);orientation.value=request.record.document.rendering.preferences.orientation??'vertical';propertyContent.value=request.record.document.content;pendingRendering=undefined;await refreshList();message.value=''}catch(error){fail(error);if(error instanceof NativeApiError&&!error.uncertain&&!pendingRendering?.record)pendingRendering=undefined}finally{busy.value=false}
}
async function groupSelection(ungroup=false){
  groupMenuOpen.value=false
  if(pendingRendering||pendingContent){message.value='请先确认当前内容或排版提交，再组合元素。';return}
  if(!session||!host.value||busy.value||!ready.value)return
  const active=session,key=sessionKey.value;busy.value=true
  try{const xml=await host.value.groupSelection(ungroup);if(active===session&&key===sessionKey.value){await active.edit(xml);await active.flush()}}catch(error){if(active===session)fail(error)}finally{busy.value=false}
}
const status=computed(()=>{
  const s=snapshot.value
  if(viewportLoading.value)return switching.value?'正在切换':'读取中'
  if(!enabled.value)return 'Native pilot 未启用'
  if(!s)return '选择或创建图形'
  if(!ready.value)return '编辑器加载中'
  if(props.readOnly)return '只读'
  if(captureFailed.value)return '尚未成功捕获编辑，请保留当前窗口'
  if(!s.backedUp)return '本机草稿未备份，请下载恢复数据'
  return ({ready:'已保存',dirty:'待保存 · 本机草稿已保留',saving:'保存中 · 本机草稿已保留',offline:'提交未确认 · 可精确重试',conflict:'版本冲突 · 已保留本机草稿',deleted:'远端已删除 · 已保留本机草稿',invalid:'文档校验失败 · 可继续修正', 'draft-error':'本机草稿未备份',closed:'会话已关闭'})[s.status]
})
function fail(error:unknown){message.value=error instanceof Error?error.message:String(error)}
async function deleteCurrentBranch(){
  if(currentKind.value!=='mindmap'||!host.value||!ready.value||busy.value||deletingBranch.value)return
  if(!window.confirm('删除当前选中的主题及其全部后代？此操作会保存为新修订，可在当前原生会话中撤销。'))return
  const activeHost=host.value,active=session,key=sessionKey.value;deletingBranch.value=true
  // Leave native XML/autosave events enabled. Host owns actual selection and
  // descendants; this page neither traverses content nor issues a server delete.
  try{const xml=await activeHost.deleteSelectedBranch();if(active&&active===session&&key===sessionKey.value){await active.edit(xml);await active.flush()}}catch(error){if(key===sessionKey.value)fail(error)}finally{deletingBranch.value=false}
}
async function openMapping(){
  if(!client||!session||currentMode.value!=='canvas-only'||busy.value)return
  const active=session;busy.value=true
  try{await capture(true);await active.flush();const value=await client.canvasMappingCells(active.diagramId);if(active!==session)return;mappingRevision.value=value.revision;mappingEnabled.value=value.enabled;mappingRows.value=value.cells.map(cell=>({...cell,role:'',businessId:'',nodeKind:'',label:cell.label,laneId:'',phaseId:'',groupId:'',parentId:'',sourceId:'',targetId:'',childId:'',edgeKind:'flow',groupKind:'layer'}));mappingPreview.value=undefined;pendingMapping=undefined;mappingSubmitted.value=false;mappingOpen.value=true}catch(error){fail(error)}finally{busy.value=false}
}
function mappingChanged(){if(!mappingSubmitted.value){mappingPreview.value=undefined;pendingMapping=undefined}}
function mappingDecorations(){if(mappingSubmitted.value)return;mappingRows.value.forEach(row=>{if(!row.role)row.role='decoration'});mappingChanged()}
function mappingInput():NativeBusinessMapping{
  const result:NativeBusinessMapping={kind:mappingKind.value,nodes:[],edges:[],decorations:[]},optional=(row:MappingRow)=>({...row.laneId?{laneId:row.laneId}:{},...row.phaseId?{phaseId:row.phaseId}:{},...row.groupId?{groupId:row.groupId}:{},...row.parentId?{parentId:row.parentId}:{}})
  for(const row of mappingRows.value){if(!row.role)throw new Error('请为每个原生元素明确选择业务用途或装饰');const label=row.label?{label:row.label}:{}
    if(row.role==='decoration')result.decorations!.push(row.cellId)
    else if(row.role==='title'){if(result.titleCellId)throw new Error('只能绑定一个文档标题');result.titleCellId=row.cellId}
    else if(row.role==='node'){if(!row.businessId||!row.nodeKind)throw new Error('业务节点需要明确ID和类型');result.nodes.push({cellId:row.cellId,node:{id:row.businessId,kind:row.nodeKind,...label,...optional(row)}})}
    else if(row.role==='edge'){if(!row.businessId||!row.sourceId||!row.targetId)throw new Error('业务连接需要ID及源/目标业务ID');result.edges.push({cellId:row.cellId,edge:{id:row.businessId,source:row.sourceId,target:row.targetId,kind:row.edgeKind,...label}})}
    else if(row.role==='parent-edge'){if(!row.childId)throw new Error('父子线需要明确子主题业务ID');(result.parentEdges??=[]).push({cellId:row.cellId,childId:row.childId})}
    else{if(!row.businessId)throw new Error('容器需要明确业务ID');if(row.role==='lane')(result.lanes??=[]).push({cellId:row.cellId,id:row.businessId,...label});else if(row.role==='phase')(result.phases??=[]).push({cellId:row.cellId,id:row.businessId,...label});else(result.groups??=[]).push({cellId:row.cellId,id:row.businessId,kind:row.groupKind,...label})}
  }return result
}
async function previewMapping(){if(!client||!session||!mappingEnabled.value||busy.value||mappingSubmitted.value)return;try{const input={mapping:mappingInput(),expectedRevision:mappingRevision.value,requestId:crypto.randomUUID()},value=await client.previewCanvasMapping(session.diagramId,{mapping:input.mapping,expectedRevision:input.expectedRevision});mappingPreview.value=value;pendingMapping={id:session.diagramId,input}}catch(error){fail(error)}}
async function confirmMapping(){
  if(!client||!pendingMapping||busy.value)return
  if(!mappingSubmitted.value&&!window.confirm('将当前仅画布文档转换为业务图形并新增修订？转换前原稿保留在历史中。'))return
  const request=pendingMapping;busy.value=true;mappingSubmitted.value=true
  try{const record=await client.mapCanvas(request.id,request.input);await session?.close();session=undefined;mappingOpen.value=false;mappingPreview.value=undefined;pendingMapping=undefined;mappingSubmitted.value=false;await refreshList();activate(await NativeSaveSession.open(options(request.id)),nativeRecordIdentity(record).title)}catch(error){if(error instanceof NativeApiError&&!error.uncertain)mappingSubmitted.value=false;fail(error)}finally{busy.value=false}
}
function closeMapping(){if(!mappingSubmitted.value&&!busy.value){mappingOpen.value=false;mappingPreview.value=undefined;pendingMapping=undefined}}
function downloadMapping(){try{download({filename:'flymind-business-mapping.json',mimeType:'application/json',contents:JSON.stringify({diagramId:currentId.value,baseRevision:mappingRevision.value,mapping:mappingInput()},null,2)})}catch(error){fail(error)}}
async function refreshDrafts(){try{drafts.value=(await repository.list()).sort((a,b)=>b.updatedAt-a.updatedAt)}catch(error){fail(error)}}
async function refreshList(){if(client){const [files,groups,trash]=await Promise.all([client.list(),client.groups(),client.trash()]);items.value=files;sidebarGroups.value=groups.groups;sidebarTrash.value=trash.diagrams}}
async function organize(path:string,method:string,input?:unknown){if(props.readOnly)return false;if(!client)return false;try{await client.organization(path,method,input);message.value='';await refreshList();return true}catch(error){fail(error);return false}}
function updateDiagramQuery(id?:string){const query={...route.query};if(id)query.diagram=id;else delete query.diagram;void router.replace({query}).catch(fail)}
async function nativeAction(action:'undo'|'redo'|'fit'){try{if(!host.value||!ready.value)throw new Error('编辑器尚未就绪');await host.value[action]()}catch(error){fail(error)}}
function openNew(group:string|null){if(props.readOnly)return;newGroupId.value=group;newOpen.value=true}
async function createInGroup(kind:DiagramKind){createKind.value=kind;newOpen.value=false;await create()}
const thumbnails=new Map<DiagramKind,string>()
function thumbnail(kind:DiagramKind){if(!thumbnails.has(kind)){const d=sampleFor(kind);thumbnails.set(kind,renderScene(layoutDocument(d),d))}return thumbnails.get(kind)!}
const inspectorOpen=ref(false),propertyContent=shallowRef<DiagramContent>(),propertyId=ref(''),propertyNode=computed(()=>propertyContent.value?.nodes.find(n=>n.id===propertyId.value))
let pendingContent:{id:string;operations:DiagramOperation[];expectedRevision:number;requestId:string;record?:import('../services/native-types').NativeRecord}|undefined
async function openProperties(){
  if(!client||!session||!host.value||busy.value)return;busy.value=true
  try{await capture(true);await session.flush();const record=await client.get(session.diagramId);if('mode'in record.document)return;propertyContent.value=record.document.content;const selection=await host.value.getSelection();propertyId.value=selection.find(s=>s.type==='node'||s.type==='annotation')?.businessId??'';inspectorOpen.value=true}catch(error){fail(error)}finally{busy.value=false}
}
async function applyContent(operations:DiagramOperation[]){
  if(props.readOnly)return
  if(pendingRendering){message.value='请先重试确认当前排版结果，再修改内容。';return}
  if(!client||!session||!host.value||busy.value)return;const active=session,bridge=host.value;busy.value=true
  try{if(!pendingContent){await capture(true);await active.flush();pendingContent={id:active.diagramId,operations,expectedRevision:active.snapshot().baseRevision,requestId:crypto.randomUUID()}}const request=pendingContent;if(request.id!==active.diagramId)throw new Error('请先处理上一图形的属性提交');request.record??=await client.patchContent(request.id,{operations:request.operations,expectedRevision:request.expectedRevision,requestId:request.requestId});await bridge.mergeXML(request.record.document.rendering.engine.xml);await active.adoptCommitted(request.record,request.expectedRevision);title.value=request.record.document.content.title;propertyContent.value=request.record.document.content;pendingContent=undefined;await refreshList()}catch(error){fail(error);if(error instanceof NativeApiError&&!error.uncertain&&!pendingContent?.record)pendingContent=undefined}finally{busy.value=false}
}
function updateProperty(field:string,value:unknown){if(propertyNode.value)void applyContent([{op:'update_node',id:propertyNode.value.id,changes:{[field]:value}} as DiagramOperation])}
function addNode(){const c=propertyContent.value;if(!c)return;const n={id:crypto.randomUUID(),kind:c.kind==='architecture'?'module':c.kind==='mindmap'?'topic':c.kind==='dataflow'?'card':'task',label:c.kind==='mindmap'?'新主题':'新节点',...(c.kind==='swimlane'?{laneId:c.lanes[0]?.id,phaseId:c.phases[0]?.id}:{}),...(c.kind==='architecture'?{groupId:c.groups[0]?.id}:{}),...(c.kind==='mindmap'?{parentId:propertyId.value||c.nodes.find(n=>n.kind==='topic'&&!n.parentId)?.id}:{})};void applyContent([{op:'add_node',node:n} as DiagramOperation])}
async function renameFile(id:string,name:string){if(id===currentId.value){await applyContent([{op:'set_title',title:name}]);return}if(!client)return;try{const record=await client.get(id);if('mode'in record.document)throw new Error('仅画布标题修改暂未接入');await client.patchContent(id,{operations:[{op:'set_title',title:name}],expectedRevision:record.revision,requestId:crypto.randomUUID()});await refreshList()}catch(error){fail(error)}}
async function duplicateFile(id:string){if(!client)return;try{if(id===currentId.value){await capture(true);await session?.flush()}const record=await client.get(id),bytes=new TextEncoder().encode(JSON.stringify(record.document));let raw='';for(const byte of bytes)raw+=String.fromCharCode(byte);const copy=await client.importBusiness({format:'project',data:btoa(raw),requestId:crypto.randomUUID(),workspaceGroupId:items.value.find(i=>i.id===id)?.workspaceGroupId??null});await refreshList();await open(items.value.find(i=>i.id===nativeRecordIdentity(copy).id)!)}catch(error){fail(error)}}
const sidebar:SidebarAdapter=reactive({get documents(){return items.value.map(item=>({...item,...(item.format===2?{statusLabel:'只读 · 未迁移'}:{})}))},get activeId(){return displayId.value??''},get assignments(){return Object.fromEntries(items.value.filter(i=>i.workspaceGroupId).map(i=>[i.id,i.workspaceGroupId!]))},get workspaceGroups(){return sidebarGroups.value},get trash(){return sidebarTrash.value},get recoveries(){return drafts.value},get shared(){return enabled.value},get pending(){return busy.value},get storageError(){return message.value},open:(id:string)=>{const item=items.value.find(i=>i.id===id);if(item)void open(item)},renameDocument:renameFile,duplicateDocument:duplicateFile,
 deleteDocument:async(id:string)=>{try{const item=items.value.find(i=>i.id===id);if(!item||!client)return;const active=id===currentId.value;if(active&&!await leaveCurrent())return;const revision=(await client.get(id)).revision;if(await organize('/diagrams/'+encodeURIComponent(id)+'?revision='+revision,'DELETE')&&(active||route.query.diagram===id))updateDiagramQuery()}catch(error){fail(error)}},
 createWorkspaceGroup:(name:string)=>organize('/groups','POST',{name}),renameWorkspaceGroup:(id:string,name:string)=>organize('/groups/'+encodeURIComponent(id),'PUT',{name,expectedRevision:sidebarGroups.value.find(g=>g.id===id)?.revision}),deleteWorkspaceGroup:(id:string)=>organize('/groups/'+encodeURIComponent(id)+'?revision='+sidebarGroups.value.find(g=>g.id===id)?.revision,'DELETE'),moveToWorkspaceGroup:(id:string,workspaceGroupId:string|null)=>organize('/diagrams/'+encodeURIComponent(id)+'/group','PUT',{workspaceGroupId,expectedWorkspaceGroupId:items.value.find(i=>i.id===id)?.workspaceGroupId??null}),restoreDeleted:(item:SidebarTrash)=>organize('/trash/'+encodeURIComponent(item.id)+'/restore','POST',{expectedRevision:item.revision,deletedAt:item.deletedAt}),purgeDeleted:(item:SidebarTrash)=>organize('/trash/'+encodeURIComponent(item.id)+'?revision='+item.revision+'&deletedAt='+item.deletedAt,'DELETE'),notify:()=>{}})
async function exportFile(format:string){exportOpen.value=false;requestedFormat.value=format;await exportCurrent()}
function downloadExport(){const format=requestedFormat.value,job=exportJob.value;if(format&&job?.status==='succeeded'){const file=job.files?.[format as keyof NonNullable<typeof job.files>];if(file){const a=document.createElement('a');a.href=file.url;a.download='';a.click();requestedFormat.value=undefined}}}

function options(diagramId:string):NativeSessionOptions{
  const collaboration=()=>({baseURL:props.apiBase+'/studio-api/native',diagramId,dataRootId:rootId.value,userId:props.collaborationUserId!,fetch:props.clientOptions?.fetch})
  const transport:NativeTransport=props.collaborationUserId?{health:()=>client!.health(),get:id=>client!.get(id),saveEditor:async(_id,input)=>(await commitCloudCollaboration(collaboration(),input)).record}:client!
  return {dataRootId:rootId.value,diagramId,transport,drafts:repository,
    ...(props.collaborationUserId?{reconcileRecord:async(baseXML:string,record:NativeDrawingRecord)=>{
      const active=session,bridge=host.value,key=sessionKey.value
      if(!active||active.diagramId!==diagramId||!bridge||!ready.value||identitySuspended.value)throw new NativeApiError('协同画布会话已改变，草稿保留',409,'COLLABORATION_SESSION_CHANGED')
      collaborationApplying.value=true;clearTimeout(timer)
      try{
        await nextTick()
        const visible=await bridge.commitAndCaptureXML()
        await active.edit(visible)
        const merged=mergeNativeSnapshots(baseXML,visible,record.document.rendering.engine.xml)
        if(active!==session||key!==sessionKey.value||identitySuspended.value)throw new NativeApiError('协同会话已改变，未应用远端内容',409,'COLLABORATION_SESSION_CHANGED')
        if(!sameNativeState(visible,merged))await bridge.applyRemoteXML(visible,merged)
        return await bridge.captureXML()
      }finally{collaborationApplying.value=false}
    }}:{}),
    onChange:s=>{if(session?.sessionId===s.sessionId){snapshot.value=s;clearTimeout(draftTimer);draftTimer=setTimeout(()=>void refreshDrafts(),150)}},
    onAcknowledged:ack=>{if(session?.diagramId===nativeRecordIdentity(ack.record).id){title.value=nativeRecordIdentity(ack.record).title;message.value='';void refreshList().catch(fail);void applyPendingRemote()}}}
}
function stopCollaboration(){collaborationAbort?.abort();collaborationAbort=undefined;remotePending=undefined;clearTimeout(remoteTimer);lastCloudRecovery=0;collaborationState.value=''}
async function recoverCloudConnection(active:NativeSaveSession){if(active!==session||identitySuspended.value||props.readOnly||navigator.onLine===false||active.snapshot().status!=='offline'||Date.now()-lastCloudRecovery<2000)return;lastCloudRecovery=Date.now();try{await active.retry()}catch(error){if(active===session)fail(error)}}
async function applyPendingRemote(){
  const active=session,record=remotePending
  if(!active||!record||identitySuspended.value)return
  if(!ready.value||busy.value||collaborationApplying.value){clearTimeout(remoteTimer);remoteTimer=setTimeout(()=>void applyPendingRemote(),200);return}
  if(record.revision<active.snapshot().baseRevision){remotePending=undefined;return}
  try{
    if(await active.receiveRemote(record)){if(remotePending===record)remotePending=undefined;title.value=nativeRecordIdentity(record).title;propertyContent.value=undefined;void refreshList().catch(fail);if(active.snapshot().dirty&&!props.readOnly)timer=setTimeout(()=>void save(),700)}
    else {clearTimeout(remoteTimer);remoteTimer=setTimeout(()=>void applyPendingRemote(),200)}
  }catch(error){collaborationState.value='协同冲突，草稿已保留';if(active===session)fail(error)}
}
function startCollaboration(){
  if(!props.collaborationUserId||!session||!ready.value||identitySuspended.value)return
  stopCollaboration();const active=session,controller=new AbortController();collaborationAbort=controller
  void (async()=>{let retries=0;while(!controller.signal.aborted&&active===session){
    collaborationState.value=retries?'协同重连中':'连接协同'
    try{await subscribeCloudCollaboration({baseURL:props.apiBase+'/studio-api/native',diagramId:active.diagramId,dataRootId:active.dataRootId,userId:props.collaborationUserId!,fetch:props.clientOptions?.fetch,since:active.snapshot().baseRevision,signal:controller.signal,
      onEvent:async event=>{if(controller.signal.aborted||active!==session)return;retries=0;collaborationState.value='协同已连接';await recoverCloudConnection(active);if(event.revision>=active.snapshot().baseRevision){if(!remotePending||event.revision>=remotePending.revision)remotePending=event.record;await applyPendingRemote()}},
      onHeartbeat:()=>{if(!controller.signal.aborted){collaborationState.value='协同已连接';void recoverCloudConnection(active).then(()=>applyPendingRemote())}}
    })}catch(error){if(controller.signal.aborted)return;collaborationState.value='协同连接中断，草稿已保留';if(error instanceof NativeApiError&&[401,403].includes(error.status)){try{await client?.health()}catch(cause){fail(cause)};return}if(error instanceof NativeApiError&&[404,410].includes(error.status)){collaborationState.value='图形已删除，草稿已保留';clearTimeout(remoteTimer);remotePending=undefined;fail(error);return}}
    if(controller.signal.aborted)return
    await new Promise<void>(resolve=>{const done=()=>{clearTimeout(wait);controller.signal.removeEventListener('abort',done);resolve()},wait=setTimeout(done,Math.min(8000,500*2**Math.min(retries++,4)));controller.signal.addEventListener('abort',done,{once:true})})
  }})().catch(fail)
}
function activate(next:NativeSaveSession,name:string){stopCollaboration();propertyContent.value=undefined;propertyId.value='';session=next;snapshot.value=next.snapshot();sessionKey.value=next.dataRootId+':'+next.sessionId;initialXML.value=snapshot.value.latestXML;title.value=name;ready.value=false;captureFailed.value=false;message.value='';clearTimeout(exportTimer);exportJob.value=undefined;pendingExport=undefined;updateDiagramQuery(next.diagramId)}
async function capture(commit=false,allowUnbackedDownload=false){if(props.readOnly)return;const active=session,key=sessionKey.value;if(active&&(!host.value||!ready.value))throw new NativeApiError('编辑器尚未就绪，尚不能确认当前原生模型',0,'EDITOR_NOT_READY');if(active&&host.value&&ready.value){let xml:string;try{xml=await (commit?host.value.commitAndCaptureXML():host.value.captureXML())}catch(error){if(active===session)captureFailed.value=true;throw error}if(active===session&&key===sessionKey.value){captureFailed.value=false;try{await active.edit(xml)}catch(error){if(!allowUnbackedDownload||!(error instanceof NativeDraftError)||active.snapshot().latestXML!==xml)throw error;fail(error)}}}}
async function save(retry=false){const active=session;if(!active||identitySuspended.value||collaborationApplying.value)return;clearTimeout(timer);try{await capture();if(active!==session||identitySuspended.value)return;if(retry)await active.retry();else await active.flush();await applyPendingRemote()}catch(error){if(active===session)fail(error)}}
async function validateLeave(preserveOnly=false){
  if(props.readOnly)return true
  if(pendingRendering){message.value='排版结果尚待确认，请先重试同一排版请求。';return false}
  if(pendingContent){message.value='属性修改结果尚待确认，请先重试同一属性修改。';return false}
  if(deletingBranch.value){message.value='正在处理原生分支删除，请完成后再切换图形。';return false}
  if(!session)return true
  const active=session;clearTimeout(timer)
  try{await capture(true)}catch(error){fail(error);return false}
  try{if(!preserveOnly&&!active.snapshot().inflight)await active.flush()}catch(error){fail(error)}
  if(active!==session)return false
  const s=active.snapshot()
  if(!s.backedUp){message.value='本机草稿未备份，请先下载恢复数据；当前编辑器已保留。';return false}
  if((s.dirty||s.status==='conflict'||s.status==='deleted')&&!window.confirm('最新编辑已保留为本机草稿，保存尚未完成。保留草稿并离开当前图形？'))return false
  return true
}
async function leaveCurrent(preserveOnly=false){
  if(switching.value)return false
  if(!await validateLeave(preserveOnly))return false
  const active=session
  try{await active?.close()}catch(error){fail(error);return false}
  if(session===active){stopCollaboration();session=undefined;snapshot.value=undefined;sessionKey.value='';ready.value=false}
  await refreshDrafts();return true
}
function rollbackTarget(){displayTarget.value=undefined;viewportLoading.value=false;switching.value=false;updateDiagramQuery(currentId.value)}
function showTarget(item:NativeMetadata){displayTarget.value=item;viewportLoading.value=true;switching.value=true;message.value='';updateDiagramQuery(item.id)}
function hostReady(event:{sessionKey:string}){
  if(event.sessionKey!==sessionKey.value)return
  ready.value=true;void updateOrientation();startCollaboration()
  if(activeReadyWaiter?.key===event.sessionKey){const waiter=activeReadyWaiter;activeReadyWaiter=undefined;waiter.resolve()}
  if(!pendingOpen&&(!displayTarget.value||displayTarget.value.id===currentId.value)){displayTarget.value=undefined;viewportLoading.value=false;switching.value=false}
}
function hostError(event:{sessionKey:string;message:string}){if(event.sessionKey!==sessionKey.value)return;message.value=event.message;if(activeReadyWaiter?.key===event.sessionKey){const waiter=activeReadyWaiter;activeReadyWaiter=undefined;waiter.reject(new Error(event.message))}}
async function activatePrepared(next:NativeSaveSession,name:string,expectedGeneration?:number){
  const generation=expectedGeneration??++transitionGeneration,previous=session,viewport=host.value
  viewportLoading.value=true;switching.value=true
  const valid=()=>!viewDisposed&&generation===transitionGeneration&&session===previous
  let committed=false
  try{
    if(!viewport)throw new Error('画布宿主尚未就绪，未切换图形')
    await viewport.prepare({sessionKey:next.dataRootId+':'+next.sessionId,initialXML:next.snapshot().latestXML,title:name})
    if(!valid())throw new Error('切图请求已失效')
    const displayed=new Promise<void>((resolve,reject)=>{activeReadyWaiter={key:next.dataRootId+':'+next.sessionId,resolve,reject}})
    // No await between the final token check and commit: a newer click cannot
    // strand a closed old session or activate an obsolete candidate.
    activate(next,name);committed=true
    if(displayTarget.value&&displayTarget.value.id!==next.diagramId)updateDiagramQuery(displayTarget.value.id)
    void previous?.close().catch(error=>{if(!viewDisposed&&session===next)message.value='原图已保存或保留草稿，但本机关闭清理未完成：'+(error instanceof Error?error.message:String(error))})
    await displayed
  }catch(error){if(!committed){viewport?.discardPrepared();await next.close().catch(()=>{})}throw error}
}
async function paintDisplayTarget(){
  await nextTick()
  if(viewDisposed)return
  await new Promise<void>(resolve=>{
    let frame:number
    const done=()=>{cancelTargetPaint=undefined;resolve()}
    cancelTargetPaint=()=>{cancelAnimationFrame(frame);done()}
    frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(done)})
  })
}
async function processOpen(){
  let validated=false
  busy.value=true
  try{
    while(pendingOpen&&!viewDisposed){
      const target=pendingOpen,generation=transitionGeneration;pendingOpen=undefined
      try{
        await paintDisplayTarget()
        if(viewDisposed||generation!==transitionGeneration)continue
        if(!validated){if(!await validateLeave())throw new Error(message.value||'已保留当前图形');validated=true}
        if(generation!==transitionGeneration)continue
        const next=await NativeSaveSession.open(options(target.id))
        if(generation!==transitionGeneration||viewDisposed){await next.close().catch(()=>{});continue}
        await activatePrepared(next,target.title,generation);validated=false
      }catch(error){
        if(generation!==transitionGeneration)continue
        rollbackTarget();fail(error);return
      }
    }
  }finally{busy.value=false;if(!viewDisposed&&!viewportLoading.value)switching.value=false}
}
async function open(item:NativeMetadata){
  if(item.format!==3){message.value='此图尚未迁移，当前为只读记录；未打开原生编辑器，也未修改原文件。';return}
  if(busy.value&&!openWorker)return
  if(!switching.value&&item.id===currentId.value)return
  showTarget(item);pendingOpen=item;transitionGeneration++;if(!activeReadyWaiter)host.value?.discardPrepared()
  if(openWorker)return openWorker
  openWorker=processOpen().finally(()=>{openWorker=undefined})
  return openWorker
}
async function create(){
  if(!client||busy.value)return
  const name='新建'+kindLabels[createKind.value]
  busy.value=true;viewportLoading.value=true;switching.value=true
  try{
    if(!await validateLeave())return
    const content:DiagramContent={...extractContent(useExample.value?sampleFor(createKind.value):blankDocument(createKind.value)),schemaVersion:1,id:crypto.randomUUID(),title:name.trim()}
    const record=await client.create({content,requestId:crypto.randomUUID(),workspaceGroupId:newGroupId.value});await refreshList();await activatePrepared(await NativeSaveSession.open(options(content.id)),record.document.content.title)
  }catch(error){fail(error)}finally{if(!ready.value||!session||viewportLoading.value)rollbackTarget();busy.value=false}
}
function xml(event:{sessionKey:string;xml:string;reason:'save'|'autosave'}){
  if(props.readOnly||identitySuspended.value||collaborationApplying.value||event.sessionKey!==sessionKey.value||!session||busy.value)return
  const active=session;clearTimeout(timer)
  void active.edit(event.xml).then(()=>{if(active!==session)return;if(event.reason==='save')void save();else timer=setTimeout(()=>void save(),700)}).catch(error=>{if(active===session)fail(error)})
}
function requested(event:{sessionKey:string;reason:'save'|'autosave'}){if(!props.readOnly&&!identitySuspended.value&&!collaborationApplying.value&&!busy.value&&event.sessionKey===sessionKey.value&&event.reason==='save')void save()}
function download(value:NativeRecoveryDownload){const url=URL.createObjectURL(new Blob([value.contents],{type:value.mimeType})),anchor=document.createElement('a');anchor.href=url;anchor.download=value.filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function downloadCurrent(){if(busy.value)return;busy.value=true;try{await capture(true,true);if(session)download(session.downloadRecovery())}catch(error){fail(error)}finally{busy.value=false}}
async function restore(draft:NativeDraft){
  if(!client||busy.value)return
  busy.value=true
  try{
    if(!await leaveCurrent())return
    const result=await NativeSaveSession.recover(options(draft.diagramId),draft)
    if('session' in result){
      activate(result.session,items.value.find(i=>i.id===draft.diagramId)?.title||'恢复草稿')
      if(result.kind==='pending-retry')message.value='已恢复未确认请求，请点击“重试保存”精确确认；源草稿仍保留。'
    }else message.value=result.error.message+'。请下载恢复数据；不会覆盖或复活原图。'
    await refreshDrafts()
  }catch(error){fail(error)}finally{busy.value=false}
}
async function remove(draft:NativeDraft){
  if(draft.sessionId===session?.sessionId){message.value='请先离开当前编辑会话，再移除此草稿。';return}
  if(!window.confirm('仅移除此份本机草稿？正式图形不受影响。'))return
  try{if(!await repository.remove(draft,draft))message.value='草稿已有更新，未移除。';await refreshDrafts()}catch(error){fail(error)}
}
async function reloadRemote(){
  if(!client||!session||busy.value)return
  const id=session.diagramId;busy.value=true
  try{switching.value=true;viewportLoading.value=true;if(!await validateLeave(true))return;const next=await NativeSaveSession.open(options(id));await refreshList();await activatePrepared(next,items.value.find(item=>item.id===id)?.title||title.value)}catch(error){fail(error)}finally{if(viewportLoading.value)rollbackTarget();switching.value=false;busy.value=false}
}
async function refresh(){try{await refreshList();await refreshDrafts();if(session&&client){const remote=await client.get(session.diagramId);if(remote.revision!==session.snapshot().baseRevision)message.value='远端已有新修订。当前编辑保留不变，可明确重新读取远端。'}}catch(error){fail(error)}}
async function pollExport(key:string,id:string){
  if(exportDisposed||!client||sessionKey.value!==key||exportJob.value?.id!==id)return
  try{const job=await client.exportJob(id);if(exportDisposed||sessionKey.value!==key||exportJob.value?.id!==id)return;exportJob.value=job;downloadExport();if(job.status==='queued'||job.status==='running')exportTimer=setTimeout(()=>void pollExport(key,id),700)}catch(error){if(!exportDisposed&&sessionKey.value===key&&exportJob.value?.id===id)fail(error)}
}
async function submitExport(){
  const pending=pendingExport;if(!client||!pending||pending.sessionKey!==sessionKey.value)return
  exportSubmitting.value=true
  try{const job='diagramId' in pending?await client.createExport(pending.diagramId,pending.input):await client.retryExport(pending.sourceJobId,pending.input);if(exportDisposed||pending.sessionKey!==sessionKey.value)return;pendingExport=undefined;exportJob.value=job;void pollExport(pending.sessionKey,job.id)}catch(error){if(!exportDisposed&&pending.sessionKey===sessionKey.value){if(error instanceof NativeApiError&&!error.uncertain)pendingExport=undefined;fail(error)}}finally{exportSubmitting.value=false}
}
async function exportCurrent(){
  if(!client||!session||busy.value||exportSubmitting.value||pendingExport)return
  const active=session;busy.value=true;clearTimeout(exportTimer);exportJob.value=undefined
  try{await capture(true);await active.flush();const saved=active.snapshot();if(active!==session||saved.dirty||!saved.backedUp||saved.status!=='ready')throw new NativeApiError('当前编辑尚未保存成功，请先保留恢复数据',409,'EXPORT_SAVE_REQUIRED');pendingExport={sessionKey:sessionKey.value,diagramId:active.diagramId,input:{expectedRevision:saved.baseRevision,requestId:crypto.randomUUID()}};await submitExport()}catch(error){fail(error)}finally{busy.value=false}
}
async function retryExport(){if(!exportJob.value||exportJob.value.status!=='failed'||pendingExport)return;pendingExport={sessionKey:sessionKey.value,sourceJobId:exportJob.value.id,input:{requestId:crypto.randomUUID()}};await submitExport()}
const beforeUnload=(event:BeforeUnloadEvent)=>{if(pendingRendering||pendingContent||importPending.value||mappingOpen.value||snapshot.value&&(snapshot.value.dirty||!snapshot.value.backedUp||captureFailed.value||host.value?.hasUncommittedText())){event.preventDefault();event.returnValue=''}}
onMounted(async()=>{
  viewportLoading.value=true
  window.addEventListener('beforeunload',beforeUnload)
  try{const health=await new NativeClient(props.apiBase,props.clientOptions).health();rootId.value=health.dataRootId;enabled.value=health.capabilities.nativePilot&&health.capabilities.nativeDocumentWrites;layoutEnabled.value=health.capabilities.configureRendering===true;supportedKinds.value=(health.capabilities.supportedKinds??[]) as DiagramKind[];if(supportedKinds.value.length&&!supportedKinds.value.includes(createKind.value))createKind.value=supportedKinds.value[0];if(enabled.value){client=new NativeClient(props.apiBase,{...props.clientOptions,expectedDataRootId:health.dataRootId});await refreshList();const requested=route.query.diagram;if(typeof requested==='string'){const item=items.value.find(item=>item.id===requested);if(item?.format===3)await open(item);else message.value=item?'此图尚未迁移，只读保留；不会打开原生编辑或自动迁移。':'图形不存在或已删除；未创建任何新图。'}}await refreshDrafts()}catch(error){fail(error)}finally{if(!openWorker&&!activeReadyWaiter)viewportLoading.value=false}
})
function suspendForIdentityChange():Promise<void>{
  if(suspension)return suspension
  identitySuspended.value=true;stopCollaboration();clearTimeout(timer);clearTimeout(draftTimer);clearTimeout(exportTimer)
  transitionGeneration++;pendingOpen=undefined;cancelTargetPaint?.();host.value?.discardPrepared()
  const active=session,bridge=host.value
  suspension=(async()=>{
    try{if(active&&bridge&&ready.value&&!props.readOnly){const xml=await bridge.commitAndCaptureXML();await active.edit(xml)}}
    finally{await active?.close();if(session===active){session=undefined;ready.value=false}}
  })()
  return suspension
}
defineExpose({prepareLeave:async()=>{if(busy.value||switching.value||identitySuspended.value)return false;return validateLeave()},suspendForIdentityChange})
onBeforeRouteLeave(async()=>leaveCurrent())
onBeforeUnmount(()=>{stopCollaboration();viewDisposed=true;transitionGeneration++;cancelTargetPaint?.();pendingOpen=undefined;activeReadyWaiter?.reject(new Error('画布已关闭'));activeReadyWaiter=undefined;host.value?.discardPrepared();exportDisposed=true;clearTimeout(timer);clearTimeout(draftTimer);clearTimeout(exportTimer);window.removeEventListener('beforeunload',beforeUnload);void session?.close().catch(()=>{})})
</script>

<template>
  <div class="studio-root native-appearance" :inert="props.interactionLocked||identitySuspended||collaborationApplying" :aria-busy="props.interactionLocked||identitySuspended||undefined" :data-appearance="appearance" @click="exportOpen=false;groupMenuOpen=false">
    <WorkspaceSidebar :read-only="props.readOnly" :adapter="sidebar" :show-group-creation="true" @new="openNew" @import="openImport" @file-drop="dropImport" @activity="activityDialog?.show($event)" @recoveries="recoveriesOpen=true" :backup-enabled="false" @help="message='通过 FlyMind MCP 创建或修改业务内容，原生画布编辑后自动保存。'"/>
    <main class="studio-main">
    <header class="studio-header">
      <div class="studio-document-name"><span class="studio-kind"><Icon :name="displayKind||'code'" :size="15"/>{{displayKind?kindLabels[displayKind]:displayMode==='canvas-only'?'画布':'图形'}}</span><input :value="displayTitle" :disabled="props.readOnly||!sessionKey||busy||viewportLoading" @change="renameFile(currentId!,($event.target as HTMLInputElement).value)" aria-label="图形标题"/><span class="studio-save-state" :class="{error:snapshot&&!['ready','dirty','saving'].includes(snapshot.status)}" role="status" :data-status="snapshot?.status"><Icon :name="snapshot?.status==='ready'?'check':'edit'" :size="13"/>{{status}}</span><span v-if="collaborationState" class="studio-save-state" role="status">{{collaborationState}}</span></div>
      <div class="studio-header-actions"><slot name="account"/><div class="studio-appearance-switch" role="group" aria-label="界面主题"><button :aria-pressed="appearance==='light'" aria-label="浅色主题" title="浅色主题" @click="setAppearance('light')"><Icon name="sun" :size="15"/></button><button :aria-pressed="appearance==='dark'" aria-label="深色主题" title="深色主题" @click="setAppearance('dark')"><Icon name="moon" :size="15"/></button></div><button v-if="displayKind" class="studio-icon" aria-label="属性面板" title="属性面板" :disabled="busy||viewportLoading||!ready" @click="openProperties"><Icon name="panel"/></button><div class="studio-export-wrap" @click.stop><button class="studio-primary" :disabled="!sessionKey||!ready||busy||exportSubmitting||!!pendingExport" @click="exportOpen=!exportOpen"><Icon name="export" :size="15"/>导出<Icon name="chevron" :size="12"/></button><div v-if="exportOpen" class="studio-menu"><button @click="exportFile('svg')">SVG 矢量图</button><button @click="exportFile('png')">PNG 图片</button><button v-if="displayMode!=='canvas-only'" @click="exportFile('json')">JSON 内容数据</button><button @click="exportFile('project.json')">工作区文件</button><button @click="exportFile('drawio')">draw.io 文件</button></div></div></div>
    </header>
    <div v-if="exportJob&&(exportJob.status==='running'||exportJob.status==='queued'||exportJob.status==='failed')||pendingExport" class="studio-storage-error">{{exportStatus}} {{exportJob?.error?.message}}<button v-if="exportJob?.status==='failed'" @click="retryExport">重试导出</button><button v-if="pendingExport" @click="submitExport">重试提交</button></div>
    <div v-if="snapshot&&!['ready','dirty','saving'].includes(snapshot.status)" class="studio-storage-error"><span>{{status}}</span><button @click="save(true)">重试保存</button><button @click="downloadCurrent">下载恢复数据</button><button @click="reloadRemote">载入最新</button></div>
    <div v-if="message" class="studio-storage-error" role="alert">{{message}}<button v-if="pendingContent" @click="applyContent([])">重试同一属性修改</button><button v-if="pendingRendering" @click="configureLayout()">重试同一排版</button><button @click="message=''" aria-label="关闭提示">×</button></div>

    <section v-if="mappingOpen" class="native-mapping-review" role="dialog" aria-modal="true" aria-label="业务属性映射">
      <h2>业务属性映射</h2><p>逐项设置业务身份与归属；其余元素须明确标为装饰。验证通过后新增修订，原画布保留在历史中。</p><p v-if="!mappingEnabled">当前映射能力尚未启用，可查看或下载属性方案，不会转换。</p>
      <label>业务类型<select v-model="mappingKind" :disabled="mappingSubmitted" @change="mappingChanged"><option v-for="kind in supportedKinds" :key="kind" :value="kind">{{kindLabels[kind]}}</option></select></label><button :disabled="mappingSubmitted" @click="mappingDecorations">将剩余元素明确标为装饰</button>
      <table><thead><tr><th>原生元素</th><th>用途</th><th>业务属性</th></tr></thead><tbody><tr v-for="row in mappingRows" :key="row.cellId"><td>{{row.label||row.cellId}}<small>{{row.cellId}} · {{row.kind}}</small><small v-if="row.kind==='edge'">{{row.sourceCellId||'未连接'}} → {{row.targetCellId||'未连接'}}</small></td><td><select v-model="row.role" :disabled="mappingSubmitted" :aria-label="'元素用途 '+row.cellId" @change="mappingChanged"><option value="">请选择</option><option value="decoration">装饰</option><template v-if="row.kind==='vertex'"><option value="title">文档标题</option><option value="node">业务节点</option><option value="lane">角色</option><option value="phase">阶段</option><option value="group">业务分层</option></template><template v-else><option value="edge">业务连接</option><option value="parent-edge">脑图父子线</option></template></select></td><td><fieldset :disabled="mappingSubmitted" @input="mappingChanged" @change="mappingChanged"><template v-if="['node','edge','lane','phase','group'].includes(row.role)"><input v-model="row.businessId" placeholder="业务ID" :aria-label="'业务ID '+row.cellId"><input v-model="row.label" placeholder="可见名称" :aria-label="'名称 '+row.cellId"></template><template v-if="row.role==='node'"><select v-model="row.nodeKind" :aria-label="'节点类型 '+row.cellId"><option value="">选择节点类型</option><option v-for="kind in mappingNodeKinds" :key="kind" :value="kind">{{kind}}</option></select><input v-model="row.laneId" placeholder="角色ID"><input v-model="row.phaseId" placeholder="阶段ID"><input v-model="row.groupId" placeholder="分层ID"><input v-model="row.parentId" placeholder="父主题ID"></template><template v-if="row.role==='edge'"><input v-model="row.sourceId" placeholder="源业务ID"><input v-model="row.targetId" placeholder="目标业务ID"><select v-model="row.edgeKind"><option value="flow">业务流</option><option value="feedback">反馈</option></select></template><input v-if="row.role==='parent-edge'" v-model="row.childId" placeholder="子主题业务ID"><select v-if="row.role==='group'" v-model="row.groupKind"><option value="layer">普通分层</option><option value="governance">治理分层</option></select></fieldset></td></tr></tbody></table>
      <p v-if="mappingPreview">已校验 {{mappingPreview.nodes}} 个业务节点、{{mappingPreview.edges}} 条业务连接；质量 {{mappingPreview.quality.score}} 分{{mappingPreview.quality.passed?'':'（保留人工草稿问题）'}}。</p><p v-if="mappingSubmitted">转换结果未确认，请沿用同一请求重试，不要重复创建图形。</p>
      <button :disabled="!mappingEnabled||busy||mappingSubmitted" @click="previewMapping">校验属性</button><button v-if="mappingPreview" :disabled="busy" @click="confirmMapping">{{mappingSubmitted?'重试同一转换':'确认转换并新增修订'}}</button><button @click="downloadMapping">下载属性方案</button><button :disabled="busy||mappingSubmitted" @click="closeMapping">取消</button>
    </section>
    <div class="studio-workarea"><div class="studio-canvas-area">
      <div class="studio-toolbar" :inert="props.readOnly"><button class="studio-icon" title="撤销（Ctrl+Z）" aria-label="撤销" :disabled="busy||!ready" @click="nativeAction('undo')"><Icon name="undo" :size="17"/></button><button class="studio-icon" title="重做（Ctrl+Shift+Z）" aria-label="重做" :disabled="busy||!ready" @click="nativeAction('redo')"><Icon name="redo" :size="17"/></button><i class="studio-divider"/><button v-if="displayKind" class="studio-text-btn" :disabled="busy||!ready" @click="openProperties().then(()=>addNode())"><Icon name="plus" :size="16"/>{{displayKind==='architecture'?'模块':displayKind==='mindmap'?'主题':displayKind==='dataflow'?'卡片':'节点'}}</button><div class="studio-export-wrap" @click.stop><button class="studio-text-btn" :disabled="!ready||busy" @click="groupMenuOpen=!groupMenuOpen"><Icon name="group" :size="16"/>分组<Icon name="chevron" :size="12"/></button><div v-if="groupMenuOpen" class="studio-menu"><button @click="groupSelection()">分组选中元素（Ctrl+G）</button><button @click="groupSelection(true)">取消分组（Ctrl+Shift+G）</button></div></div><i class="studio-divider"/><button class="studio-text-btn" :disabled="!ready||busy" @click="nativeAction('fit')"><Icon name="layout" :size="16"/>适合画布</button><div class="studio-toolbar-end"><button v-if="displayKind" class="studio-text-btn" :disabled="!ready||busy||!layoutEnabled" @click="requestLayout()"><Icon name="layout" :size="16"/>自动排版</button><div v-if="displayKind" class="studio-direction-switch" role="group" aria-label="排版方向"><button :aria-pressed="orientation==='vertical'" title="纵向排版" :disabled="!ready||busy||!layoutEnabled||!!layoutConfirmation||!!pendingRendering" @click="requestLayout('vertical')"><Icon name="direction-vertical" :size="15"/><span>纵向</span></button><button :aria-pressed="orientation==='horizontal'" title="横向排版" :disabled="!ready||busy||!layoutEnabled||!!layoutConfirmation||!!pendingRendering" @click="requestLayout('horizontal')"><Icon name="direction-horizontal" :size="15"/><span>横向</span></button></div><button v-if="displayKind==='mindmap'" class="studio-text-btn" :disabled="busy||!ready||deletingBranch" @click="deleteCurrentBranch">删除当前分支</button><button v-if="displayMode==='canvas-only'" class="studio-text-btn" :disabled="busy||!ready" @click="openMapping">业务属性映射</button></div></div>
      <section class="native-editor native-studio-canvas" :inert="busy||mappingOpen||props.readOnly"><DrawioViewport ref="host" :appearance="appearance" :loading="viewportLoading" :collaboration="Boolean(props.collaborationUserId)" :session-key="sessionKey" :initial-x-m-l="initialXML" :title="title" @ready="hostReady" @xml="xml" @save-requested="requested" @error="hostError"><div class="native-empty">{{enabled?'选择图形，或创建/导入业务图形开始编辑':'在隔离数据目录启用 Native pilot 后可使用原生编辑器。'}}</div></DrawioViewport></section>
    </div><aside v-if="inspectorOpen" class="studio-inspector"><div class="studio-inspector-heading"><strong>节点属性</strong><button class="studio-icon" @click="inspectorOpen=false"><Icon name="close" :size="15"/></button></div><div class="studio-inspector-content" :inert="props.readOnly"><label v-if="!viewportLoading&&currentId" class="studio-field">图形所属分组<select aria-label="图形所属分组" :value="sidebar.assignments[currentId]||''" :disabled="busy" @change="sidebar.moveToWorkspaceGroup(currentId,($event.target as HTMLSelectElement).value||null)"><option value="">未分组</option><option v-for="group in sidebar.workspaceGroups" :key="group.id" :value="group.id">{{group.name}}</option></select></label><fieldset v-if="propertyContent" class="studio-inspector-fields" :disabled="busy" :style="{visibility:viewportLoading?'hidden':undefined}"><label class="studio-field">节点<select v-model="propertyId"><option value="">选择节点</option><option v-for="node in propertyContent.nodes" :key="node.id" :value="node.id">{{node.label||node.id}}</option></select></label><template v-if="propertyNode"><label class="studio-field">文字<textarea :key="propertyNode.id+propertyNode.label" :value="propertyNode.label" rows="3" @change="updateProperty('label',($event.target as HTMLTextAreaElement).value)"/></label><label class="studio-field">类型<select :value="propertyNode.kind" @change="updateProperty('kind',($event.target as HTMLSelectElement).value)"><option v-for="kind in propertyContent.kind==='architecture'?['module','note']:propertyContent.kind==='mindmap'?['topic','note']:propertyContent.kind==='dataflow'?['card','note']:['task','decision','start','end','note']" :key="kind" :value="kind">{{kind}}</option></select></label><template v-if="propertyContent.kind==='swimlane'"><label class="studio-field">所属泳道<select :value="propertyNode.laneId" @change="updateProperty('laneId',($event.target as HTMLSelectElement).value)"><option v-for="lane in propertyContent.lanes" :key="lane.id" :value="lane.id">{{lane.label}}</option></select></label><label class="studio-field">阶段<select :value="propertyNode.phaseId" @change="updateProperty('phaseId',($event.target as HTMLSelectElement).value)"><option v-for="phase in propertyContent.phases" :key="phase.id" :value="phase.id">{{phase.label}}</option></select></label></template><label v-if="propertyContent.kind==='architecture'" class="studio-field">所属分层<select :value="propertyNode.groupId" @change="updateProperty('groupId',($event.target as HTMLSelectElement).value)"><option v-for="group in propertyContent.groups" :key="group.id" :value="group.id">{{group.label}}</option></select></label><label v-if="propertyContent.kind==='mindmap'&&propertyNode.parentId" class="studio-field">父主题<select :value="propertyNode.parentId" @change="updateProperty('parentId',($event.target as HTMLSelectElement).value)"><option v-for="node in propertyContent.nodes.filter(n=>n.id!==propertyId)" :key="node.id" :value="node.id">{{node.label}}</option></select></label><label v-if="propertyContent.kind==='architecture'" class="studio-field">模块条目<textarea :value="propertyNode.items?.join('\n')||''" rows="5" @change="updateProperty('items',($event.target as HTMLTextAreaElement).value.split('\n').filter(s=>s.trim()))"/></label><label v-if="propertyContent.kind==='architecture'" class="studio-field">标记<input :value="propertyNode.badge||''" @change="updateProperty('badge',($event.target as HTMLInputElement).value)"/></label><label class="studio-field">说明<textarea :value="propertyNode.description||''" @change="updateProperty('description',($event.target as HTMLTextAreaElement).value)"/></label></template><button class="studio-secondary" @click="addNode"><Icon name="plus" :size="15"/>新增{{propertyContent.kind==='mindmap'?'子主题':'节点'}}</button><button v-if="pendingContent" class="studio-secondary" @click="applyContent([])">重试同一属性修改</button></fieldset><p v-else class="studio-property-empty">选择图形元素后查看属性。<button class="studio-text-btn" :disabled="busy||viewportLoading||!ready||!displayKind" @click="openProperties">读取属性</button></p></div></aside></div>
    </main>
    <div v-if="layoutConfirmation" class="studio-overlay" @click.self="layoutConfirmation=undefined"><section class="studio-dialog studio-group-dialog" role="dialog" aria-modal="true" aria-label="确认自动排版"><div class="studio-dialog-heading"><h2>自动排版</h2><button class="studio-icon" aria-label="关闭排版确认" @click="layoutConfirmation=undefined"><Icon name="close"/></button></div><p>自动排版会调整人工位置和连线折点，保留业务内容与配色。</p><div class="studio-dialog-actions"><button class="studio-secondary" @click="layoutConfirmation=undefined">取消</button><button class="studio-primary" :disabled="busy" @click="confirmLayout">确认排版</button></div></section></div>
    <div v-if="newOpen" class="studio-overlay" @click.self="newOpen=false"><section class="studio-dialog"><div class="studio-dialog-heading"><h2>新建图形</h2><button class="studio-icon" @click="newOpen=false" aria-label="关闭"><Icon name="close"/></button></div><div class="studio-type-grid"><button v-for="kind in supportedKinds" :key="kind" :aria-label="kindLabels[kind]" :disabled="busy" @click="createInGroup(kind)"><div aria-hidden="true" v-html="thumbnail(kind)"/><strong>{{kindLabels[kind]}}</strong></button></div><label class="studio-checkbox"><input v-model="useExample" type="checkbox"/>使用示例数据</label></section></div>
    <div v-if="recoveriesOpen" class="studio-overlay" @click.self="recoveriesOpen=false"><section class="studio-dialog studio-group-dialog"><div class="studio-dialog-heading"><h2>待恢复内容</h2><button class="studio-icon" @click="recoveriesOpen=false"><Icon name="close"/></button></div><article v-for="draft in drafts" :key="JSON.stringify(draftKey(draft))" class="studio-group-row"><span>{{items.find(i=>i.id===draft.diagramId)?.title||draft.diagramId}} · r{{draft.baseRevision}}</span><button :disabled="draft.dataRootId!==rootId||busy" @click="restore(draft);recoveriesOpen=false">恢复</button><button @click="download(recoveryDownload(draft))">下载</button><button @click="remove(draft)">移除</button></article><p v-if="!drafts.length">暂无待恢复内容</p></section></div>
    <NativeActivityDialog v-if="client" ref="activityDialog" :client="client" :diagrams="items" />
    <NativeImportDialog v-if="client" ref="importsDialog" :client="client" :groups="sidebarGroups" @changed="refreshList().catch(fail)" @open="openImported" @pending="importPending=$event" />
  </div>
</template>
<style scoped>
.studio-layout-direction{height:28px;border:1px solid #e1e5ed;border-radius:6px;background:#fff;color:#667286;font-size:11px;padding:2px 5px}.native-studio-canvas{flex:1;min-height:0;display:flex;flex-direction:column}.native-studio-canvas :deep(.drawio-host){flex:1;min-height:0}.native-type-preview{display:flex;align-items:center;justify-content:center;color:#8e86c9;background:#f2f1fa;height:120px}.native-import-review,.native-mapping-review{position:fixed;z-index:100;inset:10vh 12vw;background:white;border:1px solid #e4e8ef;border-radius:12px;padding:24px;overflow:auto;box-shadow:0 15px 80px #26334944}
</style>
