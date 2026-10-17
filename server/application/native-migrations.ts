import {StoreError,type DiagramStore} from '../store'
import {readMigrationSource,rawHash} from '../migrations/source'
import {canonicalContentJson} from '../../src/drawing/engine/content-hash'
import {extractContent,validateContent} from '../../src/drawing/core/layers'
import {validateDrawingProject} from '../../src/drawing/engine/project'
import {validateDocument} from '../../src/drawing/core/model'
import {previewLegacyMigration,convertLegacyMigration} from '../../src/drawing/engine/migration'
export interface MigrationRequest {
 diagramId:string;expectedRevision:number;expectedRawDocumentSha256:string;expectedSourceHash:string
 expectedGeometryDigest:string;requestId:string;converterVersion:string
 expectedWorkspaceGroupId:string|null;expectedDeletedAt:number|null;expectedSavedAt:number
}
/** Explicit conversion only. Preview is strictly read-only, including SQLite schema. */
export class NativeMigrationService {
 constructor(readonly store:DiagramStore){}
 async preview(id:string){
  this.store.id(id);const source=readMigrationSource(this.store.root,id)
  const preview=await previewLegacyMigration(JSON.parse(source.rawDocument),{sourceCreatedAt:source.createdAt})
  return {source,preview}
 }
 async commit(input:MigrationRequest,expectedDataRootId:string){
  if(!input||Object.keys(input).some(k=>!['diagramId','expectedRevision','expectedRawDocumentSha256','expectedSourceHash','expectedGeometryDigest','requestId','converterVersion','expectedWorkspaceGroupId','expectedDeletedAt','expectedSavedAt'].includes(k)))throw new StoreError('迁移请求字段无效')
  this.store.id(input.diagramId)
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||!/^[a-zA-Z0-9_-]{1,128}$/.test(input.requestId)||![input.expectedRawDocumentSha256,input.expectedSourceHash,input.expectedGeometryDigest].every(s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s)))throw new StoreError('迁移请求参数无效')
  const requestHash=rawHash(canonicalContentJson({operation:'explicit-legacy-migration',input} as any)),receipt=await this.store.replayLegacyMigration(input.requestId,requestHash,expectedDataRootId)
  if(receipt)return receipt
  const source=readMigrationSource(this.store.root,input.diagramId)
  if(source.revision!==input.expectedRevision||source.rawDocumentSha256!==input.expectedRawDocumentSha256||source.workspaceGroupId!==input.expectedWorkspaceGroupId||source.deletedAt!==input.expectedDeletedAt||source.savedAt!==input.expectedSavedAt)throw new StoreError('源记录已改变，必须重新预览',409,source.revision,'MIGRATION_SOURCE_CHANGED')
  const preview=await convertLegacyMigration(JSON.parse(source.rawDocument),{expectedSourceHash:input.expectedSourceHash,sourceCreatedAt:source.createdAt})
  if(preview.status!=='ready'||!preview.project||preview.diagnostics.some(d=>d.severity==='blocking'))throw new StoreError('存在无法无损映射的项目，未提交',409,source.revision,'MIGRATION_BLOCKED')
  if(preview.converterVersion!==input.converterVersion||preview.geometryDigest!==input.expectedGeometryDigest)throw new StoreError('预览或转换器版本已改变',409,source.revision,'MIGRATION_PREVIEW_CHANGED')
  const project=await validateDrawingProject(preview.project),legacyContent=validateContent(extractContent(validateDocument(JSON.parse(source.rawDocument))))
  if(canonicalContentJson(project.content)!==canonicalContentJson(legacyContent))throw new StoreError('迁移改变了业务内容',400,undefined,'MIGRATION_CONTENT_MISMATCH')
  return this.store.commitLegacyMigration({source,project,sourceHash:preview.sourceHash,converterVersion:preview.converterVersion,geometryDigest:preview.geometryDigest!,requestId:input.requestId,requestHash,expectedDataRootId,report:{...preview,project:undefined}})
 }
}
