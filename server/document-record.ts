import {copy,validateDocument,type DiagramContent,type DiagramDocument,type DiagramKind} from '../src/drawing/core/model'
import {validateContent} from '../src/drawing/core/layers'
import type {DrawingProjectV3,NativeCanvasProjectV3,NativeDrawingProject} from '../src/drawing/engine/types'
import {isNativeCanvasProject} from '../src/drawing/engine/native-canvas'
export {validateNativeProject} from '../src/drawing/engine/native-canvas'

export interface DiagramRow {
  id:string;document:string;revision:number;saved_at:number;created_at:number
  workspace_group_id:string|null;deleted_at:number|null
}
export interface DiagramMetadata {
  id:string;title:string;kind?:DiagramKind;mode?:'canvas-only';format:2|3;revision:number
  savedAt:number;createdAt:number;updatedAt:number;workspaceGroupId:string|null;deletedAt:number|null
}
interface RecordMetadata {revision:number;savedAt:number;createdAt:number;workspaceGroupId:string|null}
export interface NativeDiagramRecord extends RecordMetadata {format:3;document:DrawingProjectV3}
export interface NativeCanvasRecord extends RecordMetadata {format:3;document:NativeCanvasProjectV3}
export type NativeDrawingRecord=NativeDiagramRecord|NativeCanvasRecord
export interface NativeTrashItem {id:string;title:string;kind?:DiagramKind;mode?:'canvas-only';revision:number;deletedAt:number;createdAt:number;workspaceGroupId:string|null}
export interface LegacyDiagramRecord extends RecordMetadata {format:2;document:DiagramDocument}
export type StoredDiagramRecord=NativeDrawingRecord|LegacyDiagramRecord
export const nativeIdentity=(project:NativeDrawingProject)=>isNativeCanvasProject(project)?{id:project.id,title:project.title,mode:'canvas-only' as const}:{id:project.content.id,title:project.content.title,kind:project.content.kind}
export function isCanvasRecord(record:NativeDrawingRecord):record is NativeCanvasRecord{return isNativeCanvasProject(record.document)}

/** Read codec only. Native commits still require asynchronous XML/project validation. */
export function decodeDiagramRow(row:DiagramRow):StoredDiagramRecord {
  const raw=JSON.parse(row.document)
  const meta={revision:row.revision,savedAt:row.saved_at,createdAt:row.created_at,workspaceGroupId:row.workspace_group_id}
  if(raw?.schemaVersion===3){
    if(raw.mode!==undefined){
      if(raw.mode!=='canvas-only'||raw.id!==row.id||typeof raw.title!=='string'||raw.createdAt!==row.created_at||!Number.isSafeInteger(raw.updatedAt)||raw.updatedAt<raw.createdAt||!raw.rendering?.engine?.xml||typeof raw.rendering.engine.xmlHash!=='string'||'content'in raw||'kind'in raw||'contentHash'in raw.rendering.engine)throw new Error('Canvas stored record metadata is inconsistent')
      return {...meta,format:3,document:copy(raw) as NativeCanvasProjectV3}
    }
    const content=validateContent(raw.content)
    if(content.id!==row.id||raw.createdAt!==row.created_at||!Number.isSafeInteger(raw.updatedAt)||raw.updatedAt<raw.createdAt||!raw.rendering?.engine?.xml)throw new Error('Native stored record metadata is inconsistent')
    return {...meta,format:3,document:copy(raw) as DrawingProjectV3}
  }
  const document=validateDocument(raw)
  if(document.id!==row.id)throw new Error('Stored record ID is inconsistent')
  return {...meta,format:2,document}
}

export function recordContent(record:StoredDiagramRecord):DiagramContent {
  if(record.format===3&&isCanvasRecord(record))throw new Error('BUSINESS_MAPPING_REQUIRED: 仅画布没有业务内容')
  return record.format===3?record.document.content:record.document
}
export function diagramMetadata(row:DiagramRow):DiagramMetadata {
  const record=decodeDiagramRow(row),identity=record.format===3?nativeIdentity(record.document):{id:record.document.id,title:record.document.title,kind:record.document.kind}
  return {...identity,format:record.format,revision:row.revision,savedAt:row.saved_at,createdAt:row.created_at,updatedAt:record.document.updatedAt,workspaceGroupId:row.workspace_group_id,deletedAt:row.deleted_at}
}
