import {randomUUID} from 'node:crypto'
import {DiagramStore,StoreError} from '../store'
import {validateNativeProject} from '../document-record'
import {isNativeCanvasProject,nativeCanvasRenderSignature} from '../../src/drawing/engine/native-canvas'
import {projectDrawio,drawioRenderSignature} from '../../src/drawing/engine/drawio'
import {prepareNativeArtifacts} from './artifacts'
import type {NativeExportRenderer,StoredNativeExport} from './types'

export interface NativeExportWorkerOptions {leaseMs?:number;timeoutMs?:number;pollMs?:number;maxAttempts?:number;heartbeat?:boolean;onError?:(error:unknown,jobId:string)=>void;prepareArtifacts?:typeof prepareNativeArtifacts}
export class NativeExportWorker {
  readonly owner=randomUUID()
  private active:Promise<StoredNativeExport|undefined>|undefined
  private polling:ReturnType<typeof setInterval>|undefined
  private controller:AbortController|undefined
  private stopped=false
  constructor(readonly store:DiagramStore,private readonly renderer:NativeExportRenderer,private readonly options:NativeExportWorkerOptions={}){}
  start(){if(this.polling||this.stopped)return;this.polling=setInterval(()=>void this.runOnce().catch(()=>{}),this.options.pollMs??250);this.polling.unref();void this.runOnce().catch(()=>{})}
  runOnce():Promise<StoredNativeExport|undefined>{
    if(this.active)return this.active
    if(this.stopped)return Promise.resolve(undefined)
    const work=this.run().finally(()=>{if(this.active===work)this.active=undefined});this.active=work;return work
  }
  private async run(){
    const leaseMs=this.options.leaseMs??15000,timeoutMs=this.options.timeoutMs??60000
    const job=await this.store.claimNativeExport(this.owner,leaseMs,Date.now(),this.options.maxAttempts??3)
    if(!job)return undefined
    const controller=new AbortController();this.controller=controller
    const deadline=Date.now()+timeoutMs
    const check=()=>{if(controller.signal.aborted)throw controller.signal.reason;if(Date.now()>=deadline)throw new StoreError('导出尝试已超过硬截止时间',504,undefined,'EXPORT_TIMEOUT')}
    let heartbeat:ReturnType<typeof setInterval>|undefined,timeout:ReturnType<typeof setTimeout>|undefined
    try{
      if(this.options.heartbeat!==false){heartbeat=setInterval(()=>{try{check();void this.store.renewNativeExport(job.id,this.owner,job.leaseToken!,leaseMs).catch(error=>controller.abort(error))}catch(error){controller.abort(error)}},Math.max(5,Math.floor(leaseMs/3)));heartbeat.unref()}
      const aborted=new Promise<never>((_resolve,reject)=>{controller.signal.addEventListener('abort',()=>reject(controller.signal.reason??new StoreError('导出已取消',503,undefined,'EXPORT_CANCELLED')),{once:true})})
      timeout=setTimeout(()=>controller.abort(new StoreError('后台渲染超时，请显式重试',504,undefined,'EXPORT_TIMEOUT')),timeoutMs)
      const pipeline=(async()=>{
        check();await validateNativeProject(job.snapshot);check()
        const rendered=await this.renderer.render(structuredClone(job.snapshot),{...job.options,timeoutMs,signal:controller.signal});check()
        const projected=isNativeCanvasProject(job.snapshot)?undefined:await projectDrawio(rendered.nativeXML,job.snapshot.content);check()
        if(!isNativeCanvasProject(job.snapshot)&&projected?.contentHash!==job.snapshot.rendering.engine.contentHash)throw new StoreError('渲染器返回了不同业务快照',500,undefined,'EXPORT_SNAPSHOT_INVALID')
        if((isNativeCanvasProject(job.snapshot)?nativeCanvasRenderSignature:drawioRenderSignature)(rendered.nativeXML)!==(isNativeCanvasProject(job.snapshot)?nativeCanvasRenderSignature:drawioRenderSignature)(job.snapshot.rendering.engine.xml))throw new StoreError('渲染器改变了快照的人工几何或样式',500,undefined,'EXPORT_SNAPSHOT_INVALID')
        check();const prepared=await (this.options.prepareArtifacts??prepareNativeArtifacts)(this.store.root,job,rendered,Date.now());check()
        await this.store.assertNativeExportLease(job.id,this.owner,job.leaseToken!);check()
        await prepared.publish();check()
        // SQLite completion is synchronous inside its promise; check absolute time
        // immediately before it, including when a blocked event loop delayed timers.
        return this.store.completeNativeExport(job.id,this.owner,job.leaseToken!,prepared.manifest,undefined,deadline)
      })()
      // Timeout covers validation, rendering, file preparation and publication. FS
      // work may resolve late, but its pipeline checks cannot register that output.
      return await Promise.race([pipeline,aborted])
    }catch(error){
      try{this.options.onError?.(error,job.id)}catch{/* Diagnostics cannot change lease fencing. */}
      const e=error as {code?:string;message?:string}
      // Native renderer/filesystem diagnostics may contain private installation paths.
      // Public errors expose the stable code, while never returning an older image.
      const code=e.code||'EXPORT_FAILED'
      try{return await this.store.failNativeExport(job.id,this.owner,job.leaseToken!,{code,message:code==='EXPORT_TIMEOUT'?'后台渲染超时，请显式重试':`后台导出失败（${code}），请检查运行环境后重试`})}catch{return undefined}
    }finally{clearInterval(heartbeat);clearTimeout(timeout);if(this.controller===controller)this.controller=undefined}
  }
  async close(){this.stopped=true;clearInterval(this.polling);this.polling=undefined;this.controller?.abort(new StoreError('导出进程已关闭',503,undefined,'EXPORT_WORKER_STOPPED'));await this.active;await this.renderer.close()}
}
