import type {DrawingProjectV3} from '../../src/drawing/engine/types'
export interface MigrationSource {
 diagramId:string;revision:number;rawDocument:string;rawDocumentSha256:string
 createdAt:number;updatedAt:number;savedAt:number;workspaceGroupId:string|null;deletedAt:number|null
}
export interface MigrationCommit {
 source:MigrationSource;project:DrawingProjectV3;sourceHash:string;converterVersion:string
 geometryDigest:string;requestId:string;requestHash:string;expectedDataRootId:string
 report:unknown
}
