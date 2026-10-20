import type {Server} from 'node:http'
import {CloudAccessError} from './identity'

export class CloudUpdatingError extends CloudAccessError {
 readonly retryAfter=2
 constructor(code='CLOUD_UPDATING',message='绘图服务正在更新，请保留未确认编辑并稍后重试'){super(503,code,message)}
}
export interface DrainOptions {timeoutMs?:number}
export function drainBudget(options:DrainOptions={}){const value=options.timeoutMs??60000;if(!Number.isSafeInteger(value)||value<1||value>120000)throw Error('Drain timeout must be 1–120000ms');return value}
/** Admission counts server work, not sockets. The route owner MUST release only
 * after its actual handler settles; transport close is not evidence of no write. */
export class CloudMaintenanceGate {
 private state:'starting'|'ready'|'updating'='ready'
 private writes=0
 private readonly waiters=new Set<()=>void>()
 constructor(options:{ready?:boolean}={}){if(options.ready===false)this.state='starting'}
 snapshot(){return {state:this.state,ready:this.state==='ready',pendingWrites:this.writes}}
 markReady(){if(this.state==='updating')throw new CloudUpdatingError();this.state='ready'}
 enter(method:string,_path?:string):()=>void{
  if(['GET','HEAD','OPTIONS'].includes(method.toUpperCase()))return ()=>{}
  if(this.state!=='ready')throw new CloudUpdatingError()
  this.writes++;let released=false
  return ()=>{if(released)return;released=true;this.writes--;if(!this.writes)for(const wake of this.waiters)wake()}
 }
 stopAccepting(){this.state='updating'}
 async drain(options:DrainOptions={}){
  const timeoutMs=drainBudget(options);this.stopAccepting();if(!this.writes)return
  let wake!:()=>void,timer:ReturnType<typeof setTimeout>|undefined
  try{await new Promise<void>((yes,no)=>{wake=yes;this.waiters.add(wake);timer=setTimeout(()=>no(new CloudUpdatingError('CLOUD_DRAIN_TIMEOUT','已接收的写入尚未结算；维持维护状态，不得启动另一写入者')),timeoutMs);if(!this.writes)yes()})}
  finally{clearTimeout(timer);this.waiters.delete(wake)}
 }
}
/** Never use closeAllConnections before ACKs finish. A timeout is a failed drain,
 * not permission to start another writer or to discard unconfirmed requests. */
export async function closeHTTPGracefully(server:Server,options:DrainOptions={}){
 const timeoutMs=drainBudget(options);let timer:ReturnType<typeof setTimeout>|undefined
 try{await new Promise<void>((yes,no)=>{timer=setTimeout(()=>no(new CloudUpdatingError('CLOUD_HTTP_DRAIN_TIMEOUT','HTTP确认尚未完成；未强制断开连接')),timeoutMs);server.close(error=>error&&(error as NodeJS.ErrnoException).code!=='ERR_SERVER_NOT_RUNNING'?no(error):yes())})}
 finally{clearTimeout(timer)}
}
