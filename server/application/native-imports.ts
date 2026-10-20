import {NativeDiagramService} from './native-diagrams'
import {StoreError,type NativeMutation} from '../store'
import {validateImportInput,importIdentity,sourceSha,prepareImportSource,readImportSource,type NativeImportSource} from '../imports/source'
import {validateContent} from '../../src/drawing/core/layers'
import {validateImportItem,importItemKey,type ImportCommitPlan,type ImportItemResult,type ImportFingerprint} from '../imports/batch'
import {nativeStateSignature} from '../../src/drawing/engine/collaboration/state'
import {nativeCanvasRenderSignature} from '../../src/drawing/engine/native-canvas'
import {canonicalContentJson} from '../../src/drawing/engine/content-hash'
import {compileDrawio} from '../../src/drawing/engine/drawio'
import {createDrawingProject,validateDrawingProject} from '../../src/drawing/engine/project'
import {inspectNativeImport,createNativeCanvasProject,rebindNativeProject,isNativeCanvasProject,validateNativeProject} from '../../src/drawing/engine/native-canvas'
import {previewLegacyMigration,convertLegacyMigration} from '../../src/drawing/engine/migration'
import {defaultProfileForKind,drawioCapabilities} from '../../src/drawing/engine/profiles'
import {nativeDocumentCapabilities} from '../../src/drawing/services/native-capabilities'
import {DRAWIO_VERSION,DRAWIO_ADAPTER_VERSION} from '../../src/drawing/engine/constants'
import type {NativeDrawingProject} from '../../src/drawing/engine/types'
import {inspectDrawing} from '../../src/drawing/core/drawing-quality'
import {nativeIdentity,type NativeDrawingRecord} from '../document-record'
/** Manual file import preserves structural drafts; it is not AI quality admission. */
export class NativeImportService {
 constructor(readonly diagrams:NativeDiagramService){}
 private async result(record:NativeDrawingRecord){const source=await this.diagrams.store.nativeImportSource(nativeIdentity(record.document).id);await readImportSource(this.diagrams.store.root,source);return {...record,...(!isNativeCanvasProject(record.document)?{quality:inspectDrawing(record.document.content)}:{}),import:{format:source.format,sourceSha256:source.sha256,sourceDocumentId:source.sourceDocumentId,bytes:source.bytes}}}
 private async prepare(input:unknown,expectedDataRootId:string|undefined){
  if(!this.diagrams.enabled)throw new StoreError('Native pilot未启用',404,undefined,'NATIVE_PILOT_DISABLED')
  this.diagrams.assertWorkspaceIdentity(expectedDataRootId)
  const parsed=validateImportInput(input),{diagramId,importId}=importIdentity(expectedDataRootId!,parsed.input.requestId)
  const mutation:NativeMutation={operation:parsed.input.format==='content'?'import-content':parsed.input.format==='drawio'?'import-drawio':'import-project',requestId:parsed.input.requestId,expectedDataRootId,requestHash:sourceSha(canonicalContentJson({operation:'manual-business-file-import',format:parsed.input.format,sourceSha256:parsed.sha256,diagramId,...(parsed.input.title!==undefined?{title:parsed.input.title}:{}),...(parsed.input.workspaceGroupId!==undefined?{workspaceGroupId:parsed.input.workspaceGroupId}:{})} as any))}
  return {parsed,diagramId,importId,mutation}
 }
 private async project(parsed:ReturnType<typeof validateImportInput>,diagramId:string){
  const raw=parsed.document as any;let project:NativeDrawingProject,format:NativeImportSource['format'],sourceDocumentId:string|undefined,diagnostics:unknown[]=[]
  if(parsed.input.format==='content'){
   if(raw?.schemaVersion!==1||typeof raw?.id!=='string')throw new StoreError('纯content必须提供schemaVersion:1及源id',400,undefined,'IMPORT_FORMAT_UNSUPPORTED')
   const content=validateContent(raw);sourceDocumentId=content.id;content.id=diagramId
   if(!drawioCapabilities().supportedKinds.includes(content.kind))throw new StoreError('此类型尚未适配',422,undefined,'NATIVE_KIND_UNSUPPORTED')
   const profile=defaultProfileForKind(content.kind),engine=await compileDrawio(content,{profile});project=await createDrawingProject(content,engine,{profile});format='content-json'
  }else if(parsed.input.format==='drawio'){
   const inspected=await inspectNativeImport(raw)
   if(inspected.status==='invalid')throw new StoreError('原生文件损坏、超限或含无法同步的业务元数据：'+inspected.diagnostics.map(d=>d.code).join(','),422,undefined,'IMPORT_NATIVE_INVALID')
   if(inspected.status==='business'){const projection=inspected.projection;sourceDocumentId=projection.content.id;project=await createDrawingProject(projection.content,{name:'drawio',version:DRAWIO_VERSION,adapterVersion:DRAWIO_ADAPTER_VERSION,xml:projection.xml,contentHash:projection.contentHash});project=await rebindNativeProject(project,diagramId);format='drawio-business';diagnostics=projection.diagnostics}
   else {const now=Date.now();project=await createNativeCanvasProject(inspected.xml,{id:diagramId,title:parsed.input.title??'导入画布',createdAt:now,updatedAt:now});format='drawio-canvas'}
  }else{
   if(raw?.schemaVersion===3){project=await validateNativeProject(raw);format=isNativeCanvasProject(project)?'project-canvas':'project-v3'}
   else if(raw?.schemaVersion===2){const preview=await previewLegacyMigration(raw);if(preview.status!=='ready')throw new StoreError('旧项目存在无法无损映射项，未导入：'+preview.diagnostics.filter(d=>d.severity==='blocking').map(d=>d.code).join(','),422,undefined,'IMPORT_MIGRATION_BLOCKED');const converted=await convertLegacyMigration(raw,{expectedSourceHash:preview.sourceHash});if(!converted.project)throw new StoreError('旧项目转换未完成',422,undefined,'IMPORT_MIGRATION_BLOCKED');project=converted.project;format='project-v2';diagnostics=converted.diagnostics}
   else throw new StoreError('仅接受单图v2/v3完整project，工作区备份须走维护恢复',400,undefined,'IMPORT_FORMAT_UNSUPPORTED')
   sourceDocumentId=nativeIdentity(project).id;project=await rebindNativeProject(project,diagramId)
  }
  if(Buffer.byteLength(project.rendering.engine.xml)>4_000_000)throw new StoreError('导入后XML超过4,000,000字节预算',413,undefined,'IMPORT_TOO_LARGE')
  return {project,format,sourceDocumentId,diagnostics}
 }
 private async fingerprint(parsed:ReturnType<typeof validateImportInput>,resolved:Awaited<ReturnType<NativeImportService['project']>>):Promise<ImportFingerprint>{
  const project=resolved.project,canvas=isNativeCanvasProject(project),sourceId=resolved.sourceDocumentId
  const normalized=sourceId?await rebindNativeProject(project,sourceId):project
  return {rawSha256:parsed.sha256,complete:parsed.input.format!=='content',...(sourceId?{sourceKey:sourceSha((canvas?'canvas:':'business:')+sourceId)}:{}),...(!isNativeCanvasProject(normalized)?{contentHash:sourceSha(canonicalContentJson(normalized.content))}:{}),...(parsed.input.format!=='content'?{renderHash:sourceSha(canvas?canonicalContentJson({signature:nativeCanvasRenderSignature(normalized.rendering.engine.xml),title:nativeIdentity(normalized).title} as any):nativeStateSignature(normalized.rendering.engine.xml))}:{})}
 }
 private item(input:unknown,root:string|undefined){
  const item=validateImportItem(input)
  if(!root)throw new StoreError('缺少工作区身份',409,undefined,'WORKSPACE_MISMATCH')
  const single={...item.source,requestId:importItemKey(root,item.batchId,item.itemId),workspaceGroupId:'groupId'in item.target?item.target.groupId:null}
  return {item,single}
 }
 async previewItem(input:unknown,root:string|undefined){const {item,single}=this.item(input,root),preview=await this.preview(single,root);return {...preview,batchId:item.batchId,itemId:item.itemId,target:item.target}}
 async commitItem(input:unknown,root:string|undefined):Promise<ImportItemResult>{
  const {item,single}=this.item(input,root)
  const record=await this.importPrepared(single,root,{id:item.batchId,itemId:item.itemId,target:item.target},item.requestId)
  return {batchId:item.batchId,itemId:item.itemId,status:nativeIdentity(record.document).id===importIdentity(root!,single.requestId).diagramId?'imported':'duplicate',record}
 }
 async preview(input:unknown,expectedDataRootId:string|undefined){
  const {parsed,diagramId}=await this.prepare(input,expectedDataRootId),resolved=await this.project(parsed,diagramId),fingerprint=await this.fingerprint(parsed,resolved),duplicate=await this.diagrams.store.findImportDuplicate(fingerprint,expectedDataRootId!),canvas=isNativeCanvasProject(resolved.project),cap=nativeDocumentCapabilities().imports
  return {sourceFingerprint:fingerprint,...(duplicate?{duplicate:{id:nativeIdentity(duplicate.document).id,revision:duplicate.revision,workspaceGroupId:duplicate.workspaceGroupId}}:{}),sourceSha256:parsed.sha256,bytes:parsed.bytes.length,...nativeIdentity(resolved.project),mode:canvas?'canvas-only':'business',format:resolved.format,supported:duplicate?true:parsed.input.format==='drawio'?!canvas?cap.drawio:cap.drawio&&cap.canvasOnly:!canvas||cap.canvasOnly,workspaceGroupId:parsed.input.workspaceGroupId??null,diagnostics:resolved.diagnostics,...(!isNativeCanvasProject(resolved.project)?{quality:inspectDrawing(resolved.project.content)}:{})}
 }
 async import(input:unknown,expectedDataRootId:string|undefined){return this.importPrepared(input,expectedDataRootId)}
 private async importPrepared(input:unknown,expectedDataRootId:string|undefined,batch?:ImportCommitPlan['batch'],originalRequestId?:string){
  const {parsed,diagramId,importId,mutation}=await this.prepare(input,expectedDataRootId)
  if(batch)mutation.requestHash=sourceSha(canonicalContentJson({base:mutation.requestHash,batch,originalRequestId} as any))
  const replay=await this.diagrams.store.replayNativeDrawing(mutation);if(replay)return this.result(replay)
  const resolved=await this.project(parsed,diagramId),fingerprint=await this.fingerprint(parsed,resolved),cap=nativeDocumentCapabilities().imports
  const unsupported=parsed.input.format==='drawio'&&!cap.drawio||isNativeCanvasProject(resolved.project)&&!cap.canvasOnly
  if(unsupported&&!await this.diagrams.store.findImportDuplicate(fingerprint,expectedDataRootId!))throw new StoreError('原生画布导入尚未启用',422,undefined,'NATIVE_CANVAS_UNSUPPORTED')
  const source=await prepareImportSource(this.diagrams.store.root,{importId,diagramId,format:resolved.format,sha256:parsed.sha256,bytes:parsed.bytes.length,sourceDocumentId:resolved.sourceDocumentId,importedAt:Date.now()},parsed.bytes)
  await readImportSource(this.diagrams.store.root,source)
  const project=await validateNativeProject({...resolved.project,createdAt:source.importedAt,updatedAt:source.importedAt})
  return this.result(await this.diagrams.store.createNativeDrawing(project,parsed.input.workspaceGroupId??null,mutation,source,{fingerprint,duplicateOnly:unsupported,...(batch?{batch}:{})}))
 }
 async source(id:string){await this.diagrams.getDrawing(id);const source=await this.diagrams.store.nativeImportSource(id),buffer=await readImportSource(this.diagrams.store.root,source);return {source,buffer}}
}
