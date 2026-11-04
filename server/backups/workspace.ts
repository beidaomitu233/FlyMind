import Database from 'better-sqlite3'
import {createRequire} from 'node:module'
import {createHash,randomUUID} from 'node:crypto'
import {mkdir,readFile,readdir,lstat,realpath,open,rename,utimes,stat} from 'node:fs/promises'
import {createReadStream,constants} from 'node:fs'
import {resolve,join,relative,sep,isAbsolute,dirname,parse} from 'node:path'
import {canonicalContentJson} from '../../src/drawing/engine/content-hash'
import {validateNativeProject,nativeIdentity} from '../document-record'
import {validateDocument} from '../../src/drawing/core/model'
import {decodeDiagramRow} from '../document-record'
import {StoreError,PROJECT_ROOT} from '../store'
import {assertIsolatedNativeRoot,workspaceDataRootId} from '../native-pilot'
import {resolveRuntimeAssets,checkRuntimeAssets} from '../rendering/assets'
import {verifyNativeArtifact} from '../exports/artifacts'
import {nativeExportFormats,type StoredNativeExport} from '../exports/types'
import {readImportSource,type NativeImportSource} from '../imports/source'
export const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex')
/** Hash without retaining whole artifact, database or fixed resource in memory. */
export async function hashFile(path:string){const digest=createHash('sha256');for await(const chunk of createReadStream(path))digest.update(chunk);return digest.digest('hex')}
export const canonicalHash=(v:unknown)=>hash(canonicalContentJson(v as any))
export interface BackupFile {path:string;bytes:number;sha256:string;mtimeMs:number}
export interface WorkspaceBackupManifest {
 schemaVersion:1;backupId:string;createdAt:number;sourceDataRootId:string|null
 database:{sha256:string;stateHash:string;counts:Record<string,number>}
 artifacts:BackupFile[];supply:Record<string,string>;requiredSupply:'matching-local-installation'
 retiredJobIds:string[]
}
export function beneath(root:string,rel:string){
 if(!rel||isAbsolute(rel)||rel.includes('\\')||rel.split('/').some(s=>!s||s==='.'||s==='..'))throw new StoreError('相对路径无效',400,undefined,'BACKUP_PATH_INVALID')
 const target=resolve(root,...rel.split('/'));if(!target.startsWith(resolve(root)+sep))throw new StoreError('路径越界',400,undefined,'BACKUP_PATH_INVALID');return target
}
function insideDirectory(root:string,path:string){const value=relative(root,path);return value!==''&&value!=='..'&&!value.startsWith('..'+sep)&&!isAbsolute(value)}
export async function plainDirectory(root:string){
 const full=resolve(root),before=await lstat(full),same=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b
 if(before.isSymbolicLink()||!before.isDirectory())throw new StoreError('拒绝符号链接/重定向目录',400,undefined,'BACKUP_PATH_INVALID')
 const canonical=resolve(await realpath(full))
 // Windows 8.3 names can resolve to a different spelling without redirecting.
 // In that case check every original component, including junctions, before
 // switching to the canonical root for all further containment checks.
 if(!same(full,canonical)){let part=parse(full).root;for(const name of relative(part,full).split(sep).filter(Boolean)){part=join(part,name);const entry=await lstat(part);if(entry.isSymbolicLink()||!entry.isDirectory())throw new StoreError('拒绝符号链接/重定向目录',400,undefined,'BACKUP_PATH_INVALID')}}
 const after=await lstat(full);if(after.isSymbolicLink()||!after.isDirectory()||before.dev!==after.dev||before.ino!==after.ino||!same(resolve(await realpath(full)),canonical))throw new StoreError('拒绝符号链接/重定向目录',400,undefined,'BACKUP_PATH_INVALID')
 return canonical
}
async function canonicalFutureDirectory(path:string){
 let current=resolve(path);const missing:string[]=[]
 for(;;){try{return resolve(await plainDirectory(current),...missing)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;const parent=dirname(current);if(parent===current)throw error;missing.unshift(relative(parent,current));current=parent}}
}
export async function writeDurable(path:string,value:unknown){const f=await open(path,'wx');try{await f.writeFile(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2));await f.sync()}finally{await f.close()}}
/** Open one checked source, stream it, then reject replacements or mutations. */
async function stableSource<T>(root:string,path:string,read:(f:Awaited<ReturnType<typeof open>>)=>Promise<T>):Promise<{value:T;mtimeMs:number}>{
 await plainDirectory(root);let parent=resolve(root)
 for(const part of relative(root,resolve(path,'..')).split(sep).filter(Boolean)){if(part==='..')throw new StoreError('备份文件路径已改变',400,undefined,'BACKUP_PATH_INVALID');parent=join(parent,part);await plainDirectory(parent)}
 const before=await lstat(path)
 if(before.isSymbolicLink()||!before.isFile()||!insideDirectory(root,await realpath(path)))throw new StoreError('备份文件路径已改变',400,undefined,'BACKUP_PATH_INVALID')
 const f=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0))
 try{
  const initial=await f.stat()
  if(!initial.isFile()||initial.dev!==before.dev||initial.ino!==before.ino||initial.size!==before.size||initial.mtimeMs!==before.mtimeMs||initial.ctimeMs!==before.ctimeMs)throw new StoreError('备份复制期间制品已改变',409,undefined,'BACKUP_SOURCE_CHANGED')
  const value=await read(f),after=await f.stat(),current=await lstat(path)
  if(current.isSymbolicLink()||!current.isFile()||!insideDirectory(root,await realpath(path))||[after,current].some(s=>s.dev!==initial.dev||s.ino!==initial.ino||s.size!==initial.size||s.mtimeMs!==initial.mtimeMs||s.ctimeMs!==initial.ctimeMs))throw new StoreError('备份复制期间制品已改变',409,undefined,'BACKUP_SOURCE_CHANGED')
  return {value,mtimeMs:initial.mtimeMs}
 }finally{await f.close()}
}
async function streamSource(f:Awaited<ReturnType<typeof open>>,target?:Awaited<ReturnType<typeof open>>,afterChunk?:(bytes:number)=>Promise<void>){
 const digest=createHash('sha256'),chunk=Buffer.allocUnsafe(64*1024);let bytes=0
 for(;;){const part=await f.read(chunk,0,chunk.length,null);if(!part.bytesRead)break;const data=chunk.subarray(0,part.bytesRead);digest.update(data);if(target)await target.writeFile(data);bytes+=data.length;await afterChunk?.(bytes)}
 return {bytes,sha256:digest.digest('hex')}
}
export async function inventory(root:string,options:{afterChunk?:(path:string,bytes:number)=>Promise<void>}={}):Promise<BackupFile[]>{
 const files:BackupFile[]=[],paths:string[]=[]
 async function walk(dir:string){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isSymbolicLink())throw new StoreError('备份不接受符号链接',400,undefined,'BACKUP_PATH_INVALID');if(e.isDirectory()){await plainDirectory(p);await walk(p)}else if(e.isFile())paths.push(p);else throw new StoreError('不支持的文件类型')}}
 try{root=await plainDirectory(root)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e}
 await walk(root)
 // Four small streaming buffers bound memory while keeping large fixed-supply
 // inventories practical on filesystems with high per-operation latency.
 let next=0,failed=false,failure:unknown
 await Promise.all(Array.from({length:Math.min(paths.length,4)},async()=>{while(!failed&&next<paths.length){const p=paths[next++],name=relative(root,p).split(sep).join('/')
  try{const result=await stableSource(root,p,f=>streamSource(f,undefined,options.afterChunk?bytes=>options.afterChunk!(name,bytes):undefined));files.push({path:name,...result.value,mtimeMs:result.mtimeMs})}
  catch(error){if(!failed){failed=true;failure=error}}
 }}))
 if(failed)throw failure
 return files.sort((a,b)=>a.path.localeCompare(b.path))
}
export async function copyVerified(sourceRoot:string,targetRoot:string,files:BackupFile[],options:{preserveMtime?:boolean;afterChunk?:(path:string,bytes:number)=>Promise<void>}={}){
 sourceRoot=await plainDirectory(sourceRoot);await mkdir(targetRoot,{recursive:true});targetRoot=await plainDirectory(targetRoot)
 for(const file of files){const source=beneath(sourceRoot,file.path),target=beneath(targetRoot,file.path)
  const checked=await stableSource(sourceRoot,source,f=>streamSource(f));if(checked.value.bytes!==file.bytes||checked.value.sha256!==file.sha256)throw new StoreError('备份复制期间制品已改变',409,undefined,'BACKUP_SOURCE_CHANGED')
  let parent=resolve(targetRoot);for(const part of file.path.split('/').slice(0,-1)){parent=join(parent,part);try{await mkdir(parent)}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e}await plainDirectory(parent)}
  const output=await open(target,'wx')
  try{const copied=await stableSource(sourceRoot,source,f=>streamSource(f,output,options.afterChunk?bytes=>options.afterChunk!(file.path,bytes):undefined));if(copied.value.bytes!==file.bytes||copied.value.sha256!==file.sha256)throw new StoreError('备份复制期间制品已改变',409,undefined,'BACKUP_SOURCE_CHANGED');await output.sync()}finally{await output.close()}
  if(options.preserveMtime!==false)await utimes(target,file.mtimeMs/1000,file.mtimeMs/1000)
 }
}
export function databaseState(db:Database.Database){
 const tables=(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string;sql:string}[])
 // Keep the original UTF-16 row ordering and canonical JSON byte contract, but
 // process one table at a time and hash its strings as they are emitted. This
 // avoids retaining every table plus one large serialized copy simultaneously.
 const digest=createHash('sha256'),counts:[string,number][]=[];digest.update('{"records":[')
 for(let i=0;i<tables.length;i++){const t=tables[i],rows:string[]=[];let invalid=false,encodingError:unknown
  // The former .all().map(...) completed the SQL read before reporting a row
  // encoding error. Drain the iterator after the first such error so a later
  // SQLite read failure keeps its original precedence, without storing rows.
  for(const row of db.prepare('SELECT * FROM "'+t.name.replaceAll('"','""')+'"').iterate())if(!invalid){try{rows.push(canonicalContentJson(row as any))}catch(error){invalid=true;encodingError=error}}
  if(invalid)throw encodingError
  rows.sort();counts.push([t.name,rows.length]);if(i)digest.update(',')
  digest.update('{"name":').update(JSON.stringify(t.name)).update(',"rows":[')
  for(let n=0;n<rows.length;n++){if(n)digest.update(',');digest.update(JSON.stringify(rows[n]))}
  digest.update('],"sql":').update(JSON.stringify(t.sql)).update('}')
 }
 const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
 digest.update('],"schema":').update(canonicalContentJson(schema as any)).update('}')
 return {stateHash:digest.digest('hex'),counts:Object.fromEntries(counts)}
}
export function readDatabaseState(path:string){const db=new Database(path,{readonly:true,fileMustExist:true});try{return databaseState(db)}finally{db.close()}}
export async function workspaceState(root:string){return canonicalHash({database:readDatabaseState(join(root,'flymind.sqlite')).stateHash,artifacts:await inventory(join(root,'artifacts'))})}
export async function supplyFingerprint(projectRoot?:string){
 const assets=resolveRuntimeAssets(projectRoot);await checkRuntimeAssets(assets)
 const paths={drawioSupply:join(dirname(assets.drawioRoot),'supply.json'),drawioApp:join(assets.drawioRoot,'js/app.min.js'),fontSupply:join(assets.fontRoot,'supply.json'),font:join(assets.fontRoot,'NotoSansCJKsc-Regular.otf'),fontLicense:join(assets.fontRoot,'OFL.txt'),browser:assets.browserExecutable}
 const fingerprints:Record<string,string>={};for(const [name,path] of Object.entries(paths))fingerprints[name]=await hashFile(path)
 const declared=JSON.parse(await readFile(paths.drawioSupply,'utf8')),vendor=await inventory(assets.drawioRoot)
 if(declared.version!=='31.5.3'||declared.archiveSha256!=='6c4ab25145c3479bf0097e4fccd20c602968615986bc999af8a214719fabd3f4'||!Array.isArray(declared.files)||declared.files.length!==vendor.length)throw new StoreError('draw.io供应清单无效',409,undefined,'BACKUP_SUPPLY_MISMATCH')
 const expected=new Map<string,any>(declared.files.map((f:any)=>[f.path,f]));for(const actual of vendor){const file=expected.get(actual.path);if(!file||file.bytes!==actual.bytes||file.sha256!==actual.sha256)throw new StoreError('draw.io供应文件与固定清单不符',409,undefined,'BACKUP_SUPPLY_MISMATCH')}
 const fingerprintTree=(files:BackupFile[])=>canonicalHash(files.map(({path,bytes,sha256})=>({path,bytes,sha256})))
 fingerprints.vendorTree=fingerprintTree(vendor);fingerprints.browserTree=fingerprintTree(await inventory(dirname(assets.browserExecutable)))
 fingerprints.playwrightRegistry=hash(await readFile(join(dirname(createRequire(import.meta.url).resolve('playwright-core/package.json')),'browsers.json')))
 return fingerprints
}
function jobRow(row:any):StoredNativeExport{return {id:row.id,diagramId:row.diagram_id,dataRootId:row.data_root_id,revision:row.revision,requestId:row.request_id,requestHash:row.request_hash,snapshot:JSON.parse(row.snapshot),snapshotSha256:row.snapshot_hash,options:JSON.parse(row.options),...(row.release?{release:JSON.parse(row.release)}:{}),status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,attempts:row.attempts,leaseToken:row.lease_token,manifest:row.manifest?JSON.parse(row.manifest):undefined}}
/** Preserve .all().map(jobRow) ordering and SQL-error precedence without retaining raw rows. */
export function readExportJobs(db:Database.Database):StoredNativeExport[]{
 const jobs:StoredNativeExport[]=[];let failed=false,parseError:unknown
 for(const row of db.prepare('SELECT * FROM native_export_jobs').iterate())if(!failed){try{jobs.push(jobRow(row))}catch(error){failed=true;parseError=error}}
 if(failed)throw parseError
 return jobs
}
export async function validateWorkspace(root:string){
 root=await plainDirectory(root)
 const databaseFile=join(root,'flymind.sqlite');if((await lstat(databaseFile)).isSymbolicLink()||!insideDirectory(root,await realpath(databaseFile)))throw new StoreError('数据库文件路径越界',400,undefined,'BACKUP_PATH_INVALID')
 const db=new Database(join(root,'flymind.sqlite'),{readonly:true,fileMustExist:true})
 try{
  if(db.pragma('integrity_check',{simple:true})!=='ok'||(db.pragma('foreign_key_check') as unknown[]).length)throw new StoreError('数据库完整性或外键校验失败',400,undefined,'BACKUP_DATABASE_INVALID')
  const state=databaseState(db),rows=db.prepare('SELECT * FROM diagrams').all() as any[],ids=new Set(rows.map(r=>r.id))
  for(let i=0;i<rows.length;i++){const row=rows[i];rows[i]=undefined;const record=decodeDiagramRow(row);if(record.format===3)await validateNativeProject(record.document);const history=db.prepare('SELECT document,saved_at FROM diagram_versions WHERE diagram_id=? AND revision=?').get(row.id,row.revision) as {document:string;saved_at:number}|undefined;if(!history||history.document!==row.document||history.saved_at!==row.saved_at)throw new StoreError('当前修订与历史快照不符',400,undefined,'BACKUP_HISTORY_INVALID')}
  if(db.prepare('SELECT 1 FROM diagrams d JOIN diagram_tombstones t ON t.id=d.id LIMIT 1').get())throw new StoreError('永久删除标记与现存图冲突',400,undefined,'BACKUP_TOMBSTONE_INVALID')
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='native_import_sources'").get())for(const row of db.prepare('SELECT * FROM native_import_sources').all() as any[]){const source=JSON.parse(row.source) as NativeImportSource;if(!ids.has(row.diagram_id)||source.diagramId!==row.diagram_id||source.importId!==row.import_id)throw new StoreError('导入来源身份不符',400,undefined,'BACKUP_IMPORT_INVALID');await readImportSource(root,source)}
  const versions=db.prepare('SELECT * FROM diagram_versions').all() as any[]
  for(let i=0;i<versions.length;i++){const row=versions[i];versions[i]=undefined;const d=JSON.parse(row.document);if(!ids.has(row.diagram_id)||(d.content?.id??d.id)!==row.diagram_id)throw new StoreError('历史身份不符');if(d.schemaVersion===3)await validateNativeProject(d);else validateDocument(d)}
  const workspace=db.prepare("SELECT value FROM metadata WHERE key='native_workspace_id'").get() as {value:string}|undefined,dataRootId=workspace?workspaceDataRootId(workspace.value):null
  const hasExports=db.prepare("SELECT 1 FROM sqlite_master WHERE name='native_export_jobs'").get(),jobs:StoredNativeExport[]=hasExports?readExportJobs(db):[]
  const retiredJobIds:string[]=[]
  for(const job of jobs){const project=await validateNativeProject(job.snapshot);if(nativeIdentity(project).id!==job.diagramId||canonicalHash(project)!==job.snapshotSha256)throw new StoreError('任务快照不符',400,undefined,'BACKUP_SNAPSHOT_INVALID')
   if(!ids.has(job.diagramId)){
    if(!db.prepare('SELECT 1 FROM diagram_tombstones WHERE id=?').get(job.diagramId)||db.prepare('SELECT 1 FROM diagram_versions WHERE diagram_id=? LIMIT 1').get(job.diagramId))throw new StoreError('导出图形缺失且没有合法永久删除来源',400,undefined,'BACKUP_HISTORY_INVALID')
    retiredJobIds.push(job.id);continue
   }
   const history=db.prepare('SELECT document FROM diagram_versions WHERE diagram_id=? AND revision=?').get(job.diagramId,job.revision) as {document:string}|undefined
   if(!history||canonicalHash(JSON.parse(history.document))!==job.snapshotSha256)throw new StoreError('任务快照没有同修订历史来源',400,undefined,'BACKUP_HISTORY_INVALID')
   if(job.status==='succeeded'){
    if(!job.manifest||job.manifest.exportId!==job.id||job.manifest.diagramId!==job.diagramId||job.manifest.revision!==job.revision||job.manifest.dataRootId!==job.dataRootId||job.manifest.snapshotSha256!==job.snapshotSha256)throw new StoreError('任务清单绑定不符')
    if(job.dataRootId!==dataRootId){const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE name='restored_export_bindings'").get(),binding=exists?db.prepare('SELECT * FROM restored_export_bindings WHERE job_id=?').get(job.id) as any:undefined;if(!binding||binding.target_data_root_id!==dataRootId||binding.source_data_root_id!==job.dataRootId||binding.manifest_sha256!==canonicalHash(job.manifest))throw new StoreError('恢复来源绑定不符',400,undefined,'BACKUP_BINDING_INVALID')}
    for(const format of nativeExportFormats(job.snapshot))await verifyNativeArtifact(root,job,format)
   }
  }
  return {...state,dataRootId,jobs,retiredJobIds:retiredJobIds.sort()}
 }finally{db.close()}
}
export async function createWorkspaceBackup(options:{sourceRoot:string;backupRoot:string;projectRoot?:string}){
 const source=await plainDirectory(resolve(options.sourceRoot)),destination=await canonicalFutureDirectory(options.backupRoot);assertIsolatedNativeRoot(source,PROJECT_ROOT);if(options.projectRoot)assertIsolatedNativeRoot(source,options.projectRoot)
 const within=(parent:string,child:string)=>{const path=relative(parent,child);return path===''||path!=='..'&&!path.startsWith('..'+sep)&&!isAbsolute(path)}
 if(within(source,destination)||within(destination,source))throw new StoreError('备份根必须独立于源根',400,undefined,'BACKUP_PATH_INVALID')
 const backupId='backup_'+randomUUID(),staging=join(destination,'.'+backupId+'.pending'),published=join(destination,backupId);await mkdir(staging,{recursive:true})
 const db=new Database(join(source,'flymind.sqlite'),{readonly:true,fileMustExist:true});try{await db.backup(join(staging,'flymind.sqlite'))}finally{db.close()}
 const artifacts=await inventory(join(source,'artifacts'));await copyVerified(join(source,'artifacts'),join(staging,'artifacts'),artifacts)
 const checked=await validateWorkspace(staging),supply=await supplyFingerprint(options.projectRoot)
 const manifest:WorkspaceBackupManifest={schemaVersion:1,backupId,createdAt:Date.now(),sourceDataRootId:checked.dataRootId,database:{sha256:await hashFile(join(staging,'flymind.sqlite')),stateHash:checked.stateHash,counts:checked.counts},artifacts,supply,requiredSupply:'matching-local-installation',retiredJobIds:checked.retiredJobIds}
 await writeDurable(join(staging,'manifest.json'),manifest);await validateWorkspaceBackup(staging,options.projectRoot);await rename(staging,published)
 return {backupRoot:published,manifest}
}
export async function validateWorkspaceBackup(root:string,projectRoot?:string){
 root=await plainDirectory(root);const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8')) as WorkspaceBackupManifest
 if(manifest.schemaVersion!==1||manifest.requiredSupply!=='matching-local-installation'||!Array.isArray(manifest.artifacts)||!/^[a-zA-Z0-9_-]+$/.test(manifest.backupId))throw new StoreError('备份格式不支持',400,undefined,'BACKUP_MANIFEST_INVALID')
 if(await hashFile(join(root,'flymind.sqlite'))!==manifest.database.sha256)throw new StoreError('备份数据库摘要不符',400,undefined,'BACKUP_DATABASE_INVALID')
 const files=await inventory(join(root,'artifacts'));if(files.length!==manifest.artifacts.length)throw new StoreError('备份制品数量不符')
 for(const file of manifest.artifacts){beneath(join(root,'artifacts'),file.path);const actual=files.find(f=>f.path===file.path);if(!actual||actual.bytes!==file.bytes||actual.sha256!==file.sha256||Math.abs(actual.mtimeMs-file.mtimeMs)>5)throw new StoreError('备份制品摘要/时间不符',400,undefined,'BACKUP_ARTIFACT_INVALID')}
 if(canonicalHash(await supplyFingerprint(projectRoot))!==canonicalHash(manifest.supply))throw new StoreError('固定供应指纹不同或缺失',409,undefined,'BACKUP_SUPPLY_MISMATCH')
 const checked=await validateWorkspace(root);if(checked.stateHash!==manifest.database.stateHash||checked.dataRootId!==manifest.sourceDataRootId||canonicalHash(checked.retiredJobIds)!==canonicalHash(manifest.retiredJobIds))throw new StoreError('备份逻辑状态不符',400,undefined,'BACKUP_DATABASE_INVALID')
 return {manifest,checked,manifestHash:canonicalHash(manifest)}
}
