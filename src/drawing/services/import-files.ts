/** Browser-only selection/scanning. Server previews remain authoritative for structure and XML. */
export const MAX_IMPORT_SCAN_ENTRIES=200
export const MAX_IMPORT_BATCH_SOURCES=50
export const MAX_IMPORT_BATCH_BYTES=20_000_000
export const MAX_IMPORT_FILE_BYTES=2_500_000
export interface ImportFile {name:string;size:number;webkitRelativePath?:string;arrayBuffer():Promise<ArrayBuffer>}
export interface ImportSelection {file:ImportFile;path:string}
export interface ImportCandidate {itemId:string;path:string;name:string;status:'ready'|'duplicate'|'conflict'|'unsupported';reason?:string;preferredItemId?:string;format?:'content'|'project'|'drawio';data?:string;sourceId?:string}
export interface ImportDirectoryEntry {name:string;isFile:boolean;isDirectory:boolean;file?(success:(file:ImportFile)=>void,error:(error:Error)=>void):void;createReader?():{readEntries(success:(entries:ImportDirectoryEntry[])=>void,error:(error:Error)=>void):void}}
export function importRelativePath(value:string):string{
 if(!value||value.length>1024||/[\\:\u0000]/.test(value)||value.startsWith('/')||value.split('/').some(s=>!s||s==='.'||s==='..'||s.startsWith('.'))||/\.(lnk|url)$/i.test(value))throw new Error('不支持隐藏文件、链接或非相对来源路径')
 return value
}
export function selectImportFiles(files:Iterable<ImportFile>):ImportSelection[]{
 const result:ImportSelection[]=[];let count=0
 for(const file of files){if(++count>MAX_IMPORT_SCAN_ENTRIES)throw new Error('一次最多扫描200个文件');try{result.push({file,path:importRelativePath(file.webkitRelativePath||file.name)})}catch{/* Hidden/system paths are not opened. */}}
 return result.sort((a,b)=>a.path.localeCompare(b.path))
}
export async function scanImportEntries(entries:Iterable<ImportDirectoryEntry>):Promise<ImportSelection[]>{
 const result:ImportSelection[]=[];let count=0
 async function visit(entry:ImportDirectoryEntry,parent=''){
  if(++count>MAX_IMPORT_SCAN_ENTRIES)throw new Error('一次最多扫描200个目录条目')
  let path:string;try{path=importRelativePath(parent+entry.name)}catch{return}
  if(entry.isFile&&entry.file){const file=await new Promise<ImportFile>((ok,no)=>entry.file!(ok,no));result.push({file,path})}
  else if(entry.isDirectory&&entry.createReader){const reader=entry.createReader();for(;;){const children=await new Promise<ImportDirectoryEntry[]>((ok,no)=>reader.readEntries(ok,no));if(!children.length)break;for(const child of children)await visit(child,path+'/')}}
  else throw new Error('浏览器未提供安全的本地文件或目录条目')
 }
 for(const entry of entries)await visit(entry)
 return result.sort((a,b)=>a.path.localeCompare(b.path))
}
function stable(value:unknown):string{if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable((value as Record<string,unknown>)[k])).join(',')+'}';return JSON.stringify(value)}
async function sha(bytes:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes).buffer))).map(v=>v.toString(16).padStart(2,'0')).join('')}
function base64(bytes:Uint8Array){let text='';for(let n=0;n<bytes.length;n+=32768)text+=String.fromCharCode(...bytes.subarray(n,n+32768));return btoa(text)}
/** JSON comparison only selects candidates; malformed business fields must still fail server preview. */
export async function identifyImportCandidates(selection:ImportSelection[]):Promise<ImportCandidate[]>{
 if(selection.length>MAX_IMPORT_SCAN_ENTRIES)throw new Error('一次最多扫描200个文件')
 const rows:ImportCandidate[]=[],seen=new Map<string,ImportCandidate>(),business=new Map<string,Array<{row:ImportCandidate;content:string;render?:string}>>()
 let bytesTotal=0,sources=0
 for(const selected of selection){
  const path=importRelativePath(selected.path),file=selected.file,extension=path.toLowerCase(),row:ImportCandidate={itemId:'',path,name:file.name,status:'unsupported'}
  rows.push(row)
  if(!/\.(json|drawio|xml)$/.test(extension)){row.itemId='unsupported_'+rows.length;row.reason=/\.(png|svg)$/.test(extension)?'伴随图片不另建图；仅图片不能还原节点':'不支持此文件格式';continue}
  if(file.size>MAX_IMPORT_FILE_BYTES){row.itemId='unsupported_'+rows.length;row.reason='单源超过2,500,000字节';continue}
  if(++sources>MAX_IMPORT_BATCH_SOURCES)throw new Error('一次最多预检50份规范源')
  const bytes=new Uint8Array(await file.arrayBuffer());bytesTotal+=bytes.length
  if(bytes.length!==file.size||bytes.length>MAX_IMPORT_FILE_BYTES||bytesTotal>MAX_IMPORT_BATCH_BYTES)throw new Error('导入来源大小变化或合计超过20MB')
  const digest=await sha(bytes);row.itemId='item_'+await sha(new TextEncoder().encode(path+'\n'+digest))
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{row.reason='仅接受UTF-8来源';continue}
  const duplicate=seen.get(digest)
  if(duplicate){row.status='duplicate';row.preferredItemId=duplicate.itemId;row.reason='相同来源字节';continue}
  try{
   if(/\.(drawio|xml)$/.test(extension)){if(!text.trimStart().startsWith('<'))throw Error('不是XML来源');row.format='drawio'}
   else {const value=JSON.parse(text) as {schemaVersion?:number;id?:string;content?:{id?:string};rendering?:unknown;mode?:string}
    if(value.schemaVersion===1&&typeof value.id==='string'){row.format='content';row.sourceId=value.id}
    else if([2,3].includes(value.schemaVersion??0)&&(typeof value.content?.id==='string'||value.mode==='canvas-only'&&typeof value.id==='string')){row.format='project';row.sourceId=value.content?.id??value.id}
    else throw Error('不是content或完整单图project')
    if(value.mode!=='canvas-only'){
     const list=business.get(row.sourceId!)??[];list.push({row,content:stable(row.format==='content'?value:value.content),...(row.format==='project'?{render:stable(value.rendering)}:{})});business.set(row.sourceId!,list)
    }
   }
   row.data=base64(bytes);row.status='ready';seen.set(digest,row)
  }catch(e){row.reason=e instanceof Error?e.message:String(e)}
 }
 for(const list of business.values()){
  if(list.length<2)continue
  const contents=new Set(list.map(v=>v.content)),full=list.filter(v=>v.render!==undefined)
  if(contents.size>1||new Set(full.map(v=>v.render)).size>1){for(const {row}of list){row.status='conflict';row.reason='同一来源ID存在不同业务内容或完整人工排版，请明确选择'}continue}
  const preferred=full[0]?.row??list[0].row
  for(const {row}of list)if(row!==preferred){row.status='duplicate';row.preferredItemId=preferred.itemId;row.reason='与规范源业务一致，完整project优先'}
 }
 const byId=new Map(rows.map(row=>[row.itemId,row]))
 for(const row of rows)if(row.status==='duplicate'){
  let selected=byId.get(row.preferredItemId!),steps=0
  while(selected?.status==='duplicate'&&selected.preferredItemId&&steps++<rows.length)selected=byId.get(selected.preferredItemId)
  if(selected?.status==='conflict'){row.status='conflict';row.reason=selected.reason;delete row.preferredItemId}
  else if(selected)row.preferredItemId=selected.itemId
 }
 return rows
}
