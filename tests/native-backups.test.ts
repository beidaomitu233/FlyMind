import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,mkdir,writeFile,readFile,readdir,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import Database from 'better-sqlite3'
import sharp from 'sharp'
import {DiagramStore} from '../server/store'
import {NativeDiagramService} from '../server/application/native-diagrams'
import {NativeExportService} from '../server/application/native-exports'
import {NativeExportWorker} from '../server/exports/worker'
import {prepareNativeRuntime} from '../server/runtime-instance/boot'
import {runtimeConfiguration} from '../server/runtime-instance/config'
import {acquireRuntimeLease} from '../server/runtime-instance/lock'
import {createWorkspaceBackup,validateWorkspaceBackup,readDatabaseState,workspaceState} from '../server/backups/workspace'
import {planWorkspaceRestore,applyWorkspaceRestore,recoverWorkspaceRestore,RESTORE_MARKER} from '../server/backups/restore'
import type {DiagramContent} from '../src/drawing/core/model'
const content:DiagramContent={schemaVersion:1,id:'backup-native',kind:'swimlane',title:'备份恢复测试',nodes:[{id:'a',kind:'start',label:'开始',laneId:'r',phaseId:'p'},{id:'b',kind:'end',label:'结束',laneId:'r',phaseId:'p'}],edges:[{id:'ab',source:'a',target:'b'}],lanes:[{id:'r',label:'人员'}],phases:[{id:'p',label:'阶段'}],groups:[]}
async function setup(){const directory=await mkdtemp(join(tmpdir(),'flymind-backup-')),root=join(directory,'data'),store=new DiagramStore(root);try{await store.init();const native=new NativeDiagramService(store,true),identity=native.dataRootId!,record=await native.create({content,requestId:'initial'},identity),exports=new NativeExportService(store,true)
 const group=await store.createGroup('保留分组',identity);await store.moveStoredToGroup(content.id,group.id,null,identity)
 await store.delete('sample-flowchart',1,identity);await store.delete('sample-mindmap',1,identity);const deleted=(await store.listTrash()).find(r=>r.id==='sample-mindmap')!;await store.purge(deleted.id,deleted.revision,deleted.deletedAt,identity)
 const worker=new NativeExportWorker(store,{async render(project){return {png:await sharp({create:{width:20,height:12,channels:4,background:'#ffffff'}}).png().toBuffer(),svg:'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="12"/>',width:20,height:12,scale:1,nativeXML:project.rendering.engine.xml,runtime:{mock:'unit-only'},timings:{totalMs:1,browserStartMs:0,loadMs:0,exportMs:1},warnings:[]}},async close(){}})
 const job=await exports.create(content.id,{expectedRevision:1,requestId:'initial-export'},identity);await worker.runOnce();assert.equal((await exports.get(job.id)).status,'succeeded',JSON.stringify(await exports.get(job.id)))
 await native.create({content:{...content,id:'retired-native'},requestId:'retired-create'},identity);const retiredJob=await exports.create('retired-native',{expectedRevision:1,requestId:'retired-export'},identity);await worker.runOnce();await worker.close();await store.delete('retired-native',1,identity);const retired=(await store.listTrash()).find(r=>r.id==='retired-native')!;await store.purge(retired.id,retired.revision,retired.deletedAt,identity)
 const pendingJob=await exports.create(content.id,{expectedRevision:1,requestId:'pending-before-backup'},identity)
 const options={dataRoot:root,privateRuntimeRoot:join(directory,'private'),env:{...process.env,FLYMIND_NATIVE_PILOT:'1',FLYMIND_DATA_DIR:root},port:0}
 return {directory,root,store,native,exports,identity,record,group,job,retiredJob,pendingJob,options,backups:join(directory,'backups')}
 }catch(error){await cleanup(directory);throw error}
}
async function cleanup(root:string){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-backup-'));await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:100})}
test('complete backup validates five artifacts; restore rejects new edits/schema then rotates identity preserving mixed state',async()=>{
 const s=await setup();try{
  const backup=await createWorkspaceBackup({sourceRoot:s.root,backupRoot:s.backups}),manifest=backup.manifest;assert.equal(manifest.artifacts.length,6);assert.deepEqual(manifest.retiredJobIds,[s.retiredJob.id]);await validateWorkspaceBackup(backup.backupRoot)
  const plan=await planWorkspaceRestore({...s.options,backupRoot:backup.backupRoot});await s.native.patchContent(content.id,{expectedRevision:1,requestId:'new-edit',operations:[{op:'set_title',title:'恢复前的新修改'}]},s.identity)
  const edited=await workspaceState(s.root);await assert.rejects(applyWorkspaceRestore({...s.options,plan}),(e:any)=>e.code==='RESTORE_TARGET_CHANGED');assert.equal(await workspaceState(s.root),edited)
  const plan2=await planWorkspaceRestore({...s.options,backupRoot:backup.backupRoot}),db=new Database(s.store.databasePath);try{db.exec('CREATE INDEX test_schema_change ON diagrams(saved_at)')}finally{db.close()}
  await assert.rejects(applyWorkspaceRestore({...s.options,plan:plan2}),(e:any)=>e.code==='RESTORE_TARGET_CHANGED')
  const plan3=await planWorkspaceRestore({...s.options,backupRoot:backup.backupRoot}),result=await applyWorkspaceRestore({...s.options,plan:plan3});assert.notEqual(result.dataRootId,s.identity)
  const current=new NativeDiagramService(s.store,true);assert.equal((await current.get(content.id)).revision,1);assert.equal((await current.get(content.id)).workspaceGroupId,s.group.id);assert.equal((await s.store.listTrash()).some(r=>r.id==='sample-flowchart'),true);await assert.rejects(s.store.getStored('sample-mindmap'),(e:any)=>e.status===410)
  await assert.rejects(s.native.patchContent(content.id,{expectedRevision:1,requestId:'old-client',operations:[{op:'set_title',title:'不得回灌'}]},s.identity),(e:any)=>e.code==='WORKSPACE_MISMATCH')
  await assert.rejects(current.create({content,requestId:'initial'},result.dataRootId),(e:any)=>e.code==='REQUEST_EPOCH_CHANGED')
  await assert.rejects(s.exports.create(content.id,{expectedRevision:1,requestId:'initial-export'},result.dataRootId),(e:any)=>e.code==='REQUEST_EPOCH_CHANGED')
  const restoredFile=await s.exports.file(s.job.id,'png');assert.equal(restoredFile.sha256,manifest.artifacts.find(f=>f.path.endsWith('.png'))!.sha256)
  await assert.rejects(s.exports.file(s.retiredJob.id,'png'));await assert.rejects(current.create({content:{...content,id:'retired-native'},requestId:'cannot-revive'},result.dataRootId),(e:any)=>e.status===410)
  const retiredDb=new Database(s.store.databasePath,{readonly:true});try{assert.equal(retiredDb.prepare('SELECT 1 FROM restored_export_bindings WHERE job_id=?').get(s.retiredJob.id),undefined);const pending=retiredDb.prepare('SELECT status,error,lease_token FROM native_export_jobs WHERE id=?').get(s.pendingJob.id) as any;assert.equal(pending.status,'failed');assert.equal(JSON.parse(pending.error).code,'RESTORED_INTERRUPTED');assert.equal(pending.lease_token,null)}finally{retiredDb.close()}
  const again=await createWorkspaceBackup({sourceRoot:s.root,backupRoot:s.backups});assert.equal((await validateWorkspaceBackup(again.backupRoot)).manifest.sourceDataRootId,result.dataRootId)
  const state=readDatabaseState(s.store.databasePath);assert.ok(state.counts.restored_export_bindings===1&&state.counts.diagram_versions>=5)
 }finally{await cleanup(s.directory)}
})
test('mid-switch failure is fail-closed and explicit rollback is repeatable after audit-before-journal crash',async()=>{
 const s=await setup();try{const backup=await createWorkspaceBackup({sourceRoot:s.root,backupRoot:s.backups});await s.native.patchContent(content.id,{expectedRevision:1,requestId:'keep-new',operations:[{op:'set_title',title:'必须保护'}]},s.identity)
  const before=await workspaceState(s.root),plan=await planWorkspaceRestore({...s.options,backupRoot:backup.backupRoot}),legacy=await s.store.get('sample-dataflow')
  await assert.rejects(applyWorkspaceRestore({...s.options,plan,afterComponent:async name=>{if(name==='flymind.sqlite')throw Error('controlled interruption after DB switch before artifacts')}}),(e:any)=>e.code==='RESTORE_RECOVERY_REQUIRED')
  assert.ok((await stat(join(s.root,RESTORE_MARKER))).isFile());await assert.rejects(prepareNativeRuntime(s.options),(e:any)=>e.code==='RESTORE_RECOVERY_REQUIRED')
  const half=readDatabaseState(s.store.databasePath);await assert.rejects(s.store.init(),(e:any)=>e.code==='RESTORE_RECOVERY_REQUIRED');await assert.rejects(s.store.update('sample-dataflow',1,legacy.document),(e:any)=>e.code==='RESTORE_RECOVERY_REQUIRED');assert.deepEqual(readDatabaseState(s.store.databasePath),half)
  await assert.rejects(recoverWorkspaceRestore({...s.options,afterAudit:async()=>{throw Error('controlled crash after rollback audit')}}))
  const recovered=await recoverWorkspaceRestore(s.options);assert.equal(recovered.rolledBack,true);assert.equal(await workspaceState(s.root),before)
 }finally{await cleanup(s.directory)}
})
test('maintenance cannot acquire live Runtime lock; missing registered artifacts never publish a backup',async()=>{
 const s=await setup();try{const lease=await acquireRuntimeLease(runtimeConfiguration(s.options));assert.ok(lease)
  try{await assert.rejects(planWorkspaceRestore({...s.options,backupRoot:s.backups}),(e:any)=>e.code==='RESTORE_RUNTIME_ACTIVE')}finally{await lease.release()}
  const file=await s.exports.file(s.job.id,'png');await rm(file.path)
  await assert.rejects(createWorkspaceBackup({sourceRoot:s.root,backupRoot:s.backups}))
  assert.equal((await readdir(s.backups)).filter(n=>!n.startsWith('.')).length,0)
 }finally{await cleanup(s.directory)}
})
test('backup manifests reject traversal and supply mismatch instead of guessing a partial restore',async()=>{
 const s=await setup();try{const backup=await createWorkspaceBackup({sourceRoot:s.root,backupRoot:s.backups}),path=join(backup.backupRoot,'manifest.json'),original=await readFile(path,'utf8'),manifest=JSON.parse(original)
  manifest.artifacts[0].path='../private';await writeFile(path,JSON.stringify(manifest));await assert.rejects(validateWorkspaceBackup(backup.backupRoot),(e:any)=>e.code==='BACKUP_PATH_INVALID')
  const supply=JSON.parse(original);supply.supply.font='0'.repeat(64);await writeFile(path,JSON.stringify(supply));await assert.rejects(validateWorkspaceBackup(backup.backupRoot),(e:any)=>e.code==='BACKUP_SUPPLY_MISMATCH')
 }finally{await cleanup(s.directory)}
})
