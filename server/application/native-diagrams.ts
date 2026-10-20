import {createHash} from 'node:crypto'
import {DiagramStore,StoreError,PROJECT_ROOT,type NativeMutation} from '../store'
import {isCanvasRecord,validateNativeProject,type NativeDiagramRecord,type NativeDrawingRecord,type StoredDiagramRecord} from '../document-record'
import {createNativeCanvasProject,mapNativeCanvas,inspectNativeCanvasCells} from '../../src/drawing/engine/native-canvas'
import {nativeDocumentCapabilities} from '../../src/drawing/services/native-capabilities'
import {assertIsolatedNativeRoot,workspaceDataRootId} from '../native-pilot'
import type {DiagramContent} from '../../src/drawing/core/model'
import type {DiagramOperation} from '../../src/drawing/core/operations'
import {validateContent,extractContent,composeDocument,applyContentOperations} from '../../src/drawing/core/layers'
import {canonicalContentJson} from '../../src/drawing/engine/content-hash'
import {createDrawingProject,validateDrawingProject} from '../../src/drawing/engine/project'
import {compileDrawio,patchDrawio} from '../../src/drawing/engine/drawio'
import {inspectDrawing,type EditIntent} from '../../src/drawing/core/drawing-quality'
import {requireNativeAIQuality} from './native-quality'
import {diffNativeContent} from './native-content-diff'
import {defaultProfileForKind,drawioCapabilities} from '../../src/drawing/engine/profiles'
import type {DrawioRenderingChanges,DrawioConfigureResult,DrawingProjectV3} from '../../src/drawing/engine/types'

type Input=Record<string,any>
function exact(input:unknown,allowed:string[],required:string[]):Input {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new StoreError('请求应为 JSON 对象')
  const value=structuredClone(input) as Input
  for(const key of Object.keys(value))if(!allowed.includes(key))throw new StoreError('请求不接受字段：'+key)
  for(const key of required)if(!Object.hasOwn(value,key)||value[key]===undefined)throw new StoreError('缺少字段：'+key)
  return value
}
function revision(value:unknown){if(!Number.isSafeInteger(value)||Number(value)<1)throw new StoreError('expectedRevision 必须为正整数');return value as number}
function mutation(operation:NativeMutation['operation'],id:string,input:Input,expectedDataRootId?:string):NativeMutation {
  if(typeof input.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(input.requestId))throw new StoreError('requestId 需要 1–128 位字母、数字、短横线或下划线')
  const requestHash=createHash('sha256').update(canonicalContentJson({operation,id,input} as unknown as DiagramContent)).digest('hex')
  return {requestId:input.requestId,requestHash,operation,...(expectedDataRootId!==undefined?{expectedDataRootId}:{})}
}

