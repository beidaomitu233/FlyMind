import type {NativeDrawingProject} from '../../src/drawing/engine/types'
import {isNativeCanvasProject} from '../../src/drawing/engine/native-canvas'
import type {CloudReleaseManifest} from '../cloud/mcp-compat'

export const EXPORT_FORMATS=['png','svg','drawio','json','project.json'] as const
export type NativeExportFormat=typeof EXPORT_FORMATS[number]
export const nativeExportFormats=(project:NativeDrawingProject):readonly NativeExportFormat[]=>isNativeCanvasProject(project)?['png','svg','drawio','project.json']:EXPORT_FORMATS
export type NativeExportFiles<T>=Record<Exclude<NativeExportFormat,'json'>,T>&Partial<Record<'json',T>>
export type NativeExportStatus='queued'|'running'|'succeeded'|'failed'
export interface NativeExportOptions {scale?:number;background?:'white'|'transparent'}
export interface NativeExportFile {filename:string;mediaType:string;bytes:number;sha256:string}
export interface NativeExportManifest {
  release?:CloudReleaseManifest
  schemaVersion:1;exportId:string;diagramId:string;dataRootId:string;revision:number;exportedAt:number
  documentCreatedAt:number;documentUpdatedAt:number;contentHash?:string;xmlHash?:string;mode?:'canvas-only';snapshotSha256:string
  width:number;height:number;scale:number;options:NativeExportOptions
  runtime:Record<string,unknown>;timings:Record<string,number>;warnings:string[]
  files:NativeExportFiles<NativeExportFile>
}
export interface NativeExportJob {
  release?:CloudReleaseManifest
  id:string;diagramId:string;dataRootId:string;revision:number;status:NativeExportStatus
  createdAt:number;updatedAt:number;attempts:number;sourceJobId?:string;isCurrentRevision:boolean
  snapshotSha256:string;contentHash?:string;xmlHash?:string;mode?:'canvas-only';documentCreatedAt:number;documentUpdatedAt:number;options:NativeExportOptions
  exportedAt?:number;width?:number;height?:number;scale?:number
  error?:{code:string;message:string}
  files?:NativeExportFiles<{url:string;filename:string;mediaType:string;bytes:number;sha256:string}>
}
export interface StoredNativeExport {
  release?:CloudReleaseManifest
  id:string;diagramId:string;dataRootId:string;revision:number;status:NativeExportStatus
  createdAt:number;updatedAt:number;attempts:number;sourceJobId?:string
  requestId:string;requestHash:string;options:NativeExportOptions;snapshot:NativeDrawingProject;snapshotSha256:string
  leaseOwner?:string;leaseToken?:string;leaseUntil?:number;manifest?:NativeExportManifest;error?:{code:string;message:string}
}
export interface EnqueueNativeExport {
  release?:CloudReleaseManifest
  diagramId:string;expectedRevision:number;expectedDataRootId:string;requestId:string;requestHash:string
  options:NativeExportOptions;snapshot:NativeDrawingProject;snapshotSha256:string;sourceJobId?:string;historical?:boolean
}
/** Structural injection point: production uses A's NativeDrawioRenderer. */
export interface NativeExportRenderer {
  render(project:NativeDrawingProject,options?:NativeExportOptions&{timeoutMs?:number;signal?:AbortSignal}):Promise<{
    png:Buffer;svg:string;width:number;height:number;scale:number;nativeXML:string
    runtime:Record<string,unknown>;timings:{totalMs:number;browserStartMs:number;loadMs:number;exportMs:number};warnings:string[]
  }>
  close():Promise<void>
}
