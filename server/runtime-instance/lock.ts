import {mkdir,readFile,writeFile,rename,rm,stat,chmod} from 'node:fs/promises'
import {join,resolve,sep} from 'node:path'
import {randomUUID} from 'node:crypto'
import {RuntimeInstanceError} from './types'
import type {RuntimeConfiguration} from './config'
export interface RuntimeOwner {application:'flymind';schema:1;pid:number;instanceId:string;nonce:string;rootPathId:string;requestedPort:number;port?:number;state:'starting'|'ready';createdAt:number}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms))
export function processAlive(pid:unknown){if(!Number.isSafeInteger(pid)||Number(pid)<=0)return false;try{process.kill(Number(pid),0);return true}catch(e){return (e as NodeJS.ErrnoException).code!=='ESRCH'}}
export const lockDirectory=(config:RuntimeConfiguration)=>join(config.dataRoot,'.flymind-runtime.lock')
export function credentialPath(config:RuntimeConfiguration,instanceId:string){if(!/^[a-f0-9-]{36}$/i.test(instanceId))throw new RuntimeInstanceError('INVALID_INSTANCE_ID','实例标识无效');return join(config.privateRuntimeRoot,config.rootPathId+'.'+instanceId+'.json')}
export async function readOwner(config:RuntimeConfiguration):Promise<RuntimeOwner|undefined>{try{return JSON.parse(await readFile(join(lockDirectory(config),'owner.json'),'utf8'))}catch{return undefined}}
async function atomicJSON(path:string,value:unknown){const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,path)}
function same(a:RuntimeOwner|undefined,b:RuntimeOwner|undefined){return !!a&&!!b&&a.instanceId===b.instanceId&&a.nonce===b.nonce&&a.pid===b.pid}
async function safeRemove(path:string,parent:string){if(!resolve(path).startsWith(resolve(parent)+sep))throw new RuntimeInstanceError('UNSAFE_LOCK_PATH','拒绝不在预期目录中的锁清理');await rm(path,{recursive:true,force:true})}
async function recoverOrphanGuard(guard:string,directory:string){
 const raw=await readFile(join(guard,'owner.json'),'utf8').catch(()=>''),before=await stat(guard),age=Date.now()-(before.birthtimeMs||before.mtimeMs)
 let value:any;try{value=JSON.parse(raw)}catch{}
 if(value&&(!Number.isSafeInteger(value.pid)||value.pid<=0))throw new RuntimeInstanceError('INVALID_LOCK_OWNER','损坏恢复锁含不可信PID，保守拒绝恢复')
 if(!value&&/"pid"/.test(raw)&&!/"pid"\s*:\s*\d+/.test(raw))throw new RuntimeInstanceError('INVALID_LOCK_OWNER','损坏恢复锁的PID不可验证')
 const possible=value?.pid??Number(/"pid"\s*:\s*(\d+)/.exec(raw)?.[1]);if(processAlive(possible)||age<5000)return
 await wait(30);const after=await stat(guard);if(before.ino!==after.ino||before.mtimeMs!==after.mtimeMs||await readFile(join(guard,'owner.json'),'utf8').catch(()=>'')!==raw||processAlive(possible))return
 const moved=join(directory,'orphan-recovery-'+randomUUID());await rename(guard,moved)
 const movedRaw=await readFile(join(moved,'owner.json'),'utf8').catch(()=>'');if(movedRaw!==raw){await rename(moved,guard).catch(()=>{});throw new RuntimeInstanceError('LOCK_OWNERSHIP_CHANGED','恢复锁在清理时改变，未删除新owner')}
 await safeRemove(moved,directory)
}
/** Recovery mutex lives inside the candidate lock, so it cannot lock a replacement owner. */
async function recover(config:RuntimeConfiguration){
 const directory=lockDirectory(config),guard=join(directory,'recovery'),nonce=randomUUID();let held=false
 try{
  try{await mkdir(guard);held=true;await writeFile(join(guard,'owner.json'),JSON.stringify({pid:process.pid,nonce}),{mode:0o600})}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')await recoverOrphanGuard(guard,directory);return}
  let raw='';try{raw=await readFile(join(directory,'owner.json'),'utf8')}catch{}
  const owner=await readOwner(config);if(owner&&(!Number.isSafeInteger(owner.pid)||owner.pid<=0))throw new RuntimeInstanceError('INVALID_LOCK_OWNER','损坏锁含不可信PID，保守拒绝恢复')
  if(owner&&(owner.application!=='flymind'||owner.schema!==1||owner.rootPathId!==config.rootPathId||!/^[a-f0-9-]{36}$/i.test(owner.instanceId)||!/^[a-f0-9-]{36}$/i.test(owner.nonce)))throw new RuntimeInstanceError('FOREIGN_LOCK_OWNER','不能恢复未知应用/身份的锁')
  if(!owner&&/"pid"/.test(raw)&&!/"pid"\s*:\s*\d+/.test(raw))throw new RuntimeInstanceError('INVALID_LOCK_OWNER','损坏锁的PID不可验证')
  const pid=owner?.pid??Number(/"pid"\s*:\s*(\d+)/.exec(raw)?.[1]),s=await stat(directory),age=Date.now()-(s.birthtimeMs||s.mtimeMs)
  if(processAlive(pid)||(!owner&&age<5000))return
  // Compare the same owner after holding this exact directory's recovery guard.
  if(await readFile(join(directory,'owner.json'),'utf8').catch(()=>'')!==raw)return
  const stale=directory+'.stale-'+nonce;await rename(directory,stale);held=false;await safeRemove(stale,config.dataRoot)
  if(owner?.application==='flymind')await rm(credentialPath(config,owner.instanceId),{force:true}).catch(()=>{})
 }catch(e){if(!['ENOENT','EEXIST','ENOTEMPTY'].includes((e as NodeJS.ErrnoException).code??''))throw e}
 finally{if(held){try{const own=JSON.parse(await readFile(join(guard,'owner.json'),'utf8'));if(own.pid===process.pid&&own.nonce===nonce)await safeRemove(guard,directory)}catch{}}}
}
export class RuntimeLease {
 constructor(readonly config:RuntimeConfiguration,public owner:RuntimeOwner){}
 async update(changes:Partial<RuntimeOwner>){const current=await readOwner(this.config);if(!same(current,this.owner))throw new RuntimeInstanceError('LOCK_OWNERSHIP_CHANGED','Runtime锁已改变');const next={...this.owner,...changes};await atomicJSON(join(lockDirectory(this.config),'owner.json'),next);this.owner=next}
 async release(){
  const directory=lockDirectory(this.config),moved=directory+'.release-'+this.owner.nonce,deadline=Date.now()+750
  // Windows denies directory rename while an owner file has a short-lived
  // read handle without FILE_SHARE_DELETE. Re-read identity before each attempt;
  // this is a bounded owned-resource release, never a retry of Runtime startup.
  for(;;){
   try{let current:RuntimeOwner;try{current=JSON.parse(await readFile(join(directory,'owner.json'),'utf8'))}catch(error){if(error instanceof SyntaxError)return;throw error}if(!same(current,this.owner))return;await rename(directory,moved);break}
   catch(error){const code=(error as NodeJS.ErrnoException).code;if(code==='ENOENT')return;if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(code??'')||Date.now()>=deadline)throw error;await wait(25)}
  }
  try{const found=JSON.parse(await readFile(join(moved,'owner.json'),'utf8'));if(same(found,this.owner))await safeRemove(moved,this.config.dataRoot)}catch{}
  try{const path=credentialPath(this.config,this.owner.instanceId),value=JSON.parse(await readFile(path,'utf8'));if(value.instanceId===this.owner.instanceId)await rm(path,{force:true})}catch{}
 }
}
export async function acquireRuntimeLease(config:RuntimeConfiguration):Promise<RuntimeLease|undefined>{
 await mkdir(config.dataRoot,{recursive:true});const directory=lockDirectory(config)
 try{await mkdir(directory,{mode:0o700});const owner:RuntimeOwner={application:'flymind',schema:1,pid:process.pid,instanceId:randomUUID(),nonce:randomUUID(),rootPathId:config.rootPathId,requestedPort:config.port,state:'starting',createdAt:Date.now()};await atomicJSON(join(directory,'owner.json'),owner);return new RuntimeLease(config,owner)}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e}
 await recover(config);return undefined
}
export async function adoptRuntimeLease(config:RuntimeConfiguration,nonce:string){
 const deadline=Date.now()+3000;while(Date.now()<deadline){const owner=await readOwner(config);if(owner?.nonce!==nonce||owner.rootPathId!==config.rootPathId)throw new RuntimeInstanceError('LOCK_OWNERSHIP_CHANGED','启动声明与数据根锁不符');if(owner.pid===process.pid)return new RuntimeLease(config,owner);await wait(20)}throw new RuntimeInstanceError('LOCK_TRANSFER_TIMEOUT','Runtime锁转移未完成')
}
export async function writeCredentials(config:RuntimeConfiguration,value:{instanceId:string;[key:string]:unknown}){await mkdir(config.privateRuntimeRoot,{recursive:true,mode:0o700});if(process.platform!=='win32')await chmod(config.privateRuntimeRoot,0o700);await atomicJSON(credentialPath(config,value.instanceId),value)}
export {wait}
