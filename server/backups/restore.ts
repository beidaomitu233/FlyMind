import Database from 'better-sqlite3'
import {mkdir,readFile,lstat,rename,rm,open} from 'node:fs/promises'
import {resolve,join,sep} from 'node:path'
import {randomUUID} from 'node:crypto'
import {runtimeConfiguration} from '../runtime-instance/config'
import {acquireRuntimeLease,type RuntimeLease} from '../runtime-instance/lock'
import type {EnsureNativeRuntimeOptions} from '../runtime-instance/types'
import {workspaceDataRootId} from '../native-pilot'
import {StoreError} from '../store'
import {RESTORE_MARKER} from './marker'
import {beneath,canonicalHash,copyVerified,hash,inventory,plainDirectory,validateWorkspace,validateWorkspaceBackup,workspaceState,writeDurable} from './workspace'
export {RESTORE_MARKER}
export interface RestorePlan {schemaVersion:1;planId:string;backupRoot:string;backupManifestHash:string;targetRoot:string;targetStateHash:string;createdAt:number}
type Component={name:string;oldHash:string|null;newHash:string|null}
interface Journal {schemaVersion:1;restoreId:string;protection:string;staging:string;components:Component[];phase:string}
const names=['flymind.sqlite','flymind.sqlite-wal','flymind.sqlite-shm','artifacts']
async function exists(path:string){try{await lstat(path);return true}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e}}
async function componentHash(root:string,name:string){const path=join(root,name);if(!await exists(path))return null;const s=await lstat(path);if(s.isSymbolicLink())throw new StoreError('恢复组件不可为符号链接');return s.isDirectory()?canonicalHash(await inventory(path)):hash(await readFile(path))}
async function journalWrite(root:string,journal:Journal){const marker=join(root,RESTORE_MARKER),temporary=marker+'.'+randomUUID()+'.tmp';await writeDurable(temporary,journal);await rename(temporary,marker)}
async function maintenance<T>(options:EnsureNativeRuntimeOptions,fn:(root:string,lease:RuntimeLease)=>Promise<T>){
 const config=runtimeConfiguration(options),lease=await acquireRuntimeLease(config)
 if(!lease)throw new StoreError('必须先关闭该数据根的Runtime；未终止任何进程',423,undefined,'RESTORE_RUNTIME_ACTIVE')
 try{await plainDirectory(config.dataRoot);return await fn(config.dataRoot,lease)}finally{await lease.release()}
}
async function noJournal(root:string){if(await exists(join(root,RESTORE_MARKER)))throw new StoreError('存在未完成恢复，必须先显式回退',423,undefined,'RESTORE_RECOVERY_REQUIRED')}
async function auditOnce(path:string,value:{restoreId:string;[key:string]:unknown}){if(await exists(path)){const previous=JSON.parse(await readFile(path,'utf8'));if(previous.restoreId!==value.restoreId)throw new StoreError('维护审计记录身份不符');return}await writeDurable(path,value)}
export async function planWorkspaceRestore(options:EnsureNativeRuntimeOptions&{backupRoot:string}){
 return maintenance(options,async root=>{await noJournal(root);const backupRoot=resolve(options.backupRoot),checked=await validateWorkspaceBackup(backupRoot,options.projectRoot)
  if(backupRoot===root||backupRoot.startsWith(root+sep)||root.startsWith(backupRoot+sep))throw new StoreError('恢复备份必须位于独立目录')
  await validateWorkspace(root)
  return {schemaVersion:1,planId:'restore_'+randomUUID(),backupRoot,backupManifestHash:checked.manifestHash,targetRoot:root,targetStateHash:await workspaceState(root),createdAt:Date.now()} as RestorePlan
 })
}
function rotateIdentity(path:string,restoreId:string){
 const db=new Database(path);try{db.pragma('foreign_keys=ON');db.pragma('journal_mode=DELETE');return db.transaction(()=>{
  const workspaceId=randomUUID(),target=workspaceDataRootId(workspaceId)
  db.exec('CREATE TABLE IF NOT EXISTS restored_export_bindings(job_id TEXT PRIMARY KEY,source_data_root_id TEXT NOT NULL,target_data_root_id TEXT NOT NULL,manifest_sha256 TEXT NOT NULL,restore_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS restored_request_barriers(scope TEXT NOT NULL,request_id TEXT NOT NULL,restore_id TEXT NOT NULL,PRIMARY KEY(scope,request_id)); CREATE TABLE IF NOT EXISTS restored_receipt_archive(restore_id TEXT NOT NULL,scope TEXT NOT NULL,request_id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(restore_id,scope,request_id))')
  const table=(name:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
  for(const [scope,name] of [['mutation','native_mutation_requests'],['migration','native_migration_records']] as const)if(table(name)){
   for(const row of db.prepare('SELECT * FROM '+name).all() as any[]){db.prepare('INSERT INTO restored_receipt_archive VALUES(?,?,?,?)').run(restoreId,scope,row.request_id,JSON.stringify(row));db.prepare('INSERT OR REPLACE INTO restored_request_barriers VALUES(?,?,?)').run(scope,row.request_id,restoreId)}if(scope==='mutation')db.exec('DELETE FROM '+name)
  }
  if(table('native_export_jobs'))for(const row of db.prepare('SELECT * FROM native_export_jobs').all() as any[]){
   db.prepare('INSERT OR REPLACE INTO restored_request_barriers VALUES(?,?,?)').run('export',row.request_id,restoreId)
   if(row.status==='succeeded'&&db.prepare('SELECT 1 FROM diagrams WHERE id=?').get(row.diagram_id)){const manifest=JSON.parse(row.manifest);db.prepare('INSERT OR REPLACE INTO restored_export_bindings VALUES(?,?,?,?,?)').run(row.id,row.data_root_id,target,canonicalHash(manifest),restoreId)}
   else if(['queued','running'].includes(row.status))db.prepare("UPDATE native_export_jobs SET status='failed',lease_owner=NULL,lease_token=NULL,lease_until=NULL,error=?,updated_at=? WHERE id=?").run(JSON.stringify({code:'RESTORED_INTERRUPTED',message:'工作区恢复后旧租约已作废；请针对当前修订新建导出'}),Date.now(),row.id)
  }
  db.prepare("INSERT OR REPLACE INTO metadata VALUES('native_workspace_id',?)").run(workspaceId)
  db.prepare("INSERT OR REPLACE INTO metadata VALUES('last_restore_id',?)").run(restoreId)
  return target
 }).immediate()}finally{db.close()}
}
/** Offline-only switch. Hook is dependency injection for controlled crash/failure verification. */
export async function applyWorkspaceRestore(options:EnsureNativeRuntimeOptions&{plan:RestorePlan;afterComponent?:(name:string)=>Promise<void>}){
 return maintenance(options,async root=>{
  await noJournal(root);const plan=options.plan
  if(plan.schemaVersion!==1||plan.targetRoot!==root||!/^[a-zA-Z0-9_-]+$/.test(plan.planId)||resolve(plan.backupRoot)===root||resolve(plan.backupRoot).startsWith(root+sep)||root.startsWith(resolve(plan.backupRoot)+sep))throw new StoreError('恢复计划无效',400,undefined,'RESTORE_PLAN_INVALID')
  const backup=await validateWorkspaceBackup(plan.backupRoot,options.projectRoot)
  if(backup.manifestHash!==plan.backupManifestHash||await workspaceState(root)!==plan.targetStateHash)throw new StoreError('恢复预览后目标或备份已有修改，拒绝覆盖',409,undefined,'RESTORE_TARGET_CHANGED')
  const protection='.restore-protection/'+plan.planId,staging='.restore-staging/'+plan.planId,protectedRoot=beneath(root,protection),stagedRoot=beneath(root,staging)
  await mkdir(protectedRoot,{recursive:true});await mkdir(stagedRoot,{recursive:true});await plainDirectory(protectedRoot);await plainDirectory(stagedRoot)
  await writeDurable(join(stagedRoot,'flymind.sqlite'),await readFile(join(plan.backupRoot,'flymind.sqlite')))
  await copyVerified(join(plan.backupRoot,'artifacts'),join(stagedRoot,'artifacts'),backup.manifest.artifacts)
  const dataRootId=rotateIdentity(join(stagedRoot,'flymind.sqlite'),plan.planId);await validateWorkspace(stagedRoot)
  if(await workspaceState(root)!==plan.targetStateHash)throw new StoreError('暂存期间目标已有修改',409,undefined,'RESTORE_TARGET_CHANGED')
  const components:Component[]=[];for(const name of names)components.push({name,oldHash:await componentHash(root,name),newHash:await componentHash(stagedRoot,name)})
  const journal:Journal={schemaVersion:1,restoreId:plan.planId,protection,staging,components,phase:'prepared'}
  await journalWrite(root,journal)
  try{
   for(const c of components){if(c.oldHash!==null)await rename(join(root,c.name),join(protectedRoot,c.name));if(c.newHash!==null)await rename(join(stagedRoot,c.name),join(root,c.name));journal.phase='switched:'+c.name;await journalWrite(root,journal);await options.afterComponent?.(c.name)}
   await validateWorkspace(root);journal.phase='complete';await journalWrite(root,journal)
   await auditOnce(join(protectedRoot,'completed-restore.json'),{restoreId:plan.planId,previousStateHash:plan.targetStateHash,newDataRootId:dataRootId,backupManifestHash:plan.backupManifestHash,completedAt:Date.now()})
   await rm(join(root,RESTORE_MARKER));return {restoreId:plan.planId,dataRootId,protectionRoot:protectedRoot}
  }catch(error){
   // Preserve journal and protected components. Explicit recovery, never an implicit retry.
   throw new StoreError('恢复中断；保留保护副本，运行 recover 显式回退。原因：'+(error as Error).message,500,undefined,'RESTORE_RECOVERY_REQUIRED')
  }
 })
}
export async function recoverWorkspaceRestore(options:EnsureNativeRuntimeOptions&{afterAudit?:()=>Promise<void>}){
 return maintenance(options,async root=>{
  const marker=join(root,RESTORE_MARKER),j=JSON.parse(await readFile(marker,'utf8')) as Journal
  if(j.schemaVersion!==1||!/^[a-zA-Z0-9_-]+$/.test(j.restoreId)||j.protection!=='.restore-protection/'+j.restoreId||j.staging!=='.restore-staging/'+j.restoreId||!Array.isArray(j.components)||j.components.length!==names.length||j.components.some((c,i)=>c.name!==names[i]||![c.oldHash,c.newHash].every(h=>h===null||/^[a-f0-9]{64}$/.test(h))))throw new StoreError('恢复journal无效；拒绝猜测或越界回退',400,undefined,'RESTORE_JOURNAL_INVALID')
  const protectedRoot=beneath(root,j.protection),stagedRoot=beneath(root,j.staging);await plainDirectory(protectedRoot);await plainDirectory(stagedRoot)
  // First validate every component; no changes on an ambiguous/tampered journal.
  const operations=[]
  for(const c of j.components){const current=await componentHash(root,c.name),old=await componentHash(protectedRoot,c.name)
   if(current===c.oldHash&&old===null){operations.push({c,restore:false});continue}
   if(old!==c.oldHash||current!==null&&current!==c.newHash)throw new StoreError('组件摘要不能安全回退，保留现场',409,undefined,'RESTORE_RECOVERY_AMBIGUOUS')
   operations.push({c,restore:true})
  }
  for(const {c,restore} of operations.reverse())if(restore){if(await exists(join(root,c.name))){const retired=join(stagedRoot,'rollback-'+c.name);if(await exists(retired))throw new StoreError('回退目标已存在，保留现场');await rename(join(root,c.name),retired)}if(c.oldHash!==null)await rename(join(protectedRoot,c.name),join(root,c.name))}
  await validateWorkspace(root);await auditOnce(join(protectedRoot,'rolled-back.json'),{restoreId:j.restoreId,at:Date.now()});await options.afterAudit?.();await rm(marker)
  return {restoreId:j.restoreId,rolledBack:true}
 })
}
