import {runtimeOrigin} from './origin'
import {readFile,open,mkdir} from 'node:fs/promises'
import {spawn,type ChildProcess} from 'node:child_process'
import {join} from 'node:path'
import {randomBytes} from 'node:crypto'
import {runtimeConfiguration} from './config'
import {readOwner,credentialPath,acquireRuntimeLease,wait,processAlive,type RuntimeLease} from './lock'
import {validateRuntimeHealth,assertRuntimeCapabilities} from './protocol'
import {RuntimeInstanceError,type EnsureNativeRuntimeOptions,type NativeRuntimeConnection} from './types'
export * from './types'
async function healthJSON(response:Response){const reader=response.body?.getReader();if(!reader)throw new RuntimeInstanceError('FOREIGN_SERVICE','Runtime健康数据为空');const chunks:Uint8Array[]=[];let length=0;try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>65536){await reader.cancel();throw new RuntimeInstanceError('FOREIGN_SERVICE','Runtime健康数据超出字节预算')}chunks.push(part.value)}return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch(error){if(error instanceof RuntimeInstanceError)throw error;throw new RuntimeInstanceError('FOREIGN_SERVICE','端口返回无效健康数据')}finally{reader.releaseLock()}}
/** Explicit administrative stop, never called by connection.close or MCP exit. */
export async function requestNativeRuntimeShutdown(connection:NativeRuntimeConnection):Promise<void>{
 const response=await connection.authenticatedFetch('/studio-api/runtime/shutdown',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instanceId:connection.instanceId,dataRootId:connection.dataRootId})})
 if(response.status!==202)throw new RuntimeInstanceError('SHUTDOWN_REJECTED','Runtime拒绝显式停止；未重试或杀进程')
}

