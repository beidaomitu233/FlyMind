import {createHash} from 'node:crypto'
import {StoreError} from '../store'
import {MAX_NATIVE_REQUEST_BYTES,type NativeImportInput} from './source'
import type {NativeDrawingRecord} from '../document-record'
export type ImportTarget={groupId:string|null}|{newGroupName:string}
export interface ImportItemInput {batchId:string;itemId:string;requestId:string;source:Omit<NativeImportInput,'requestId'|'workspaceGroupId'>;target:ImportTarget}
export interface ImportFingerprint {rawSha256:string;sourceKey?:string;contentHash?:string;renderHash?:string;complete:boolean}
export interface ImportCommitPlan {fingerprint:ImportFingerprint;duplicateOnly?:boolean;batch?:{id:string;itemId:string;target:ImportTarget}}
export interface ImportItemResult {batchId:string;itemId:string;status:'imported'|'duplicate';record:NativeDrawingRecord}
const key=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value)
export function validateImportItem(input:unknown):ImportItemInput{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new StoreError('导入项无效',400,undefined,'IMPORT_ITEM_INVALID')
 if(Buffer.byteLength(JSON.stringify(input))>MAX_NATIVE_REQUEST_BYTES)throw new StoreError('导入项请求超过4,000,000字节',413,undefined,'IMPORT_TOO_LARGE')
 const value=input as ImportItemInput,target=value.target
 if(Object.keys(value).some(k=>!['batchId','itemId','requestId','source','target'].includes(k))||!key(value.batchId)||!key(value.itemId)||!key(value.requestId)||!value.source||typeof value.source!=='object'||Array.isArray(value.source)||Object.keys(value.source).some(k=>!['format','data','title'].includes(k))||!target||typeof target!=='object'||Array.isArray(target))throw new StoreError('导入项字段无效',400,undefined,'IMPORT_ITEM_INVALID')
 const keys=Object.keys(target)
 if(keys.length!==1||!('groupId'in target&&(target.groupId===null||key(target.groupId))||'newGroupName'in target&&typeof target.newGroupName==='string'&&target.newGroupName.trim().length>0&&target.newGroupName.trim().length<=80))throw new StoreError('导入目标无效',400,undefined,'IMPORT_TARGET_INVALID')
 return structuredClone(value)
}
export function importItemKey(root:string,batchId:string,itemId:string){return 'batchitem_'+createHash('sha256').update(JSON.stringify([root,batchId,itemId])).digest('hex')}
