import type {DiagramDocument,DiagramKind} from '../core/model'
import type {DrawingProjectV3,NativeDrawingProject} from '../engine/types'
import type {DrawioKindCapabilities} from '../engine/types'
export type {NativeExportJob,NativeExportOptions,NativeExportFormat} from '../../../server/exports/types'

export interface NativeRecord<T extends NativeDrawingProject=DrawingProjectV3> {
  format:3;document:T;revision:number;savedAt:number;createdAt:number;workspaceGroupId:string|null
  quality?:ReturnType<typeof import('../core/drawing-quality').inspectDrawing>
  import?:{format:string;sourceSha256:string;sourceDocumentId?:string;bytes:number}
}
export type NativeDrawingRecord=NativeRecord<NativeDrawingProject>
export function nativeRecordIdentity(record:NativeDrawingRecord){const p=record.document;return 'mode'in p?{id:p.id,title:p.title,mode:p.mode}:{id:p.content.id,title:p.content.title,kind:p.content.kind}}
export interface NativeImportRequest {format:'content'|'project'|'drawio';data:string;requestId:string;title?:string;workspaceGroupId?:string|null}
export interface NativeImportPreview {id:string;title:string;mode:'business'|'canvas-only';kind?:DiagramKind;format:string;supported:boolean;bytes:number;sourceSha256:string;workspaceGroupId:string|null;diagnostics:Array<{code:string;message:string}>;quality?:NativeRecord['quality']}
export interface NativeMetadata {
  id:string;title:string;kind?:DiagramKind;mode?:'canvas-only';format:2|3;revision:number;savedAt:number;createdAt:number;updatedAt:number;workspaceGroupId:string|null;deletedAt:number|null
}
export interface NativeWorkspace {
  diagrams:Array<NativeDrawingRecord|{format:2;document:DiagramDocument;revision:number;savedAt:number;createdAt:number;workspaceGroupId:string|null}>
  metadata:NativeMetadata[];groups:unknown[];trash:unknown[];deletedIds:string[]
}
export interface NativeHealth {
  name:string;version:string;storage:string;dataRootId:string
  runtime?:{application:string;appVersion:string;apiVersion:number;instanceId:string;rootPathId:string;pid:number}
  capabilities:{nativePilot:boolean;nativeDocumentWrites:boolean;mixedWorkspace:boolean;nativeExports?:boolean;apiVersion?:number;drawingProjectVersion?:number;drawioVersion?:string;adapterVersion?:string;profile?:{id:string;version:string};supportedKinds?:string[];configureRendering?:boolean;profiles?:DrawioKindCapabilities[];imports?:{contentJSON:boolean;businessProjectJSON:boolean;drawio:boolean;canvasOnly:boolean;maxSourceBytes:number;maxRequestBytes:number;maxXMLBytes:number}}
}
export interface NativeSaveRequest {xml:string;expectedRevision:number;requestId:string}
export interface NativeTransport {
  readonly expectedDataRootId?:string
  health():Promise<NativeHealth>
  get(diagramId:string):Promise<NativeDrawingRecord>
  saveEditor(diagramId:string,request:NativeSaveRequest):Promise<NativeDrawingRecord>
}
export class NativeApiError extends Error {
  constructor(message:string,readonly status:number,readonly code:string,readonly currentRevision?:number){super(message);this.name='NativeApiError'}
  get uncertain(){return this.status===0||this.status>=500}
}

export interface NativeDraftKey {dataRootId:string;diagramId:string;baseRevision:number;sessionId:string}
export interface DraftGuard {generation:number;journalVersion:number;latestSeq:number}
export interface NativePendingSave {request:NativeSaveRequest;seq:number}
export interface NativeDraft extends NativeDraftKey,DraftGuard {
  formatVersion:1;latestXML:string;acknowledgedXML:string;acknowledgedSeq:number
  inflight?:NativePendingSave;updatedAt:number
  /** Known committed request retained for a blocked cloud rebase, never retried. */
  acknowledgedPending?:NativePendingSave;reconcileBlocked?:boolean
}
export interface NativeDraftUpdate {key:NativeDraftKey;guard:DraftGuard;draft?:NativeDraft}
export interface DraftRepository {
  /** Atomically guard the session, move its previous key, then put/clear the draft. */
  write(update:NativeDraftUpdate):Promise<boolean>
  get(key:NativeDraftKey):Promise<NativeDraft|undefined>
  list(filter?:{dataRootId?:string;diagramId?:string}):Promise<NativeDraft[]>
}
export type NativeSessionStatus='ready'|'dirty'|'saving'|'offline'|'conflict'|'deleted'|'invalid'|'draft-error'|'closed'
export interface NativeSessionSnapshot {
  dataRootId:string;diagramId:string;sessionId:string;generation:number;baseRevision:number
  latestXML:string;latestSeq:number;acknowledgedSeq:number;dirty:boolean;backedUp:boolean
  status:NativeSessionStatus;inflight?:NativePendingSave
  error?:{message:string;code:string;status:number;currentRevision?:number}
}
export interface NativeAcknowledgement {request:NativeSaveRequest;record:NativeDrawingRecord;seq:number;hasNewerEdits:boolean}
export interface NativeRecoveryDownload {filename:string;mimeType:'application/json';contents:string}
