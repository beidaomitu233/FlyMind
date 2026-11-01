import {fork,type ChildProcess} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {availableHeavyMemory,childRSS} from './resources'
import {HeavyWorkError,type HeavyOperation,type HeavyReply} from './protocol'
export {HeavyWorkError} from './protocol'
const MiB=1024*1024
interface Request {operation:HeavyOperation;input:unknown;deadline:number;resolve:(value:any)=>void;reject:(error:Error)=>void;signal?:AbortSignal;cancel:()=>void;timer:ReturnType<typeof setTimeout>}
export interface HeavyWorkOptions {signal?:AbortSignal;timeoutMs?:number}
/** A process-local admission gate shared by engine and SVG work. DB remains in the parent. */
export class HeavyWorkRunner {
 private queue:Request[]=[]
 private active?:{request:Request;child?:ChildProcess;stop:(error:Error)=>void;finished:Promise<void>}
 private closed=false
 constructor(private readonly options:{childURL?:URL;availableMemory?:()=>Promise<number>;rss?:(pid:number)=>Promise<number|undefined>}={}){}
 run<T>(operation:HeavyOperation,input:unknown,options:HeavyWorkOptions={}):Promise<T>{
  if(this.closed)return Promise.reject(new HeavyWorkError('HEAVY_WORK_CLOSED','重活执行器已关闭'))
  if(!['compile','patch','configure','normalize','svg-fonts','svg-metadata'].includes(operation))return Promise.reject(new HeavyWorkError('HEAVY_WORK_INVALID','未知重活任务'))
  if(options.signal?.aborted)return Promise.reject(new HeavyWorkError('HEAVY_WORK_ABORTED','任务已取消，未提交新修订'))
  const timeout=options.timeoutMs??30000
  if(!Number.isInteger(timeout)||timeout<1||timeout>60000)return Promise.reject(new HeavyWorkError('HEAVY_WORK_INVALID','重活截止时间无效'))
  const limit=operation.startsWith('svg-')?96*MiB:8*MiB
  if(Buffer.byteLength(JSON.stringify(input))>limit)return Promise.reject(new HeavyWorkError('HEAVY_WORK_INPUT_LIMIT','重活输入超过预算'))
  if(this.queue.length>=4)return Promise.reject(new HeavyWorkError('HEAVY_WORK_BUSY','绘图工作繁忙，请稍后沿用原请求重试'))
  return new Promise<T>((resolve,reject)=>{
   const request={} as Request
   Object.assign(request,{operation,input,deadline:Date.now()+timeout,resolve,reject,signal:options.signal})
   request.cancel=()=>this.cancel(request,new HeavyWorkError('HEAVY_WORK_ABORTED','任务已取消，未提交新修订'))
   request.timer=setTimeout(()=>this.cancel(request,new HeavyWorkError('HEAVY_WORK_TIMEOUT','绘图计算超时，未提交新修订；请勿重建副本')),timeout)
   options.signal?.addEventListener('abort',request.cancel,{once:true});this.queue.push(request);void this.pump()
  })
 }
 private finish(request:Request,error?:Error,value?:unknown){clearTimeout(request.timer);request.signal?.removeEventListener('abort',request.cancel);if(error)request.reject(error);else request.resolve(value)}
 private cancel(request:Request,error:Error){
  if(this.active?.request===request){this.active.stop(error);return}
  const index=this.queue.indexOf(request);if(index>=0){this.queue.splice(index,1);this.finish(request,error)}
 }
 private async pump(){
  if(this.active||this.closed)return
  const request=this.queue.shift();if(!request)return
  let failure:Error|undefined,reply:HeavyReply|undefined,exited=false,monitor:ReturnType<typeof setInterval>|undefined,monitoring=false,settled=false
  let finishActive!:()=>void
  const active={request,child:undefined as ChildProcess|undefined,finished:new Promise<void>(r=>{finishActive=r}),stop:(error:Error)=>{failure??=error;if(active.child&&!exited)active.child.kill('SIGKILL');else if(!active.child)done()}}
  this.active=active
  const done=()=>{if(settled)return;settled=true;clearInterval(monitor);if(this.active===active)this.active=undefined
   if(failure)this.finish(request,failure)
   else if(reply?.ok)this.finish(request,undefined,reply.value)
   else if(reply&&!reply.ok){const e=Object.assign(new Error(reply.error.message),{code:reply.error.code,...(reply.error.status?{status:reply.error.status}:{})});this.finish(request,e)}
   else this.finish(request,new HeavyWorkError('HEAVY_WORKER_EXIT','绘图子进程异常退出，未提交新修订'))
   finishActive();void this.pump()
  }
  try{
   const rssBudget=(request.operation.startsWith('svg-')?384:256)*MiB
   if(await(this.options.availableMemory??availableHeavyMemory)()<rssBudget+128*MiB)throw new HeavyWorkError('HEAVY_WORK_MEMORY_LOW','可用内存不足，未启动绘图计算；请稍后沿用原请求重试')
   if(failure)throw failure
   if(this.closed||request.signal?.aborted||Date.now()>=request.deadline)throw new HeavyWorkError('HEAVY_WORK_ABORTED','重活请求已失效，未提交新修订')
   const url=this.options.childURL??new URL('./child'+(import.meta.url.endsWith('.ts')?'.ts':'.js'),import.meta.url)
   const spawnOptions={execArgv:['--max-old-space-size=256',...(url.pathname.endsWith('.ts')?['--import','tsx']:[])],windowsHide:true,silent:true,serialization:'advanced' as const}
   const child=fork(fileURLToPath(url),[],spawnOptions)
   active.child=child
   // Never relay child stderr/stdout (it may contain paths or input diagnostics).
   child.stdout?.resume();child.stderr?.resume()
   child.on('message',(message:HeavyReply)=>{if(reply||failure)return;if(!message||typeof message.ok!=='boolean'){active.stop(new HeavyWorkError('HEAVY_WORK_PROTOCOL','绘图子进程响应无效'));return}reply=message})
   child.once('error',()=>{active.stop(new HeavyWorkError('HEAVY_WORKER_EXIT','无法运行绘图子进程'));if(!child.pid)done()})
   child.once('exit',()=>{exited=true})
   // close follows IPC draining; a valid reply cannot lose a race to exit.
   child.once('close',done)
   child.send({operation:request.operation,input:request.input},error=>{if(error)active.stop(new HeavyWorkError('HEAVY_WORK_PROTOCOL','绘图任务未能交付子进程'))})
   monitor=setInterval(()=>{
    if(monitoring||exited)return;monitoring=true
    void Promise.all([(this.options.rss??childRSS)(child.pid!),(this.options.availableMemory??availableHeavyMemory)()]).then(([rss,available])=>{
     if(exited||this.active!==active)return
     if(available<128*MiB)active.stop(new HeavyWorkError('HEAVY_WORK_MEMORY_PRESSURE','运行期间可用内存不足，已终止绘图计算，未提交新修订'))
     else if(rss!==undefined&&rss>rssBudget)active.stop(new HeavyWorkError('HEAVY_WORK_MEMORY_LIMIT','绘图计算超过内存预算，未提交新修订'))
    }).catch(()=>{}).finally(()=>{monitoring=false})
   },100)
  }catch(error){failure??=error as Error;done()}
 }
 async close(){this.closed=true;for(const request of [...this.queue])this.cancel(request,new HeavyWorkError('HEAVY_WORK_CLOSED','重活执行器已关闭'));const active=this.active;if(active){active.stop(new HeavyWorkError('HEAVY_WORK_CLOSED','重活执行器已关闭'));await active.finished}}
}
const shared=new HeavyWorkRunner()
export const runHeavyWork=<T>(operation:HeavyOperation,input:unknown,options?:HeavyWorkOptions)=>shared.run<T>(operation,input,options)
