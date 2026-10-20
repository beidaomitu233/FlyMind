import Database from 'better-sqlite3'
import {opendir,lstat,realpath} from 'node:fs/promises'
import type {Dir} from 'node:fs'
import {resolve,join} from 'node:path'
import {DiagramStore} from '../store'
import {workspaceDataRootId} from '../native-pilot'
import {NativeExportWorker} from '../exports/worker'
import type {NativeExportRenderer} from '../exports/types'
import type {CloudTeamWorkspace} from './team-workspaces'
import {CloudAccessError} from './identity'
import {CloudUpdatingError,drainBudget,type DrainOptions} from './maintenance'

import type {CloudReleaseManifest} from './mcp-compat'

type Workspace=Pick<CloudTeamWorkspace,'store'|'dataRootId'>
interface Entry {workspace:Workspace;worker:NativeExportWorker;reservations:number;nextAttemptAt?:number}
export interface CloudRecoveryOptions {root:string;intervalMs?:number;batchSize?:number;release?:Promise<CloudReleaseManifest>}
/** One renderer, serial execution and bounded, recoverable tenant queues. */
export class CloudExportPool {
 private readonly entries=new Map<string,Entry>()
 private active:Promise<void>|undefined
 private scanning:Promise<void>|undefined
 private directory:Dir|undefined
 private scanTimer:ReturnType<typeof setTimeout>|undefined
 private wakeTimer:ReturnType<typeof setTimeout>|undefined
 private stopping=false
 private quiescing=false
 private closing:Promise<void>|undefined
 private readonly recovery:CloudRecoveryOptions|undefined
 constructor(private readonly renderer:NativeExportRenderer,private readonly maxTeams=32,recovery?:CloudRecoveryOptions){
  if(!Number.isSafeInteger(maxTeams)||maxTeams<1||maxTeams>256)throw Error('Invalid cloud export queue capacity')
  if(recovery){const intervalMs=recovery.intervalMs??10000,batchSize=recovery.batchSize??16;if(!Number.isSafeInteger(intervalMs)||intervalMs<50||intervalMs>60000||!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>64)throw Error('Invalid cloud recovery budget');this.recovery={root:resolve(recovery.root),intervalMs,batchSize,release:recovery.release};this.scheduleScan(0)}
 }
 private add(workspace:Workspace){
  let entry=this.entries.get(workspace.dataRootId)
  if(!entry){
   if(this.entries.size>=this.maxTeams)throw new CloudAccessError(503,'EXPORT_CAPACITY','导出队列繁忙，请稍后重试')
   const borrowed:NativeExportRenderer={render:(...args)=>this.renderer.render(...args),close:async()=>{}}
   entry={workspace,worker:new NativeExportWorker(workspace.store,borrowed,{release:this.recovery?.release}),reservations:0};this.entries.set(workspace.dataRootId,entry)
  }
  return entry
 }
 reserve(workspace:Workspace){
  if(this.stopping)throw new CloudAccessError(503,'CLOUD_STOPPING','服务正在关闭')
  if(this.quiescing)throw new CloudUpdatingError()
  const entry=this.add(workspace);entry.reservations++;let released=false
  return ()=>{if(released)return;released=true;entry.reservations--;entry.nextAttemptAt=undefined;this.kick()}
 }
 private ready(){return [...this.entries.values()].some(entry=>!entry.reservations&&(entry.nextAttemptAt??0)<=Date.now())}
 private kick(){
  if(this.stopping||this.quiescing||this.active)return
  const work=this.drain().finally(()=>{if(this.active===work)this.active=undefined;this.scheduleWake();if(!this.stopping&&!this.quiescing&&this.ready())this.kick();if(!this.stopping&&!this.quiescing&&!this.scanning&&this.directory&&this.entries.size<this.maxTeams){clearTimeout(this.scanTimer);this.scheduleScan(0)}});this.active=work
 }
 private async drain(){
  while(!this.stopping&&!this.quiescing){let progressed=false
   for(const [key,entry] of this.entries){
    if(this.stopping||this.quiescing)return
    if(entry.reservations||(entry.nextAttemptAt??0)>Date.now())continue
    try{
     const state=await entry.workspace.store.nativeExportQueueState()
     if(this.stopping||this.quiescing)return
     if(!state.pending){if(!entry.reservations){this.entries.delete(key);await entry.worker.close()}continue}
     if(!state.ready){entry.nextAttemptAt=state.nextAttemptAt??Date.now()+1000;continue}
     entry.nextAttemptAt=undefined
     const job=await entry.worker.runOnce();if(job)progressed=true
     else{const after=await entry.workspace.store.nativeExportQueueState();entry.nextAttemptAt=after.nextAttemptAt??Date.now()+1000}
    }catch{entry.nextAttemptAt=Date.now()+1000} // Bounded retry, never a busy loop or private-path log.
   }
   if(!progressed)return
  }
 }
 private scheduleWake(){
  clearTimeout(this.wakeTimer);this.wakeTimer=undefined
  if(this.stopping||this.quiescing)return
  const times=[...this.entries.values()].filter(e=>!e.reservations&&e.nextAttemptAt!==undefined).map(e=>e.nextAttemptAt!)
  if(times.length){this.wakeTimer=setTimeout(()=>{this.wakeTimer=undefined;this.kick()},Math.max(1,Math.min(60000,Math.min(...times)-Date.now())));this.wakeTimer.unref()}
 }
 private scheduleScan(delay:number){
  if(this.stopping||this.quiescing||!this.recovery)return
  this.scanTimer=setTimeout(()=>{this.scanTimer=undefined;const scan=this.scanBatch().catch(()=>{}).finally(()=>{if(this.scanning===scan)this.scanning=undefined;this.scheduleScan(this.directory&&this.entries.size<this.maxTeams?25:this.recovery!.intervalMs!)});this.scanning=scan},delay);this.scanTimer.unref()
 }
 private async closeDirectory(){const directory=this.directory;this.directory=undefined;if(directory)await directory.close().catch(()=>{})}
 private async scanBatch(){
  if(this.stopping||this.quiescing||!this.recovery)return
  const root=this.recovery.root
  if(!this.directory){
   try{
    if(!(await lstat(root)).isDirectory()||(await lstat(root)).isSymbolicLink())return
    const canonical=await realpath(root),teams=join(canonical,'teams'),info=await lstat(teams)
    if(!info.isDirectory()||info.isSymbolicLink()||await realpath(teams)!==teams)return
    this.directory=await opendir(teams)
   }catch{return}
  }
  for(let checked=0;checked<this.recovery.batchSize!&&!this.stopping&&!this.quiescing;checked++){
   if(this.entries.size>=this.maxTeams)break
   const directory=this.directory!,entry=await directory.read();if(!entry){await this.closeDirectory();break}
   if(!/^[a-f0-9]{64}$/.test(entry.name)||!entry.isDirectory()||entry.isSymbolicLink())continue
   const path=join(directory.path,entry.name),file=join(path,'flymind.sqlite')
   try{
    const info=await lstat(path),dbInfo=await lstat(file)
    if(info.isSymbolicLink()||!info.isDirectory()||dbInfo.isSymbolicLink()||!dbInfo.isFile()||await realpath(path)!==path||await realpath(file)!==file)continue
    // Read-only identity gate before any DiagramStore schema-ensuring method.
    // Queue SQL remains exclusively in DiagramStore.nativeExportQueueState.
    const db=new Database(file,{readonly:true,fileMustExist:true,timeout:1000});let workspaceId:string|undefined
    try{if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_export_jobs'").get())continue;const value=db.prepare("SELECT value FROM metadata WHERE key='native_workspace_id'").get() as {value?:unknown}|undefined;if(typeof value?.value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value.value))workspaceId=value.value}finally{db.close()}
    if(!workspaceId)continue
    const workspace={store:new DiagramStore(path),dataRootId:workspaceDataRootId(workspaceId)},state=await workspace.store.nativeExportQueueState()
    if(!state.pending||this.stopping||this.quiescing)continue
    const known=this.entries.get(workspace.dataRootId);if(!known&&this.entries.size>=this.maxTeams)continue
    const scheduled=known??this.add(workspace);if(!scheduled.reservations)scheduled.nextAttemptAt=state.ready?undefined:state.nextAttemptAt??Date.now()+1000
   }catch{/* Invalid/non-FlyMind/racing files are skipped, not initialized. */}
  }
  this.scheduleWake();if(this.ready())this.kick()
 }
 async quiesce(options:DrainOptions={}){
  const timeoutMs=drainBudget(options);this.quiescing=true;clearTimeout(this.scanTimer);clearTimeout(this.wakeTimer)
  let timer:ReturnType<typeof setTimeout>|undefined
  try{await Promise.race([Promise.all([this.scanning,this.active]),new Promise<never>((_yes,no)=>{timer=setTimeout(()=>no(new CloudUpdatingError('CLOUD_EXPORT_DRAIN_TIMEOUT','后台导出尚未完成；保持维护状态与原写入者，不能并行启动替代实例')),timeoutMs)})]);await this.closeDirectory()}
  finally{clearTimeout(timer)}
 }
 close(){
  if(this.closing)return this.closing
  this.stopping=true;clearTimeout(this.scanTimer);clearTimeout(this.wakeTimer)
  this.closing=(async()=>{try{await this.scanning;await this.closeDirectory();await Promise.all([...this.entries.values()].map(entry=>entry.worker.close()));await this.active}finally{this.entries.clear();await this.renderer.close()}})();return this.closing
 }
}
