import type { DiagramDocument } from '../core/model'
// Workspace organization is independent of diagram content and rendering.
export interface WorkspaceGroup { id:string; name:string; revision:number; createdAt:number; updatedAt:number }
export interface RecordData { document:DiagramDocument; revision:number; savedAt:number; createdAt?:number; workspaceGroupId?:string|null }
export interface TrashItem {id:string;title:string;kind:DiagramDocument['kind'];revision:number;deletedAt:number;createdAt:number;workspaceGroupId:string|null}
export interface WorkspaceSnapshot { diagrams:RecordData[]; groups:WorkspaceGroup[]; deletedIds:string[];trash?:TrashItem[] }
