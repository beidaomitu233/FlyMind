import {createHash,randomUUID} from 'node:crypto'
import {mkdir,open,readFile,rename,realpath,rm,lstat} from 'node:fs/promises'
import {join,resolve,sep} from 'node:path'
import {StoreError} from '../store'
import {canonicalContentJson} from '../../src/drawing/engine/content-hash'
import {MAX_IMPORT_SOURCE_BYTES,MAX_NATIVE_REQUEST_BYTES} from '../../src/drawing/services/native-capabilities'
export {MAX_IMPORT_SOURCE_BYTES,MAX_NATIVE_REQUEST_BYTES}
export interface NativeImportInput {format:'content'|'project'|'drawio';data:string;requestId:string;title?:string;workspaceGroupId?:string|null}
export interface NativeImportSource {
 importId:string;diagramId:string;format:'content-json'|'project-v2'|'project-v3'|'drawio-business'|'drawio-canvas'|'project-canvas'
 sha256:string;bytes:number;relativePath:string;manifestSha256:string;sourceDocumentId?:string;importedAt:number
}
export const sourceSha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex')
export function validateImportInput(input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['format','data','requestId','title','workspaceGroupId'].includes(k)))throw new StoreError('导入请求字段无效',400,undefined,'IMPORT_INPUT_INVALID')
 const value=input as NativeImportInput
 if(!['content','project','drawio'].includes(value.format)||typeof value.data!=='string'||typeof value.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(value.requestId)||value.title!==undefined&&(typeof value.title!=='string'||!value.title.trim()||value.title.length>160)||value.workspaceGroupId!==undefined&&value.workspaceGroupId!==null&&typeof value.workspaceGroupId!=='string')throw new StoreError('导入格式或请求键无效',400,undefined,'IMPORT_INPUT_INVALID')
 if(Buffer.byteLength(JSON.stringify(input))>MAX_NATIVE_REQUEST_BYTES||value.data.length>Math.ceil(MAX_IMPORT_SOURCE_BYTES/3)*4)throw new StoreError('导入文件/请求超过预算',413,undefined,'IMPORT_TOO_LARGE')
 if(!value.data||value.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.data))throw new StoreError('导入文件必须为规范base64',400,undefined,'IMPORT_INPUT_INVALID')
 const bytes=Buffer.from(value.data,'base64');if(bytes.toString('base64')!==value.data||bytes.length>MAX_IMPORT_SOURCE_BYTES)throw new StoreError('导入文件编码或大小无效',413,undefined,'IMPORT_TOO_LARGE')
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}catch{throw new StoreError('仅接受UTF-8文件',400,undefined,'IMPORT_ENCODING_UNSUPPORTED')}
 let document:unknown;try{document=value.format==='drawio'?text.replace(/^\uFEFF/,''):JSON.parse(text.replace(/^\uFEFF/,''))}catch{throw new StoreError('文件不是有效content或单图project JSON',400,undefined,'IMPORT_FORMAT_UNSUPPORTED')}
 return {input:structuredClone(value),bytes,document,sha256:sourceSha(bytes)}
}
export function importIdentity(rootId:string,requestId:string){const hash=sourceSha('flymind-business-import:'+rootId+':'+requestId);return {diagramId:'import_'+hash.slice(0,32),importId:'source_'+hash.slice(32)}}
async function durable(path:string,bytes:Buffer){const f=await open(path,'wx');try{await f.writeFile(bytes);await f.sync()}finally{await f.close()}}
async function sourceParent(root:string,diagramId:string){const rootReal=await realpath(root);let parent=rootReal
 for(const segment of ['artifacts',diagramId,'imports']){const path=join(parent,segment);try{const info=await lstat(path);if(info.isSymbolicLink()||!info.isDirectory())throw new StoreError('导入来源目录不可为符号链接或文件',400,undefined,'IMPORT_PATH_INVALID')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;try{await mkdir(path)}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e}if((await lstat(path)).isSymbolicLink())throw new StoreError('导入来源目录已改变',400,undefined,'IMPORT_PATH_INVALID')}
  if(!(await realpath(path)).startsWith(rootReal+sep))throw new StoreError('导入来源目录越界',400,undefined,'IMPORT_PATH_INVALID');parent=path
 }return {parent,rootReal}
}
/** Published source directories are immutable; DB registration controls visibility. */
export async function prepareImportSource(root:string,meta:Omit<NativeImportSource,'relativePath'|'manifestSha256'>,bytes:Buffer){
 if(!/^[a-zA-Z0-9_-]+$/.test(meta.diagramId)||!/^source_[a-f0-9]{32}$/.test(meta.importId)||sourceSha(bytes)!==meta.sha256||bytes.length!==meta.bytes)throw new StoreError('导入来源身份或摘要无效')
 const {parent,rootReal}=await sourceParent(root,meta.diagramId),parentReal=await realpath(parent)
 if(!parentReal.startsWith(rootReal+sep))throw new StoreError('导入来源路径越界',400,undefined,'IMPORT_PATH_INVALID')
 const sourceName=meta.format.startsWith('drawio-')?'source.drawio':'source.json',published=join(parent,meta.importId),relativePath=`artifacts/${meta.diagramId}/imports/${meta.importId}/${sourceName}`,manifest={schemaVersion:1,...meta,relativePath},manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)),source:NativeImportSource={...meta,relativePath,manifestSha256:sourceSha(manifestBytes)}
 try{await lstat(published);if((await lstat(published)).isSymbolicLink()||sourceSha(await readFile(join(published,sourceName)))!==meta.sha256)throw new StoreError('同一来源ID已存在不同内容',409,undefined,'IDEMPOTENCY_KEY_REUSED');const previous=JSON.parse(await readFile(join(published,'manifest.json'),'utf8'));if(previous.sha256!==meta.sha256||previous.diagramId!==meta.diagramId||previous.format!==meta.format)throw new StoreError('来源清单失配');return {...source,importedAt:previous.importedAt,manifestSha256:sourceSha(await readFile(join(published,'manifest.json')))}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 const staging=join(parent,'.'+meta.importId+'.'+randomUUID()+'.pending');await mkdir(staging)
 try{await durable(join(staging,sourceName),bytes);await durable(join(staging,'manifest.json'),manifestBytes);await rename(staging,published)}catch(error){
  // Another same-key attempt may have atomically published first. It is never
  // deleted or overwritten; retry only reuses a fully verified identical source.
  let previous:NativeImportSource|undefined
  try{const disk=await readFile(join(published,'manifest.json')),m=JSON.parse(disk.toString('utf8'));if(m.diagramId===meta.diagramId&&m.importId===meta.importId&&m.sha256===meta.sha256&&m.format===meta.format){const {schemaVersion,...metadata}=m;const candidate={...metadata,manifestSha256:sourceSha(disk)};await readImportSource(root,candidate);previous=candidate}}catch{}
  const actual=resolve(staging);if(!actual.startsWith(resolve(parent)+sep)||!(await realpath(staging)).startsWith(parentReal+sep)||(await lstat(staging)).isSymbolicLink())throw new StoreError('拒绝清理非本请求暂存目录',400,undefined,'IMPORT_PATH_INVALID')
  await rm(staging,{recursive:true,force:true})
  if(previous)return previous
  throw error
 }
 return source
}
export async function readImportSource(root:string,source:NativeImportSource){
 const sourceName=source.format.startsWith('drawio-')?'source.drawio':'source.json',expected=`artifacts/${source.diagramId}/imports/${source.importId}/${sourceName}`
 if(source.relativePath!==expected||!/^import_[a-f0-9]{32}$/.test(source.diagramId)||!/^source_[a-f0-9]{32}$/.test(source.importId))throw new StoreError('来源路径无效',400,undefined,'IMPORT_PATH_INVALID')
 const target=resolve(root,...expected.split('/')),actual=await realpath(target);if(!actual.startsWith(await realpath(root)+sep)||(await lstat(target)).isSymbolicLink())throw new StoreError('来源文件路径越界',400,undefined,'IMPORT_PATH_INVALID')
 const info=await lstat(target);if(!info.isFile()||info.size!==source.bytes||info.size>MAX_IMPORT_SOURCE_BYTES)throw new StoreError('导入来源大小不符',500,undefined,'IMPORT_SOURCE_CORRUPT')
 const bytes=await readFile(target),manifest=await readFile(join(target,'..','manifest.json'))
 if(bytes.length!==source.bytes||sourceSha(bytes)!==source.sha256||sourceSha(manifest)!==source.manifestSha256)throw new StoreError('导入来源文件或清单摘要不符',500,undefined,'IMPORT_SOURCE_CORRUPT')
 const {manifestSha256,...metadata}=source
 if(canonicalContentJson(JSON.parse(manifest.toString('utf8')))!==canonicalContentJson({schemaVersion:1,...metadata} as any))throw new StoreError('导入来源清单与记录不符',500,undefined,'IMPORT_SOURCE_CORRUPT')
 return bytes
}