export async function ensureNativeRuntime(options:EnsureNativeRuntimeOptions={}):Promise<NativeRuntimeConnection>{
 const config=runtimeConfiguration(options),deadline=Date.now()+config.timeoutMs;let bootFailure:Error|undefined,spawnedLease:RuntimeLease|undefined,spawnedPid:number|undefined,spawnedChild:ChildProcess|undefined,spawnedTerminated:Promise<void>|undefined
 async function failStartup(error:unknown):Promise<never>{
  // An IPC error precedes stderr flush/process exit. Only wait for our own child;
  // never release its live lease or terminate an existing shared Runtime.
  if(spawnedTerminated){
   spawnedChild?.ref()
   let timer:ReturnType<typeof setTimeout>|undefined
   const closed=await Promise.race([spawnedTerminated.then(()=>true),new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),5000)})])
   if(timer)clearTimeout(timer);spawnedChild?.unref()
   if(!closed)throw new RuntimeInstanceError('STARTUP_SHUTDOWN_TIMEOUT','启动失败子进程未在5秒内关闭；保留其租约，未杀进程')
  }
  if(!processAlive(spawnedPid))try{await spawnedLease?.release()}catch(cleanup){if(error instanceof Error){const cleanupCode=(cleanup as NodeJS.ErrnoException).code??'LEASE_RELEASE_FAILED';Object.defineProperty(error,'cleanupCode',{value:cleanupCode,enumerable:false,configurable:true});error.message+=`; owned lease cleanup failed (${cleanupCode})`}}
  if(error instanceof Error&&spawnedPid)Object.defineProperty(error,'failedChildPid',{value:spawnedPid,enumerable:false})
  throw error
 }
 while(Date.now()<deadline){
  if(bootFailure)return failStartup(bootFailure)
  const owner=await readOwner(config)
  if(owner&&processAlive(owner.pid)){
   if(owner.application!=='flymind'||owner.schema!==1||owner.rootPathId!==config.rootPathId)throw new RuntimeInstanceError('FOREIGN_LOCK_OWNER','数据根被活的未知实例占用，拒绝恢复')
   if(owner.requestedPort!==config.port)throw new RuntimeInstanceError('PORT_MISMATCH','同一数据根的Runtime端口与配置不一致')
   if(owner.state==='ready'&&owner.port){
    let credential:any;try{credential=JSON.parse(await readFile(credentialPath(config,owner.instanceId),'utf8'))}catch{await wait(50);continue}
    if(credential.instanceId!==owner.instanceId||credential.pid!==owner.pid||credential.rootPathId!==config.rootPathId||typeof credential.sessionToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(credential.sessionToken))throw new RuntimeInstanceError('INVALID_RUNTIME_CREDENTIAL','私有凭据记录与活实例不匹配')
    const baseURL=runtimeOrigin(owner.port),challenge=randomBytes(32).toString('hex');let response:Response
    try{response=await fetch(baseURL+'/studio-api/health',{headers:{'X-FlyMind-Challenge':challenge},redirect:'error',signal:AbortSignal.timeout(Math.min(1500,Math.max(1,deadline-Date.now())))})}catch{await wait(50);continue}
    if(!response.ok)throw new RuntimeInstanceError('RUNTIME_NOT_READY','Runtime健康检查失败')
    const value:unknown=await healthJSON(response)
    const health=validateRuntimeHealth(value,{rootPathId:config.rootPathId,instanceId:owner.instanceId,pid:owner.pid,token:credential.sessionToken,challenge})
    let closed=false
    const headers=()=>{if(closed)throw new RuntimeInstanceError('CLIENT_DETACHED','客户端已断开');return {Authorization:'Bearer '+credential.sessionToken,'X-FlyMind-DataRoot-Id':health.dataRootId}}
    const connection:NativeRuntimeConnection={baseURL,dataRootId:health.dataRootId,instanceId:owner.instanceId,sessionToken:credential.sessionToken,capabilities:health.capabilities,headers,async authenticatedFetch(path,init={}){
     if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||path.includes('\\')||/^[a-z][a-z0-9+.-]*:/i.test(path))throw new RuntimeInstanceError('UNSAFE_REQUEST_URL','仅接受当前连接下相对API路径')
     const url=new URL(path,baseURL);if(url.origin!==baseURL||!url.pathname.startsWith('/studio-api/'))throw new RuntimeInstanceError('UNSAFE_REQUEST_URL','拒绝连接外的API路径')
     const requestHeaders=new Headers(init.headers);for(const [key,value] of Object.entries(headers()))requestHeaders.set(key,value)
     return fetch(url,{...init,headers:requestHeaders,redirect:'error'})
    },async close(){closed=true}}
    Object.defineProperty(connection,'sessionToken',{value:credential.sessionToken,enumerable:false,writable:false});return connection
   }
   await wait(50);continue
  }
  if(config.port>0){
   let response:Response|undefined;try{response=await fetch(`http://127.0.0.1:${config.port}/studio-api/health`,{redirect:'error',signal:AbortSignal.timeout(300)})}catch{}
   if(response){const publicHealth:unknown=await healthJSON(response);assertRuntimeCapabilities(publicHealth);if(publicHealth.runtime.rootPathId!==config.rootPathId)throw new RuntimeInstanceError('DATA_ROOT_MISMATCH','端口已由另一数据根使用');throw new RuntimeInstanceError('INSTANCE_DISCOVERY_MISMATCH','发现无对应可信锁的服务，拒绝发送凭据或初始化数据')}
  }
  const lease=await acquireRuntimeLease(config);if(!lease){await wait(50);continue}
  try{
   await mkdir(config.privateRuntimeRoot,{recursive:true,mode:0o700});const log=await open(join(config.privateRuntimeRoot,lease.owner.instanceId+'.log'),'a',0o600)
   const child=spawn(process.execPath,[join(config.projectRoot,'server/start.mjs'),'--runtime'],{cwd:config.projectRoot,env:{...config.env,FLYMIND_NATIVE_PILOT:'1',FLYMIND_DATA_DIR:config.dataRoot,FLYMIND_PORT:String(config.port),FLYMIND_PRIVATE_RUNTIME_DIR:config.privateRuntimeRoot,FLYMIND_RUNTIME_CLAIM:lease.owner.nonce},stdio:['ignore','ignore',log.fd,'ipc'],detached:true,windowsHide:true})
   let ready=false;spawnedLease=lease;spawnedPid=child.pid;spawnedChild=child
   spawnedTerminated=new Promise<void>(resolve=>{child.once('close',()=>resolve());child.once('exit',()=>resolve())})
   child.on('error',()=>{bootFailure=new RuntimeInstanceError('SPAWN_FAILED','无法启动隐藏Runtime')})
   child.on('message',(message:any)=>{if(message?.type==='flymind-runtime-error')bootFailure=new RuntimeInstanceError(typeof message.code==='string'?message.code:'STARTUP_FAILED','Runtime启动失败（详情仅在私有诊断）');if(message?.type==='flymind-runtime-ready')ready=true;if(message?.type==='flymind-runtime-ready'||message?.type==='flymind-runtime-error'){if(child.connected)child.disconnect();child.unref()}})
   child.on('exit',()=>{if(!ready&&!bootFailure)bootFailure=new RuntimeInstanceError('STARTUP_FAILED','Runtime未就绪即退出')});child.unref();child.channel?.unref();await log.close()
   if(!child.pid)throw new RuntimeInstanceError('SPAWN_FAILED','无法启动隐藏Runtime')
   await lease.update({pid:child.pid})
  }catch(e){if(spawnedChild)return failStartup(e);await lease.release();throw e}
  await wait(50)
 }
 if(bootFailure)return failStartup(bootFailure)
 throw new RuntimeInstanceError('RUNTIME_STARTUP_TIMEOUT','等待Runtime就绪超时；未杀死已有进程')
}
