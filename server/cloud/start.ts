// Source-only application entry. No local Runtime/CLI or implicit data migration.
import {createServer,type Server} from 'node:http'
import {createCloudHTTP} from './http'
import {CloudMaintenanceGate,closeHTTPGracefully,drainBudget} from './maintenance'
import {acquireCloudApplicationLease} from './application-lease'
import {preparedCloudRelease} from './prepared-release'
import {NativeDrawioRenderer} from '../rendering/renderer'
import {checkRuntimeAssets} from '../rendering/assets'
import type {RuntimeLease} from '../runtime-instance/lock'

const required=(name:string)=>{const value=process.env[name];if(!value)throw Error(name+' is required');return value}
const port=Number(process.env.FLYMIND_CLOUD_PORT??5192),timeoutMs=drainBudget({timeoutMs:Number(process.env.FLYMIND_CLOUD_DRAIN_MS??60000)})
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid FLYMIND_CLOUD_PORT')
const dataRoot=required('FLYMIND_CLOUD_DATA_DIR'),publicOrigin=required('FLYMIND_CLOUD_PUBLIC_ORIGIN'),controlPlaneURL=required('FLYMIND_CLOUD_CONTROL_PLANE_URL'),gatewayKey=required('FLYMIND_GATEWAY_KEY')
const gate=new CloudMaintenanceGate({ready:false})
let cloud:ReturnType<typeof createCloudHTTP>|undefined,renderer:NativeDrawioRenderer|undefined,server:Server|undefined,lease:RuntimeLease|undefined,stopping:Promise<void>|undefined,stopRequested=false
const code=(error:unknown)=>(error as {code?:string})?.code??'CLOUD_START_FAILED'
async function start(){
 try{
  // Fail closed before listening. Ownership is independent of the selected port.
  await checkRuntimeAssets();const release=await preparedCloudRelease()
  lease=await acquireCloudApplicationLease({cloudDataRoot:dataRoot,port})
  renderer=new NativeDrawioRenderer();await renderer.ready()
  if(stopRequested)throw Object.assign(Error(),{code:'CLOUD_START_CANCELLED'})
  // Claim HTTP port before recovery workers can touch an existing queue.
  const placeholder=(_req:unknown,res:import('node:http').ServerResponse)=>{res.writeHead(503,{'Retry-After':'2','Content-Type':'application/json'});res.end(JSON.stringify({code:'CLOUD_STARTING',error:'服务正在准备'}))}
  server=createServer(placeholder)
  await new Promise<void>((yes,no)=>{server!.once('error',no);server!.listen(port,process.env.FLYMIND_CLOUD_BIND??'127.0.0.1',()=>{server!.off('error',no);yes()})})
  cloud=createCloudHTTP({controlPlaneURL,cloudDataRoot:dataRoot,publicOrigin,gatewayKey,release,renderer,maintenance:gate,allowInsecureLoopback:process.env.FLYMIND_CLOUD_DEV_LOOPBACK==='1'})
  server.removeListener('request',placeholder);server.on('request',cloud.app)
  await lease.update({state:'ready',port});if(stopRequested)throw Object.assign(Error(),{code:'CLOUD_START_CANCELLED'})
  gate.markReady();process.send?.({type:'flymind-cloud-ready',pid:process.pid,port});console.error('FlyMind cloud application ready on port '+port)
 }catch(error){
  // No writes have been admitted while starting. Always clean only owned assets.
  if(server)await closeHTTPGracefully(server,{timeoutMs:5000}).catch(()=>{})
  try{if(cloud)await cloud.close();else await renderer?.close()}finally{await lease?.release();cloud=undefined;renderer=undefined;lease=undefined}
  throw error
 }
}
const startup=start().catch(error=>{if(process.send&&process.connected)process.send({type:'flymind-cloud-error',code:code(error)},()=>{if(process.connected)process.disconnect?.()});console.error('FlyMind cloud start refused: '+code(error));process.exitCode=1})
async function close(){
 if(stopping)return stopping
 stopRequested=true;gate.stopAccepting()
 stopping=(async()=>{await startup;if(!cloud)return;await cloud.quiesce({timeoutMs});if(server)await closeHTTPGracefully(server,{timeoutMs});await cloud.close();await lease?.release();cloud=undefined;lease=undefined;process.send?.({type:'flymind-cloud-stopped'})})()
 return stopping
}
const stop=()=>void close().then(()=>process.exit(0),error=>{stopping=undefined;process.exitCode=1;console.error('FlyMind cloud drain refused: '+code(error)+'; existing writer retained')})
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,stop)
// Private parent/child IPC only; no unauthenticated HTTP shutdown endpoint.
if(process.send)process.on('message',message=>{if((message as {type?:unknown})?.type==='flymind-cloud-shutdown')stop()})
