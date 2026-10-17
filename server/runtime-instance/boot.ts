import {createServer,type Server,type RequestListener} from 'node:http'
import {randomBytes} from 'node:crypto'
import {lstat} from 'node:fs/promises'
import {join} from 'node:path'
import {RESTORE_MARKER} from '../backups/marker'
import {runtimeConfiguration,runtimeCapabilities,VERSION} from './config'
import {acquireRuntimeLease,adoptRuntimeLease,writeCredentials,type RuntimeLease} from './lock'
import {RuntimeInstanceError,type NativeRuntimeHealth,type EnsureNativeRuntimeOptions} from './types'
export interface RuntimeBootContext {
 server:Server;port:number;sessionToken:string;lease:RuntimeLease
 health(dataRootId:string):NativeRuntimeHealth
 ready(dataRootId:string):Promise<void>
 attachRequestHandler(handler:RequestListener):void
 close():Promise<void>
}
let active:RuntimeBootContext|undefined
export async function cleanupRuntimeBoot(){await active?.close()}
/** Called before any native store initialization. Binding failure cannot create SQLite. */
export async function prepareNativeRuntime(options:EnsureNativeRuntimeOptions={},hooks:{afterBind?:(server:Server)=>Promise<void>}={}):Promise<RuntimeBootContext>{
 const config=runtimeConfiguration(options),lease=config.env.FLYMIND_RUNTIME_CLAIM?await adoptRuntimeLease(config,config.env.FLYMIND_RUNTIME_CLAIM):await acquireRuntimeLease(config)
 if(!lease)throw new RuntimeInstanceError('RUNTIME_ALREADY_RUNNING','相同数据根已有Runtime或正在启动')
 try{await lstat(join(config.dataRoot,RESTORE_MARKER));await lease.release();throw new RuntimeInstanceError('RESTORE_RECOVERY_REQUIRED','工作区有未完成恢复，必须先通过离线维护工具显式回退')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'){await lease.release();throw error}}
 const starting:RequestListener=(_req,res)=>{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({code:'RUNTIME_STARTING',error:'Runtime正在启动'}))}
 const server=createServer(starting),sessionToken=randomBytes(32).toString('base64url')
 try{await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(config.port,'127.0.0.1',yes)})}catch(e){const failure=new RuntimeInstanceError((e as NodeJS.ErrnoException).code==='EADDRINUSE'?'PORT_OCCUPIED':'BIND_FAILED','Runtime本机端口被占用或无法监听');try{await lease.release()}catch(cleanup){const cleanupCode=(cleanup as NodeJS.ErrnoException).code??'LEASE_RELEASE_FAILED';Object.defineProperty(failure,'cleanupCode',{value:cleanupCode,enumerable:false});failure.message+=`; owned lease cleanup failed (${cleanupCode})`}throw failure}
 try{
 const address=server.address();if(!address||typeof address==='string')throw new RuntimeInstanceError('BIND_FAILED','无法获取监听地址')
 await hooks.afterBind?.(server)
 const port=address.port;await lease.update({port})
 const health=(dataRootId:string):NativeRuntimeHealth=>({name:'flymind',version:VERSION,storage:'sqlite',dataRootId,runtime:{application:'flymind',appVersion:VERSION,apiVersion:1,instanceId:lease.owner.instanceId,rootPathId:config.rootPathId,pid:process.pid},capabilities:runtimeCapabilities()})
 active={server,port,sessionToken,lease,health,attachRequestHandler(handler){server.removeListener('request',starting);server.on('request',handler)},async ready(dataRootId){await writeCredentials(config,{schema:1,instanceId:lease.owner.instanceId,rootPathId:config.rootPathId,sessionToken,pid:process.pid,port,dataRootId});await lease.update({state:'ready'});process.send?.({type:'flymind-runtime-ready',health:health(dataRootId)})},async close(){server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));await lease.release()}}
 return active
 }catch(error){server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));await lease.release();throw error}
}
