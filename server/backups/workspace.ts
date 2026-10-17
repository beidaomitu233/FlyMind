import Database from 'better-sqlite3'
import {createRequire} from 'node:module'
import {createHash,randomUUID} from 'node:crypto'
import {mkdir,readFile,readdir,lstat,realpath,open,rename,utimes,stat} from 'node:fs/promises'
import {resolve,join,relative,sep,isAbsolute,dirname} from 'node:path'
import {canonicalContentJson} from '../../src/drawing/engine/content-hash'
import {validateNativeProject,nativeIdentity} from '../document-record'
import {validateDocument} from '../../src/drawing/core/model'
import {decodeDiagramRow} from '../document-record'
import {StoreError,PROJECT_ROOT} from '../store'
import {assertIsolatedNativeRoot,workspaceDataRootId} from '../native-pilot'
import {resolveRuntimeAssets,checkRuntimeAssets} from '../rendering/assets'
import {readNativeArtifact} from '../exports/artifacts'
import {nativeExportFormats,type StoredNativeExport} from '../exports/types'
import {readImportSource,type NativeImportSource} from '../imports/source'
export const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex')
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
export async function plainDirectory(root:string){if((await lstat(root)).isSymbolicLink()||!(await lstat(root)).isDirectory()||resolve(await realpath(root)).toLowerCase()!==resolve(root).toLowerCase())throw new StoreError('拒绝符号链接/重定向目录',400,undefined,'BACKUP_PATH_INVALID')}
export async function writeDurable(path:string,value:unknown){const f=await open(path,'wx');try{await f.writeFile(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2));await f.sync()}finally{await f.close()}}
export async function inventory(root:string):Promise<BackupFile[]>{
 const files:BackupFile[]=[],paths:string[]=[]
 async function walk(dir:string){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isSymbolicLink())throw new StoreError('备份不接受符号链接',400,undefined,'BACKUP_PATH_INVALID');if(e.isDirectory()){await plainDirectory(p);await walk(p)}else if(e.isFile())paths.push(p);else throw new StoreError('不支持的文件类型')}}
 try{await plainDirectory(root)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e}
 await walk(root)
 let next=0;await Promise.all(Array.from({length:Math.min(paths.length,16)},async()=>{while(next<paths.length){const p=paths[next++],s=await lstat(p);if(s.isSymbolicLink()||!s.isFile()||!(await realpath(p)).startsWith(resolve(root)+sep))throw new StoreError('备份文件路径已改变',400,undefined,'BACKUP_PATH_INVALID');const bytes=await readFile(p);files.push({path:relative(root,p).split(sep).join('/'),bytes:bytes.length,sha256:hash(bytes),mtimeMs:s.mtimeMs})}}))
 return files.sort((a,b)=>a.path.localeCompare(b.path))
}
export async function copyVerified(sourceRoot:string,targetRoot:string,files:BackupFile[]){
 await mkdir(targetRoot,{recursive:true});await plainDirectory(targetRoot)
 for(const file of files){const source=beneath(sourceRoot,file.path),target=beneath(targetRoot,file.path),sourceReal=await realpath(source);if(!sourceReal.startsWith(resolve(sourceRoot)+sep)||(await lstat(source)).isSymbolicLink())throw new StoreError('制品源路径越界')
  const bytes=await readFile(source);if(bytes.length!==file.bytes||hash(bytes)!==file.sha256)throw new StoreError('备份复制期间制品已改变',409,undefined,'BACKUP_SOURCE_CHANGED')
  await mkdir(resolve(target,'..'),{recursive:true});await writeDurable(target,bytes);await utimes(target,file.mtimeMs/1000,file.mtimeMs/1000)
 }
}
export function databaseState(db:Database.Database){
 const tables=(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string;sql:string}[])
 const records=tables.map(t=>({name:t.name,sql:t.sql,rows:db.prepare('SELECT * FROM "'+t.name.replaceAll('"','""')+'"').all().map(row=>canonicalContentJson(row as any)).sort()}))
 const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
 return {stateHash:canonicalHash({schema,records}),counts:Object.fromEntries(records.map(t=>[t.name,t.rows.length]))}
}
export function readDatabaseState(path:string){const db=new Database(path,{readonly:true,fileMustExist:true});try{return databaseState(db)}finally{db.close()}}
export async function workspaceState(root:string){return canonicalHash({database:readDatabaseState(join(root,'flymind.sqlite')).stateHash,artifacts:await inventory(join(root,'artifacts'))})}
export async function supplyFingerprint(projectRoot?:string){
 const assets=resolveRuntimeAssets(projectRoot);await checkRuntimeAssets(assets)
 const paths={drawioSupply:join(dirname(assets.drawioRoot),'supply.json'),drawioApp:join(assets.drawioRoot,'js/app.min.js'),fontSupply:join(assets.fontRoot,'supply.json'),font:join(assets.fontRoot,'NotoSansCJKsc-Regular.otf'),fontLicense:join(assets.fontRoot,'OFL.txt'),browser:assets.browserExecutable}
 const fingerprints=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([name,path])=>[name,hash(await readFile(path))]))) as Record<string,string>
 const declared=JSON.parse(await readFile(paths.drawioSupply,'utf8')),vendor=await inventory(assets.drawioRoot)
 if(declared.version!=='31.5.3'||declared.archiveSha256!=='6c4ab25145c3479bf0097e4fccd20c602968615986bc999af8a214719fabd3f4'||!Array.isArray(declared.files)||declared.files.length!==vendor.length)throw new StoreError('draw.io供应清单无效',409,undefined,'BACKUP_SUPPLY_MISMATCH')
 const expected=new Map<string,any>(declared.files.map((f:any)=>[f.path,f]));for(const actual of vendor){const file=expected.get(actual.path);if(!file||file.bytes!==actual.bytes||file.sha256!==actual.sha256)throw new StoreError('draw.io供应文件与固定清单不符',409,undefined,'BACKUP_SUPPLY_MISMATCH')}
 const fingerprintTree=(files:BackupFile[])=>canonicalHash(files.map(({path,bytes,sha256})=>({path,bytes,sha256})))
 fingerprints.vendorTree=fingerprintTree(vendor);fingerprints.browserTree=fingerprintTree(await inventory(dirname(assets.browserExecutable)))
 fingerprints.playwrightRegistry=hash(await readFile(join(dirname(createRequire(import.meta.url).resolve('playwright-core/package.json')),'browsers.json')))
 return fingerprints
}
function jobRow(row:any):StoredNativeExport{return {id:row.id,diagramId:row.diagram_id,dataRootId:row.data_root_id,revision:row.revision,requestId:row.request_id,requestHash:row.request_hash,snapshot:JSON.parse(row.snapshot),snapshotSha256:row.snapshot_hash,options:JSON.parse(row.options),status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,attempts:row.attempts,leaseToken:row.lease_token,manifest:row.manifest?JSON.parse(row.manifest):undefined}}
export async function validateWorkspace(root:string){
 const databaseFile=join(root,'flymind.sqlite');if((await lstat(databaseFile)).isSymbolicLink()||!resolve(await realpath(databaseFile)).startsWith(resolve(root)+sep))throw new StoreError('数据库文件路径越界',400,undefined,'BACKUP_PATH_INVALID')
 const db=new Database(join(root,'flymind.sqlite'),{readonly:true,fileMustExist:true})
 try{
  if(db.pragma('integrity_check',{simple:true})!=='ok'||(db.pragma('foreign_key_check') as unknown[]).length)throw new StoreError('数据库完整性或外键校验失败',400,undefined,'BACKUP_DATABASE_INVALID')
  const state=databaseState(db),rows=db.prepare('SELECT * FROM diagrams').all() as any[],ids=new Set(rows.map(r=>r.id))
  for(const row of rows){const record=decodeDiagramRow(row);if(record.format===3)await validateNativeProject(record.document);const history=db.prepare('SELECT document,saved_at FROM diagram_versions WHERE diagram_id=? AND revision=?').get(row.id,row.revision) as {document:string;saved_at:number}|undefined;if(!history||history.document!==row.document||history.saved_at!==row.saved_at)throw new StoreError('当前修订与历史快照不符',400,undefined,'BACKUP_HISTORY_INVALID')}
  if(db.prepare('SELECT 1 FROM diagrams d JOIN diagram_tombstones t ON t.id=d.id LIMIT 1').get())throw new StoreError('永久删除标记与现存图冲突',400,undefined,'BACKUP_TOMBSTONE_INVALID')
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='native_import_sources'").get())for(const row of db.prepare('SELECT * FROM native_import_sources').all() as any[]){const source=JSON.parse(row.source) as NativeImportSource;if(!ids.has(row.diagram_id)||source.diagramId!==row.diagram_id||source.importId!==row.import_id)throw new StoreError('导入来源身份不符',400,undefined,'BACKUP_IMPORT_INVALID');await readImportSource(root,source)}
  for(const row of db.prepare('SELECT * FROM diagram_versions').all() as any[]){const d=JSON.parse(row.document);if(!ids.has(row.diagram_id)||(d.content?.id??d.id)!==row.diagram_id)throw new StoreError('历史身份不符');if(d.schemaVersion===3)await validateNativeProject(d);else validateDocument(d)}
  const workspace=db.prepare("SELECT value FROM metadata WHERE key='native_workspace_id'").get() as {value:string}|undefined,dataRootId=workspace?workspaceDataRootId(workspace.value):null
  const hasExports=db.prepare("SELECT 1 FROM sqlite_master WHERE name='native_export_jobs'").get(),jobs:StoredNativeExport[]=hasExports?(db.prepare('SELECT * FROM native_export_jobs').all() as any[]).map(jobRow):[]
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
    for(const format of nativeExportFormats(job.snapshot))await readNativeArtifact(root,job,format)
   }
  }
  return {...state,dataRootId,jobs,retiredJobIds:retiredJobIds.sort()}
 }finally{db.close()}
}
export async function createWorkspaceBackup(options:{sourceRoot:string;backupRoot:string;projectRoot?:string}){
 const source=resolve(options.sourceRoot),destination=resolve(options.backupRoot);assertIsolatedNativeRoot(source,PROJECT_ROOT);if(options.projectRoot)assertIsolatedNativeRoot(source,options.projectRoot);await plainDirectory(source)
 if(destination===source||destination.startsWith(source+sep)||source.startsWith(destination+sep))throw new StoreError('备份根必须独立于源根',400,undefined,'BACKUP_PATH_INVALID')
 const backupId='backup_'+randomUUID(),staging=join(destination,'.'+backupId+'.pending'),published=join(destination,backupId);await mkdir(staging,{recursive:true})
 const db=new Database(join(source,'flymind.sqlite'),{readonly:true,fileMustExist:true});try{await db.backup(join(staging,'flymind.sqlite'))}finally{db.close()}
 const artifacts=await inventory(join(source,'artifacts'));await copyVerified(join(source,'artifacts'),join(staging,'artifacts'),artifacts)
 const checked=await validateWorkspace(staging),supply=await supplyFingerprint(options.projectRoot)
 const manifest:WorkspaceBackupManifest={schemaVersion:1,backupId,createdAt:Date.now(),sourceDataRootId:checked.dataRootId,database:{sha256:hash(await readFile(join(staging,'flymind.sqlite'))),stateHash:checked.stateHash,counts:checked.counts},artifacts,supply,requiredSupply:'matching-local-installation',retiredJobIds:checked.retiredJobIds}
 await writeDurable(join(staging,'manifest.json'),manifest);await validateWorkspaceBackup(staging,options.projectRoot);await rename(staging,published)
 return {backupRoot:published,manifest}
}
export async function validateWorkspaceBackup(root:string,projectRoot?:string){
 await plainDirectory(root);const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8')) as WorkspaceBackupManifest
 if(manifest.schemaVersion!==1||manifest.requiredSupply!=='matching-local-installation'||!Array.isArray(manifest.artifacts)||!/^[a-zA-Z0-9_-]+$/.test(manifest.backupId))throw new StoreError('备份格式不支持',400,undefined,'BACKUP_MANIFEST_INVALID')
 if(hash(await readFile(join(root,'flymind.sqlite')))!==manifest.database.sha256)throw new StoreError('备份数据库摘要不符',400,undefined,'BACKUP_DATABASE_INVALID')
 const files=await inventory(join(root,'artifacts'));if(files.length!==manifest.artifacts.length)throw new StoreError('备份制品数量不符')
 for(const file of manifest.artifacts){beneath(join(root,'artifacts'),file.path);const actual=files.find(f=>f.path===file.path);if(!actual||actual.bytes!==file.bytes||actual.sha256!==file.sha256||Math.abs(actual.mtimeMs-file.mtimeMs)>5)throw new StoreError('备份制品摘要/时间不符',400,undefined,'BACKUP_ARTIFACT_INVALID')}
 if(canonicalHash(await supplyFingerprint(projectRoot))!==canonicalHash(manifest.supply))throw new StoreError('固定供应指纹不同或缺失',409,undefined,'BACKUP_SUPPLY_MISMATCH')
 const checked=await validateWorkspace(root);if(checked.stateHash!==manifest.database.stateHash||checked.dataRootId!==manifest.sourceDataRootId||canonicalHash(checked.retiredJobIds)!==canonicalHash(manifest.retiredJobIds))throw new StoreError('备份逻辑状态不符',400,undefined,'BACKUP_DATABASE_INVALID')
 return {manifest,checked,manifestHash:canonicalHash(manifest)}
}
