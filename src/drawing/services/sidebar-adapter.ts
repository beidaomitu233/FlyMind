import type {DiagramKind} from '../core/model'
export interface SidebarFile {id:string;title:string;statusLabel?:string;kind?:DiagramKind;createdAt?:number;updatedAt:number}
export interface SidebarTrash extends SidebarFile {revision:number;deletedAt:number}
export interface SidebarAdapter {
 documents:SidebarFile[];activeId:string;assignments:Record<string,string>;workspaceGroups:Array<{id:string;name:string;revision?:number}>;trash:SidebarTrash[];recoveries:unknown[];shared:boolean;pending:number|boolean;storageError:string;
 open(id:string):unknown;renameDocument(id:string,title:string):unknown;duplicateDocument(id:string):unknown;deleteDocument(id:string):unknown;
 createWorkspaceGroup(name:string):Promise<unknown>;renameWorkspaceGroup(id:string,name:string):Promise<unknown>;deleteWorkspaceGroup(id:string):unknown;moveToWorkspaceGroup(id:string,group:string|null):Promise<unknown>;restoreDeleted(item:SidebarTrash):unknown;purgeDeleted(item:SidebarTrash):unknown;notify(message:string):unknown;
}
