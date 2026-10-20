import type {NativeImportPreview,NativeDrawingRecord} from './native-types'
export type ImportBatchTarget={groupId:string|null}|{newGroupName:string}
export interface ImportBatchItem {batchId:string;itemId:string;requestId:string;source:{format:'content'|'project'|'drawio';data:string;title?:string};target:ImportBatchTarget}
export interface ImportBatchPreview extends NativeImportPreview {batchId:string;itemId:string;duplicate?:{id:string;revision:number;workspaceGroupId?:string|null};sourceFingerprint?:{sourceKey?:string;contentHash?:string;renderHash?:string;complete:boolean;rawSha256:string}}
export interface ImportBatchResult {batchId:string;itemId:string;status:'imported'|'duplicate';record:NativeDrawingRecord}
