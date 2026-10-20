import {StoreError,type DiagramStore} from '../store'
import {canonicalContentJson} from '../../src/drawing/engine/content-hash'
import {validateNativeProject,nativeIdentity,isCanvasRecord} from '../document-record'
import {isNativeCanvasProject} from '../../src/drawing/engine/native-canvas'
import {exportSnapshotHash,readNativeArtifact,sha256} from '../exports/artifacts'
import {EXPORT_FORMATS,nativeExportFormats,type NativeExportJob,type NativeExportOptions,type NativeExportFormat,type StoredNativeExport} from '../exports/types'
import type {CloudReleaseManifest} from '../cloud/mcp-compat'

function exact(input:unknown,allowed:string[],required:string[]){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new StoreError('导出请求应为 JSON 对象')
  const value=structuredClone(input) as Record<string,any>
  for(const key of Object.keys(value))if(!allowed.includes(key))throw new StoreError('导出请求不接受字段：'+key)
  for(const key of required)if(value[key]===undefined)throw new StoreError('导出请求缺少字段：'+key)
  return value
}
function requestId(value:unknown){if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(value))throw new StoreError('requestId 格式无效');return value}
export function validateNativeExportOptions(input:unknown):NativeExportOptions{
  if(input===undefined)return {}
  const value=exact(input,['background','scale'],[])
  if(value.scale!==undefined&&(typeof value.scale!=='number'||!Number.isFinite(value.scale)||value.scale<0.1||value.scale>4))throw new StoreError('导出 scale 需要 0.1–4 的有限数值',400,undefined,'EXPORT_OPTIONS_INVALID')
  if(value.background!==undefined&&!['white','transparent'].includes(value.background))throw new StoreError('导出 background 仅接受 white/transparent',400,undefined,'EXPORT_OPTIONS_INVALID')
  return value
}
export class NativeExportService {
  constructor(readonly store:DiagramStore,readonly enabled=false,private readonly release?:Promise<CloudReleaseManifest>){}
  private available(){if(!this.enabled)throw new StoreError('Native pilot 未启用',404,undefined,'NATIVE_PILOT_DISABLED')}
  private public(job:StoredNativeExport,currentRevision:number):NativeExportJob{
    const manifest=job.manifest
    return {id:job.id,diagramId:job.diagramId,dataRootId:job.dataRootId,revision:job.revision,status:job.status,createdAt:job.createdAt,updatedAt:job.updatedAt,attempts:job.attempts,...(job.sourceJobId?{sourceJobId:job.sourceJobId}:{}),isCurrentRevision:currentRevision===job.revision,snapshotSha256:job.snapshotSha256,...(isNativeCanvasProject(job.snapshot)?{mode:'canvas-only' as const,xmlHash:job.snapshot.rendering.engine.xmlHash}:{contentHash:job.snapshot.rendering.engine.contentHash}),documentCreatedAt:job.snapshot.createdAt,documentUpdatedAt:job.snapshot.updatedAt,options:job.options,...(job.release?{release:job.release}:{}),...(job.error?{error:job.error}:{}),...(manifest&&job.status==='succeeded'?{exportedAt:manifest.exportedAt,width:manifest.width,height:manifest.height,scale:manifest.scale,files:Object.fromEntries(nativeExportFormats(job.snapshot).map(format=>[format,{...manifest.files[format],url:`/studio-api/native/exports/${job.id}/files/${format}`}])) as NonNullable<NativeExportJob['files']>}:{})}
  }
  async get(jobId:string){this.available();const {job,currentRevision}=await this.store.getNativeExport(jobId);return this.public(job,currentRevision)}
  async create(diagramId:string,input:unknown,expectedDataRootId:string|undefined){
    this.available();this.store.id(diagramId)
    if(!expectedDataRootId)throw new StoreError('缺少工作区身份',409,undefined,'WORKSPACE_MISMATCH')
    const value=exact(input,['expectedRevision','requestId','options'],['expectedRevision','requestId'])
    if(!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<1)throw new StoreError('expectedRevision 必须为正整数')
    const key=requestId(value.requestId),options=validateNativeExportOptions(value.options),hash=sha256(canonicalContentJson({operation:'native-export',diagramId,input:value} as any))
    const replay=await this.store.findNativeExportRequest(key,hash,expectedDataRootId)
    if(replay)return this.get(replay.id)
    const base=await this.store.getNativeDrawing(diagramId)
    if(base.revision!==value.expectedRevision)throw new StoreError('图形已有新的修改，请先保存',409,base.revision,'REVISION_CONFLICT')
    const snapshot=await validateNativeProject(base.document)
    const job=await this.store.enqueueNativeExport({diagramId,expectedRevision:value.expectedRevision,expectedDataRootId,requestId:key,requestHash:hash,options,snapshot,snapshotSha256:exportSnapshotHash(snapshot),...(this.release?{release:await this.release}:{})})
    return this.get(job.id)
  }
  async retry(jobId:string,input:unknown,expectedDataRootId:string|undefined){
    this.available()
    if(!expectedDataRootId)throw new StoreError('缺少工作区身份',409,undefined,'WORKSPACE_MISMATCH')
    const value=exact(input,['requestId'],['requestId']),key=requestId(value.requestId),hash=sha256(canonicalContentJson({operation:'native-export-retry',jobId,input:value} as any))
    const replay=await this.store.findNativeExportRequest(key,hash,expectedDataRootId)
    if(replay)return this.get(replay.id)
    const {job:source}=await this.store.getNativeExport(jobId)
    if(this.release&&!source.release)throw new StoreError('旧任务没有固定供应标识，请为当前图形创建新导出',503,undefined,'EXPORT_RELEASE_UNKNOWN')
    if(source.dataRootId!==expectedDataRootId)throw new StoreError('工作区身份已改变',409,undefined,'WORKSPACE_MISMATCH')
    if(source.status!=='failed')throw new StoreError('仅失败任务可显式重试',409,undefined,'EXPORT_RETRY_INVALID')
    const snapshot=await validateNativeProject(source.snapshot)
    const job=await this.store.enqueueNativeExport({diagramId:source.diagramId,expectedRevision:source.revision,expectedDataRootId,requestId:key,requestHash:hash,options:source.options,snapshot,snapshotSha256:source.snapshotSha256,sourceJobId:source.id,...(source.release?{release:source.release}:{})})
    return this.get(job.id)
  }
  async createSnapshot(diagramId:string,input:unknown,expectedDataRootId:string|undefined){
    this.available();this.store.id(diagramId)
    if(!expectedDataRootId)throw new StoreError('缺少工作区身份',409,undefined,'WORKSPACE_MISMATCH')
    const value=exact(input,['revision','requestId','options'],['revision','requestId'])
    if(!Number.isSafeInteger(value.revision)||value.revision<1)throw new StoreError('revision必须为正整数')
    const key=requestId(value.requestId),options=validateNativeExportOptions(value.options),hash=sha256(canonicalContentJson({operation:'native-export-snapshot',diagramId,input:value} as any)),replay=await this.store.findNativeExportRequest(key,hash,expectedDataRootId)
    if(replay)return this.get(replay.id)
    const history=await this.store.getNativeDrawingRevision(diagramId,value.revision),snapshot=await validateNativeProject(history.document)
    const job=await this.store.enqueueNativeExport({diagramId,expectedRevision:value.revision,expectedDataRootId,requestId:key,requestHash:hash,options,snapshot,snapshotSha256:exportSnapshotHash(snapshot),historical:true,...(this.release?{release:await this.release}:{})})
    return this.get(job.id)
  }
  async file(jobId:string,format:string){
    this.available()
    if(!EXPORT_FORMATS.includes(format as NativeExportFormat))throw new StoreError('不支持的导出制品格式',404,undefined,'EXPORT_FORMAT_NOT_FOUND')
    const {job}=await this.store.getNativeExport(jobId)
    try{return await readNativeArtifact(this.store.root,job,format as NativeExportFormat)}catch(error){if(error instanceof StoreError)throw error;throw new StoreError('导出文件无法验证，请重新导出',500,undefined,'EXPORT_ARTIFACT_CORRUPT')}
  }
  /** Authenticated local delivery only; public job metadata deliberately has no paths. */
  async delivery(jobId:string){
    const job=await this.get(jobId),files:Record<string,string>={}
    if(job.status!=='succeeded'||!job.files)throw new StoreError('导出尚未成功，不能交付文件',409,undefined,'EXPORT_NOT_READY')
    for(const format of Object.keys(job.files??{}))files[format]=(await this.file(jobId,format)).path
    return {jobId:job.id,diagramId:job.diagramId,revision:job.revision,dataRootId:job.dataRootId,files}
  }
  async snapshot(jobId:string){
    this.available()
    const {job,currentRevision}=await this.store.getNativeExport(jobId),project=await validateNativeProject(job.snapshot),current=await this.store.getNativeDrawing(job.diagramId)
    return {format:3,...(isNativeCanvasProject(project)?{mode:'canvas-only' as const,id:project.id,title:project.title}:{content:project.content}),revision:job.revision,createdAt:project.createdAt,updatedAt:project.updatedAt,workspaceGroupId:current.workspaceGroupId,currentRevision,isCurrentRevision:currentRevision===job.revision}
  }
}
