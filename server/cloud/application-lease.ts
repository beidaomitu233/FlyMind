import {mkdir,lstat,realpath} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {acquireRuntimeLease,readOwner,processAlive,type RuntimeLease} from '../runtime-instance/lock'
import type {RuntimeConfiguration} from '../runtime-instance/config'
import {assertIsolatedNativeRoot} from '../native-pilot'
import {PACKAGE_ROOT} from '../package-paths'
import {CloudAccessError} from './identity'

/** Application-wide ownership, independent of HTTP port. Reuses the audited
 * nonce/PID/recovery implementation, in a CLOUD-only private subdirectory. */
export async function acquireCloudApplicationLease(options:{cloudDataRoot:string;port:number;timeoutMs?:number}):Promise<RuntimeLease>{
 const requested=resolve(options.cloudDataRoot),timeoutMs=options.timeoutMs??3000
 assertIsolatedNativeRoot(requested,PACKAGE_ROOT)
 if(!Number.isSafeInteger(options.port)||options.port<0||options.port>65535||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('Invalid cloud lease configuration')
 await mkdir(requested,{recursive:true,mode:0o700})
 if((await lstat(requested)).isSymbolicLink())throw new CloudAccessError(503,'CLOUD_LEASE_PATH_INVALID','云端存储根不能为符号链接')
 const root=await realpath(requested),directory=join(root,'.flymind-cloud-owner')
 await mkdir(directory,{recursive:true,mode:0o700})
 if((await lstat(directory)).isSymbolicLink()||await realpath(directory)!==directory)throw new CloudAccessError(503,'CLOUD_LEASE_PATH_INVALID','云端所有权目录无效')
 const config:RuntimeConfiguration={dataRoot:directory,rootPathId:createHash('sha256').update(root).digest('hex'),privateRuntimeRoot:join(directory,'private'),projectRoot:PACKAGE_ROOT,env:{},port:options.port,timeoutMs}
 const deadline=Date.now()+timeoutMs
 for(;;){
  const lease=await acquireRuntimeLease(config);if(lease)return lease
  const owner=await readOwner(config)
  if(owner&&processAlive(owner.pid))throw new CloudAccessError(503,'CLOUD_WRITER_EXISTS','同一云端数据根已有活动应用；不能跨端口启动第二写入者')
  if(Date.now()>=deadline)throw new CloudAccessError(503,'CLOUD_LEASE_TIMEOUT','云端所有权尚未安全释放；未强抢未知或活动进程')
  await new Promise(r=>setTimeout(r,25))
 }
}
