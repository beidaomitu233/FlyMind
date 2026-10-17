import type {DrawingProjectV3} from '../types'

/** Converter protocol version; separate from app/engine/profile versions. */
export const LEGACY_SWIMLANE_CONVERTER_VERSION='1'
export interface LegacyMigrationOptions {sourceCreatedAt?:number}
export interface LegacyMigrationDiagnostic {
 severity:'warning'|'blocking'
 code:string
 path:string
 message:string
 businessId?:string
}
export interface LegacyMigrationCounts {
 nodes:number;edges:number;lanes:number;phases:number;groups:number
 nativeCells:number;mapped:number;unmapped:number
}
export interface LegacyMigrationPreview {
 status:'ready'|'blocked'
 /** SHA256 over normalized content + complete legacy rendering + source times. */
 sourceHash:string
 converterVersion:typeof LEGACY_SWIMLANE_CONVERTER_VERSION
 contentHash?:string
 counts:LegacyMigrationCounts
 diagnostics:LegacyMigrationDiagnostic[]
 geometryDigest?:string
 /** Absent whenever a blocking diagnostic exists. Never writes a store. */
 project?:DrawingProjectV3
}
export interface LegacyMigrationConvertOptions extends LegacyMigrationOptions {expectedSourceHash:string}