export class NativeDiagramService {
  readonly dataRootId:string|undefined
  constructor(readonly store:DiagramStore,readonly enabled=false){if(enabled){assertIsolatedNativeRoot(store.root,PROJECT_ROOT);this.dataRootId=workspaceDataRootId(store.nativeWorkspaceId(true)!)}}
  private available(){if(!this.enabled)throw new StoreError('Native pilot 未启用',404,undefined,'NATIVE_PILOT_DISABLED')}
  assertWorkspaceIdentity(expected:string|undefined){const workspaceId=this.store.nativeWorkspaceId(false);if(!expected||!workspaceId||workspaceDataRootId(workspaceId)!==expected)throw new StoreError('工作区身份缺失或已改变，请保留本机草稿',409,undefined,'WORKSPACE_MISMATCH')}
  private expected(record:{revision:number},expected:number){if(record.revision!==expected)throw new StoreError('图形已有新的修改',409,record.revision,'REVISION_CONFLICT')}
  async create(input:unknown,expectedDataRootId?:string):Promise<NativeDiagramRecord>{
    return this.createWithPolicy(input,expectedDataRootId,false)
  }
  async createAI(input:unknown,expectedDataRootId?:string):Promise<NativeDiagramRecord>{return this.createWithPolicy(input,expectedDataRootId,true)}
  private async createWithPolicy(input:unknown,expectedDataRootId:string|undefined,ai:boolean):Promise<NativeDiagramRecord>{
    this.available()
    const value=exact(input,['content','profile','preferences','workspaceGroupId','requestId'],['content','requestId'])
    if(value.content?.schemaVersion!==1||typeof value.content?.id!=='string')throw new StoreError('content 必须提供 schemaVersion:1 和稳定 id')
    this.store.id(value.content.id)
    if(value.workspaceGroupId!==undefined&&value.workspaceGroupId!==null&&typeof value.workspaceGroupId!=='string')throw new StoreError('workspaceGroupId 无效')
    const m=mutation(ai?'ai-create':'create',value.content.id,value,expectedDataRootId),replay=await this.store.replayNative(m)
    if(replay)return replay
    const content=validateContent(value.content)
    if(ai){this.supportedAI(content);requireNativeAIQuality(content)}
    if(!drawioCapabilities().supportedKinds.includes(content.kind))throw new StoreError('此原生类型尚未适配',422,undefined,'NATIVE_KIND_UNSUPPORTED')
    const profile=value.profile??defaultProfileForKind(content.kind)
    const engine=await compileDrawio(content,{profile,preferences:value.preferences})
    const project=await createDrawingProject(content,engine,{profile,preferences:value.preferences})
    return this.store.createNative(project,value.workspaceGroupId??null,m)
  }
  async get(id:string){this.available();const record=await this.store.getNative(id);record.document=await validateDrawingProject(record.document);return record}
  async getDrawing(id:string){this.available();const record=await this.store.getNativeDrawing(id);record.document=await validateNativeProject(record.document);return record}
  async list(){this.available();return this.store.listMetadata()}
  async workspace(){this.available();return this.store.snapshotStored()}
  private contentRecord(record:StoredDiagramRecord){if(record.format===3&&isCanvasRecord(record))return {format:3,mode:'canvas-only' as const,id:record.document.id,title:record.document.title,revision:record.revision,savedAt:record.savedAt,createdAt:record.createdAt,updatedAt:record.document.updatedAt,workspaceGroupId:record.workspaceGroupId,readOnly:false,syncStatus:'canvas-only' as const};const content=record.format===3?record.document.content:extractContent(record.document);return {format:record.format,content,revision:record.revision,savedAt:record.savedAt,createdAt:record.createdAt,updatedAt:record.document.updatedAt,workspaceGroupId:record.workspaceGroupId,quality:inspectDrawing(content),readOnly:record.format===2,syncStatus:record.format===3?'synced':'legacy-readonly'}}
  private async synchronizedRecord(record:StoredDiagramRecord){if(record.format===3)record.document=await validateNativeProject(record.document);return this.contentRecord(record)}
  async readContent(id:string){this.available();return this.synchronizedRecord(await this.store.getStored(id))}
  async listRecords(){this.available();return Promise.all((await this.store.listStored()).map(record=>this.synchronizedRecord(record)))}
  async groups(){this.available();return this.store.listGroups()}
  async trash(){this.available();return this.store.listTrash()}
  async organize(action:string,id:string|undefined,input:unknown,expectedDataRootId:string|undefined){
    this.available();this.assertWorkspaceIdentity(expectedDataRootId)
    if(action==='create-group'){const value=exact(input,['name'],['name']);return {group:await this.store.createGroup(value.name,expectedDataRootId)}}
    if(action==='rename-group'){const value=exact(input,['name','expectedRevision'],['name','expectedRevision']);return {group:await this.store.updateGroup(id!,revision(value.expectedRevision),value.name,expectedDataRootId)}}
    if(action==='delete-group'){const value=exact(input,['expectedRevision'],['expectedRevision']);await this.store.deleteGroup(id!,revision(value.expectedRevision),expectedDataRootId);return {success:true}}
    if(action==='move'){const value=exact(input,['workspaceGroupId','expectedWorkspaceGroupId'],['workspaceGroupId','expectedWorkspaceGroupId']);for(const key of ['workspaceGroupId','expectedWorkspaceGroupId'])if(value[key]!==null&&typeof value[key]!=='string')throw new StoreError('分组ID无效');await this.store.moveStoredToGroup(id!,value.workspaceGroupId,value.expectedWorkspaceGroupId,expectedDataRootId);return this.readContent(id!)}
    if(action==='delete'){const value=exact(input,['expectedRevision'],['expectedRevision']);await this.store.delete(id!,revision(value.expectedRevision),expectedDataRootId);return {success:true}}
    if(action==='restore'||action==='purge'){const value=exact(input,['expectedRevision','deletedAt'],['expectedRevision','deletedAt']);if(!Number.isFinite(value.deletedAt)||value.deletedAt<=0)throw new StoreError('deletedAt无效');if(action==='restore'){await this.store.restoreStored(id!,revision(value.expectedRevision),value.deletedAt,expectedDataRootId);return this.readContent(id!)}await this.store.purge(id!,revision(value.expectedRevision),value.deletedAt,expectedDataRootId);return {success:true}}
    throw new StoreError('未知组织操作')
  }
  private supportedAI(content:DiagramContent){if(!drawioCapabilities().supportedKinds.includes(content.kind))throw new StoreError('此原生类型尚未适配，请读取当前能力表',422,undefined,'NATIVE_KIND_UNSUPPORTED')}
  async rendering(id:string){const record=await this.get(id),e=record.document.rendering.engine,capability=drawioCapabilities().profiles.find(p=>p.kind===record.document.content.kind)!;return {record,rendering:{profile:record.document.rendering.profile,preferences:record.document.rendering.preferences,engine:{name:e.name,version:e.version,adapterVersion:e.adapterVersion,contentHash:e.contentHash}},capabilities:capability}}
  async configureRendering(id:string,input:unknown,expectedDataRootId?:string){
    this.available();this.store.id(id)
    const value=exact(input,['rendering','expectedRevision','requestId'],['rendering','expectedRevision','requestId']),expected=revision(value.expectedRevision)
    const m=mutation('configure-rendering',id,value,expectedDataRootId),replay=await this.store.replayNative(m);if(replay)return replay
    const base=await this.get(id);this.expected(base,expected)
    const capability=drawioCapabilities().profiles.find(p=>p.kind===base.document.content.kind)
    if(!capability?.configureRendering)throw new StoreError('此profile尚未支持实际渲染配置修改',422,undefined,'NATIVE_RENDERING_EDIT_UNSUPPORTED')
    const module=await import('../../src/drawing/engine/drawio') as unknown as {configureDrawio?:(base:DrawingProjectV3,changes:DrawioRenderingChanges)=>Promise<DrawioConfigureResult>}
    if(!module.configureDrawio)throw new StoreError('实际配置引擎未就绪',422,undefined,'NATIVE_RENDERING_EDIT_UNSUPPORTED')
    const configured=await module.configureDrawio(base.document,value.rendering),candidate=await validateDrawingProject({...base.document,rendering:{profile:configured.profile,preferences:configured.preferences,engine:configured.engine}})
    if(canonicalContentJson(candidate.content)!==canonicalContentJson(base.document.content))throw new StoreError('渲染配置改变了业务内容，未提交',400,undefined,'CONTENT_DIFF_MISMATCH')
    return this.store.commitNative(id,expected,candidate,m)
  }
  async validateAI(input:unknown){this.available();if((input as any)?.schemaVersion!==1||typeof(input as any)?.id!=='string')throw new StoreError('content 必须提供 schemaVersion:1 和稳定 id');const content=validateContent(input);this.supportedAI(content);const quality=inspectDrawing(content);if(quality.passed)await compileDrawio(content);return {valid:quality.passed,quality,nodes:content.nodes.length,edges:content.edges.length}}
  async patchAI(id:string,input:unknown,expectedDataRootId?:string){return this.changeAI(id,input,expectedDataRootId,false)}
  async updateAI(id:string,input:unknown,expectedDataRootId?:string){return this.changeAI(id,input,expectedDataRootId,true)}
  private async changeAI(id:string,input:unknown,expectedDataRootId:string|undefined,full:boolean){
    this.available();this.store.id(id)
    const value=exact(input,full?['content','expectedRevision','requestId','editIntent']:['operations','expectedRevision','requestId','editIntent'],full?['content','expectedRevision','requestId']:['operations','expectedRevision','requestId'])
    const expected=revision(value.expectedRevision),intent=(value.editIntent??'structure') as EditIntent
    if(!['structure','wording','annotation'].includes(intent))throw new StoreError('editIntent无效')
    // Hash the effective intent and distinguish AI/manual/full/patch receipts.
    value.editIntent=intent
    const m=mutation(full?'ai-content-update':'ai-content-patch',id,value,expectedDataRootId),replay=await this.store.replayNative(m)
    if(replay)return replay
    const base=await this.get(id);this.expected(base,expected);this.supportedAI(base.document.content)
    let operations:DiagramOperation[],intended:DiagramContent|undefined
    if(full){if(value.content?.schemaVersion!==1||typeof value.content?.id!=='string')throw new StoreError('content 必须提供 schemaVersion:1 和稳定 id');intended=validateContent(value.content);this.supportedAI(intended);operations=diffNativeContent(base.document.content,intended)}
    else {if(!Array.isArray(value.operations)||!value.operations.length||value.operations.length>500)throw new StoreError('operations需要1–500项');operations=value.operations}
    // Quality must reject invalid semantic edits before they reach layout/routing.
    const proposed=intended??extractContent(applyContentOperations(composeDocument(base.document.content),operations))
    requireNativeAIQuality(proposed,base.document.content,intent)
    const engine=operations.length?await patchDrawio(base.document,operations):base.document.rendering.engine
    const projection=await import('../../src/drawing/engine/drawio').then(module=>module.projectDrawio(engine.xml,base.document.content))
    if(intended){const semantic=(c:DiagramContent)=>({...c,nodes:[...c.nodes].sort((a,b)=>a.id.localeCompare(b.id)),edges:[...c.edges].sort((a,b)=>a.id.localeCompare(b.id))});if(canonicalContentJson(semantic(projection.content))!==canonicalContentJson(semantic(intended)))throw new StoreError('完整更新投影与目标业务内容不符，未提交',400,undefined,'CONTENT_DIFF_MISMATCH')}
    requireNativeAIQuality(projection.content,base.document.content,intent)
    const candidate=await validateDrawingProject({...base.document,content:projection.content,rendering:{...base.document.rendering,engine}})
    return this.store.commitNative(id,expected,candidate,m)
  }
  async saveEditor(id:string,input:unknown,expectedDataRootId?:string):Promise<NativeDrawingRecord>{
    this.available();this.store.id(id)
    const value=exact(input,['xml','expectedRevision','requestId'],['xml','expectedRevision','requestId'])
    const expected=revision(value.expectedRevision)
    if(typeof value.xml!=='string'||!value.xml.trim()||Buffer.byteLength(value.xml)>4_000_000)throw new StoreError('xml 不能为空或超过 4 MB')
    const m=mutation('editor-save',id,value,expectedDataRootId),replay=await this.store.replayNativeDrawing(m)
    if(replay)return replay
    const base=await this.store.getNativeDrawing(id);this.expected(base,expected)
    if(isCanvasRecord(base)){const candidate=await createNativeCanvasProject(value.xml,{id:base.document.id,title:base.document.title,createdAt:base.document.createdAt,updatedAt:base.document.updatedAt});return this.store.commitNativeDrawing(id,expected,candidate,m)}
    const {normalizeDrawioEdits}=await import('../../src/drawing/engine/drawio')
    const normalized=await normalizeDrawioEdits(value.xml,base.document)
    const candidate=await validateDrawingProject({...base.document,content:normalized.content,rendering:{...base.document.rendering,engine:{...base.document.rendering.engine,xml:normalized.xml,contentHash:normalized.contentHash}}})
    return this.store.commitNative(id,expected,candidate,m)
  }
  async mapCanvas(id:string,input:unknown,expectedDataRootId?:string){
    this.available();this.store.id(id)
    const value=exact(input,['mapping','expectedRevision','requestId'],['mapping','expectedRevision','requestId']),expected=revision(value.expectedRevision),m=mutation('canvas-map',id,value,expectedDataRootId),replay=await this.store.replayNativeDrawing(m)
    if(replay)return replay
    if(!nativeDocumentCapabilities().imports.canvasOnly)throw new StoreError('仅画布业务映射尚未启用',422,undefined,'NATIVE_CANVAS_UNSUPPORTED')
    const base=await this.getDrawing(id);this.expected(base,expected)
    if(!isCanvasRecord(base))throw new StoreError('此图已经是业务文档',409,base.revision,'NATIVE_MODE_MISMATCH')
    const candidate=await validateDrawingProject(await mapNativeCanvas(base.document,value.mapping))
    if(candidate.content.id!==id||candidate.createdAt!==base.createdAt)throw new StoreError('业务映射改变了原文档身份',400,undefined,'NATIVE_MAPPING_INVALID')
    return this.store.commitNativeDrawing(id,expected,candidate,m)
  }
  async canvasMappingCells(id:string){const base=await this.getDrawing(id);if(!isCanvasRecord(base))throw new StoreError('此图已有业务映射',409,base.revision,'NATIVE_MODE_MISMATCH');return {id,title:base.document.title,revision:base.revision,cells:await inspectNativeCanvasCells(base.document),enabled:nativeDocumentCapabilities().imports.canvasOnly}}
  async previewCanvasMapping(id:string,input:unknown){
    if(!nativeDocumentCapabilities().imports.canvasOnly)throw new StoreError('仅画布业务映射尚未启用',422,undefined,'NATIVE_CANVAS_UNSUPPORTED')
    const value=exact(input,['mapping','expectedRevision'],['mapping','expectedRevision']),base=await this.getDrawing(id);this.expected(base,revision(value.expectedRevision));if(!isCanvasRecord(base))throw new StoreError('此图已有业务映射',409,base.revision,'NATIVE_MODE_MISMATCH');const project=await validateDrawingProject(await mapNativeCanvas(base.document,value.mapping));return {revision:base.revision,kind:project.content.kind,nodes:project.content.nodes.length,edges:project.content.edges.length,quality:inspectDrawing(project.content)}
  }
  async patchContent(id:string,input:unknown,expectedDataRootId?:string):Promise<NativeDiagramRecord>{
    this.available();this.store.id(id)
    const value=exact(input,['operations','expectedRevision','requestId'],['operations','expectedRevision','requestId'])
    const expected=revision(value.expectedRevision)
    if(!Array.isArray(value.operations)||!value.operations.length||value.operations.length>500)throw new StoreError('operations 需要 1–500 项')
    const m=mutation('content-patch',id,value,expectedDataRootId),replay=await this.store.replayNative(m)
    if(replay)return replay
    const base=await this.store.getNative(id);this.expected(base,expected)
    const engine=await patchDrawio(base.document,value.operations as DiagramOperation[])
    const projection=await import('../../src/drawing/engine/drawio').then(module=>module.projectDrawio(engine.xml,base.document.content))
    const candidate=await validateDrawingProject({...base.document,content:projection.content,rendering:{...base.document.rendering,engine}})
    return this.store.commitNative(id,expected,candidate,m)
  }
}
