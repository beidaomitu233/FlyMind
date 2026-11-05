import {createServer,type Server} from 'node:http'
import {randomUUID} from 'node:crypto'
import {resolve} from 'node:path'
import express from 'express'
import {chromium,type Browser,type BrowserContext} from 'playwright-core'
import {launchHiddenBrowser,type HiddenBrowser} from './hidden-browser'
import {resolveRuntimeAssets,checkRuntimeAssets,runtimeAssetsRouter} from './assets'
import {NativeRenderError,type NativeRenderOptions,type NativeRenderResult,type RuntimeAssetPaths} from './types'
import {RENDER_BUDGET,exportScale} from './budgets'
import {runHeavyWork,transferSVGProof} from '../heavy-work/runner'
import {HEAVY_MEMORY_PROFILE} from '../heavy-work/memory-profile'
import {availableHeavyMemory} from '../heavy-work/resources'
import type {NativeDrawingProject} from '../../src/drawing/engine/types'
import {validateNativeProject,isNativeCanvasProject,assertNativeResourceSafety,nativeCanvasRenderSignature} from '../../src/drawing/engine/native-canvas'
import {DRAWIO_VERSION} from '../../src/drawing/engine/constants'
import {DrawioHostController} from '../../src/drawing/engine/drawio-host/controller'
import {drawioHostURL} from '../../src/drawing/engine/drawio-host/library'
import {drawioRenderSignature,projectDrawio} from '../../src/drawing/engine/drawio'
import {parseNative,attr,type NativeDocument} from '../../src/drawing/engine/drawio/xml'
import {compactFontSubset} from './compact-fonts'
import {RUNTIME_BROWSER_VERSION,RUNTIME_FONT_ALIASES,RUNTIME_FONT_FAMILY,RUNTIME_FONT_SHA256,RUNTIME_FONT_FILE} from '../../src/drawing/engine/runtime-assets'

const useCompactFontProfile=process.env.FLYMIND_MEMORY_PROFILE==='compact-1g'
function fontsUsed(n:NativeDocument){
 const fonts=new Set<string>([RUNTIME_FONT_FAMILY])
 for(const e of n.cells.values()){
  const style=attr(e.cell,'style')??'';for(const match of style.matchAll(/(?:^|;)fontFamily=([^;]+)(?:;|$)/g))fonts.add(match[1])
  const label=attr(e.object,'label')??attr(e.cell,'value')??''
  if(label&&!/(?:^|;)fontFamily=/.test(style))fonts.add('Helvetica')
  if(/(?:^|;)html=1(?:;|$)/.test(style)&&/<(?:iframe|script|foreignObject)\b|font-family\s*[:=]|<font\b/i.test(label))throw new NativeRenderError('UNSUPPORTED_HTML_RESOURCE','装饰包含未支持的 HTML 字体/资源')
 }
 for(const f of fonts)if(!(RUNTIME_FONT_ALIASES as readonly string[]).includes(f))throw new NativeRenderError('UNSUPPORTED_FONT',`无固定供应字体：${f}`)
 return [...fonts]
}
async function cleanupDeadline<T>(operation:Promise<T>,ms:number,message:string):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined
 try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new NativeRenderError('BROWSER_CLEANUP_FAILED',message)),ms)})])}
 finally{clearTimeout(timer)}
}
interface RenderQuiescenceTracker {work?:Promise<unknown>;lateContext?:Promise<unknown>;cleanupFailure?:unknown;reservation?:AbortController}
/** Decode before launching SVG packaging so the potentially large base64 reply
 * is no longer retained through that worker's allocation phase. */
export function decodePNGReply(reply:{data?:unknown}):Buffer{
 const data=reply.data;delete reply.data
 if(typeof data!=='string'||!data.startsWith('data:image/png;base64,')||data.length>RENDER_BUDGET.maxPNGBytes*4/3+100)throw new NativeRenderError('OUTPUT_BUDGET','PNG输出超量或无效')
 const png=Buffer.from(data.slice(data.indexOf(',')+1),'base64')
 if(png.length<24||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new NativeRenderError('INVALID_PNG','原生PNG无效')
 return png
}
/** A load reply can include the whole XML. Retain only export dimensions. */
export function captureRenderBounds(value:unknown):{width:number|undefined;height:number|undefined}{
 const bounds=value&&typeof value==='object'?(value as {modelBounds?:unknown}).modelBounds:undefined
 const record=bounds&&typeof bounds==='object'?bounds as {width?:unknown;height?:unknown}:undefined
 return {width:typeof record?.width==='number'?record.width:undefined,height:typeof record?.height==='number'?record.height:undefined}
}
export class NativeDrawioRenderer {
 private readonly assets:RuntimeAssetPaths
 private ownedBrowser?:HiddenBrowser
 private browser?:Promise<Browser>;private server?:Server;private startup?:Promise<string>;private closed=false
 private jobs=new Set<AbortController>()
 private readonly maxJobs:number=RENDER_BUDGET.maxJobs
 private quiescenceFailed=false
 private readonly closingSignal=new AbortController()
 private idleTimer?:ReturnType<typeof setTimeout>
 private browserClosing?:Promise<void>
 private browserCloseError?:unknown
 private pressureGate?:{promise:Promise<void>;release:()=>void}
 private readonly packageWorks=new Set<Promise<unknown>>()
 private pressureMonitor?:{active:boolean;sampling:boolean;timer?:ReturnType<typeof setInterval>}
 private pressureSequence=0
 private lastPressureError?:NativeRenderError
 private readonly browserIdleMs:number
 private readonly contextCleanupMs:number;private readonly browserCleanupMs:number
 constructor(options:{assets?:RuntimeAssetPaths;browserIdleMs?:number;contextCleanupMs?:number;browserCleanupMs?:number}={}){this.assets=options.assets??resolveRuntimeAssets();this.browserIdleMs=options.browserIdleMs??5000;this.contextCleanupMs=options.contextCleanupMs??1500;this.browserCleanupMs=options.browserCleanupMs??15000;if(!Number.isInteger(this.browserIdleMs)||this.browserIdleMs<1||this.browserIdleMs>60000)throw new NativeRenderError('INVALID_IDLE_TIMEOUT','浏览器空闲预算必须为1–60000ms');if(![this.contextCleanupMs,this.browserCleanupMs].every(ms=>Number.isInteger(ms)&&ms>=1&&ms<=60000))throw new NativeRenderError('INVALID_CLEANUP_TIMEOUT','浏览器清理预算必须为1–60000ms')}
 // Readiness still launches the fixed sandboxed browser and verifies its actual
 // version. Cloud startup can release it immediately after this capability check.
 async ready(options:{keepBrowser?:boolean}={}){const sequence=this.pressureSequence;try{await this.start();await this.getBrowser();if(options.keepBrowser===false&&this.jobs.size===0)await this.releaseBrowser();else this.scheduleIdle();if(this.pressureSequence!==sequence)throw this.lastPressureError}catch(error){if(this.browserCloseError)throw this.browserCloseError;if(!this.closed&&this.pressureSequence!==sequence)throw this.lastPressureError;throw error}}
 private cancelIdle(){clearTimeout(this.idleTimer);this.idleTimer=undefined}
 private scheduleIdle(){this.cancelIdle();if(this.closed||this.jobs.size||!this.browser)return;this.idleTimer=setTimeout(()=>{this.idleTimer=undefined;if(!this.jobs.size)void this.releaseBrowser().catch(()=>{})},this.browserIdleMs);this.idleTimer.unref()}
 private releaseBrowser(){
  this.cancelIdle();if(this.browserClosing)return this.browserClosing
  const launching=this.browser,owned=this.ownedBrowser
  if(!launching&&!owned)return Promise.resolve()
  const closing=(async()=>{let currentOwned:HiddenBrowser|undefined
   await cleanupDeadline((async()=>{const browser=await launching?.catch(()=>undefined);currentOwned=owned??this.ownedBrowser;if(currentOwned)await currentOwned.close();else await browser?.close()})(),this.browserCleanupMs,'自有浏览器清理超时，禁止创建新浏览器')
   if(this.browser===launching)this.browser=undefined;if(this.ownedBrowser===currentOwned)this.ownedBrowser=undefined;this.browserCloseError=undefined
  })().catch(error=>{this.browserCloseError=error;throw error}).finally(()=>{if(this.browserClosing===closing)this.browserClosing=undefined;this.updatePressureMonitor()})
  this.browserClosing=closing;return closing
 }
 private retireBrowser(exempt?:AbortController,owner?:Promise<Browser>){
  // Only the owning generation may be retired. A different current browser
  // means the old generation's close completed before it was replaced.
  if(owner&&this.browser!==owner)return Promise.resolve()
  if(this.browserCloseError){for(const job of this.jobs)job.abort(new NativeRenderError('BROWSER_CLEANUP_FAILED','浏览器上下文清理失败'));return Promise.reject(this.browserCloseError)}
  // A stuck context may belong to the shared browser. Fence acquisition before
  // abort callbacks can re-enter; never exempt a job from an existing retirement.
  const canExempt=!!exempt&&!this.browserClosing&&!this.browserCloseError&&!!(this.browser||this.ownedBrowser)
  const closing=this.releaseBrowser()
  for(const job of this.jobs)if(!canExempt||job!==exempt)job.abort(new NativeRenderError('BROWSER_CLEANUP_FAILED','浏览器上下文清理失败'))
  return closing
 }
 private browserDisconnected(launching:Promise<Browser>){if(this.browser===launching)void this.releaseBrowser().catch(()=>{})}
 private sampleAvailableMemory(){return availableHeavyMemory()}
 private sampleAdmissionMemory(){return availableHeavyMemory()}
 private samplePressureMemory(){return availableHeavyMemory()}
 private fenceActivePackages(){
  if(!this.packageWorks.size||this.pressureGate)return
  let resolve!:()=>void;const promise=new Promise<void>(yes=>resolve=yes),gate={promise,release:()=>{if(this.pressureGate===gate)this.pressureGate=undefined;resolve()}}
  this.pressureGate=gate;void Promise.allSettled([...this.packageWorks]).then(gate.release)
 }
 /** Best-effort runtime protection, not a hard memory limit. */
 private updatePressureMonitor(){
  if(this.closed||this.browserCloseError||!this.jobs.size&&!this.browser&&!this.browserClosing){const old=this.pressureMonitor;if(old){old.active=false;clearInterval(old.timer);this.pressureMonitor=undefined}return}
  if(this.pressureMonitor)return
  const monitor:{active:boolean;sampling:boolean;timer?:ReturnType<typeof setInterval>}={active:true,sampling:false};this.pressureMonitor=monitor
  const tick=()=>{if(!monitor.active||monitor.sampling)return;monitor.sampling=true;const owner=this.browser;let deadline:ReturnType<typeof setTimeout>|undefined
   const sampled=Promise.race([Promise.resolve().then(()=>this.samplePressureMemory()),new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(Error('memory sample timeout')),500);deadline.unref()})])
   void sampled.then(value=>{if(!Number.isFinite(value)||value<0)throw Error('invalid memory sample');return value<HEAVY_MEMORY_PROFILE.browserPressureBytes?new NativeRenderError('RENDER_MEMORY_PRESSURE','绘图期间可用内存不足，已取消渲染'):undefined},()=>new NativeRenderError('RENDER_MEMORY_CHECK_FAILED','绘图期间无法确认可用内存，已取消渲染'))
    .catch(()=>new NativeRenderError('RENDER_MEMORY_CHECK_FAILED','绘图期间无法确认可用内存，已取消渲染'))
    .then(error=>{if(!error||!monitor.active||this.closed||this.browser!==owner)return
     monitor.active=false;clearInterval(monitor.timer);if(this.pressureMonitor===monitor)this.pressureMonitor=undefined
     this.pressureSequence++;this.lastPressureError=error
     // Fence the owning generation synchronously before abort handlers re-enter.
     this.fenceActivePackages()
     const closing=owner?this.releaseBrowser():this.browserClosing
     for(const job of this.jobs)job.abort(error)
     if(closing)void closing.catch(()=>{})
    }).finally(()=>{clearTimeout(deadline);monitor.sampling=false})
  }
  monitor.timer=setInterval(tick,100);monitor.timer.unref();tick()
 }
 private packageSVG(svg:string,signal:AbortSignal,timeoutMs:number){return runHeavyWork<{svg:string;metadataValid?:true}>('svg-fonts',{svg,fontFile:resolve(this.assets.fontRoot,RUNTIME_FONT_FILE)},{signal,timeoutMs})}
 private async start(){
  if(!this.startup)this.startup=(async()=>{
   await checkRuntimeAssets(this.assets);if(this.closed)throw new NativeRenderError('RENDERER_CLOSED','renderer 已关闭')
   const app=express(),server=createServer(app);this.server=server
   app.get('/renderer',(_req,res)=>res.type('html').send('<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe style="width:1800px;height:1200px;border:0" title="isolated render"></iframe><script>window.__receiveNative=(e)=>{const frame=document.querySelector("iframe");if(e.origin===location.origin&&e.source===frame.contentWindow&&typeof e.data==="string")window.__nativeMessage(e.data,e.origin)};addEventListener("message",window.__receiveNative);window.__sendNative=(data,origin)=>document.querySelector("iframe").contentWindow.postMessage(data,origin);</script>'))
   app.use(runtimeAssetsRouter(this.assets));await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes)})
   const address=server.address();if(!address||typeof address==='string')throw Error('server address');return `http://127.0.0.1:${address.port}`
  })().catch(e=>{this.startup=undefined;throw e})
  return this.startup
 }
 private getBrowser(signal?:AbortSignal):Promise<Browser>{
  this.cancelIdle()
  if(signal?.aborted)return Promise.reject(signal.reason)
  if(this.closed)return Promise.reject(new NativeRenderError('RENDERER_CLOSED','renderer 已关闭'))
  if(this.pressureGate){const gate=this.pressureGate
   return new Promise<Browser>((resolve,reject)=>{
    let done=false
    const finish=(error?:unknown)=>{if(done)return;done=true;signal?.removeEventListener('abort',cancel);this.closingSignal.signal.removeEventListener('abort',stop);if(error!==undefined)reject(error);else this.getBrowser(signal).then(resolve,reject)}
    const cancel=()=>finish(signal?.reason??new NativeRenderError('ABORTED','任务被调用方中断'))
    const stop=()=>finish(new NativeRenderError('RENDERER_CLOSED','renderer 已关闭'))
    signal?.addEventListener('abort',cancel,{once:true});this.closingSignal.signal.addEventListener('abort',stop,{once:true});if(signal?.aborted){cancel();return}if(this.closed){stop();return}
    gate.promise.then(()=>finish(),finish)
   })
  }
  if(this.browserClosing)return this.browserClosing.then(()=>this.getBrowser(signal))
  if(this.browserCloseError)return Promise.reject(this.browserCloseError)
  if(this.browser)return this.browser
  let owned:HiddenBrowser|undefined,launchedBrowser:Browser|undefined
  const pressureSequence=this.pressureSequence
  const launching=(async()=>{
   if(await this.sampleAdmissionMemory()<HEAVY_MEMORY_PROFILE.browserAdmissionBytes)throw new NativeRenderError('RENDER_MEMORY_LOW','可用内存不足，未启动绘图浏览器')
   if(this.closed)throw new NativeRenderError('RENDERER_CLOSED','renderer 已关闭')
   if(this.pressureSequence!==pressureSequence)throw this.lastPressureError
   const browser=launchedBrowser=process.platform==='win32'?(owned=await launchHiddenBrowser(this.assets.browserExecutable)).browser:await chromium.launch({executablePath:this.assets.browserExecutable,headless:true,chromiumSandbox:true,args:['--disable-background-networking','--disable-component-update']})
   if(owned)this.ownedBrowser=owned
   if(this.closed||browser.version()!==RUNTIME_BROWSER_VERSION){try{if(owned)await owned.close();else await browser.close()}catch(cleanupError){this.browserCloseError=cleanupError;throw cleanupError}throw new NativeRenderError(this.closed?'RENDERER_CLOSED':'BROWSER_VERSION_MISMATCH',this.closed?'renderer 已关闭':`需要 ${RUNTIME_BROWSER_VERSION}，实际 ${browser.version()}`)}
   browser.on('disconnected',()=>this.browserDisconnected(launching))
   return browser
  })().catch(async error=>{try{if(this.browser===launching)this.browser=undefined;if(this.browserCloseError){if(launchedBrowser&&!owned)this.browser=Promise.resolve(launchedBrowser);throw this.browserCloseError}try{if(owned)await owned.close();else await launchedBrowser?.close()}catch(cleanupError){this.browserCloseError=cleanupError;if(launchedBrowser&&!owned)this.browser=Promise.resolve(launchedBrowser);throw cleanupError}throw error}finally{this.updatePressureMonitor()}})
  this.browser=launching;this.updatePressureMonitor();return launching
 }
 render(input:NativeDrawingProject,options:NativeRenderOptions={}):Promise<NativeRenderResult>{const tracked=this.renderTracked(input,options);return tracked.result.then(async result=>{await tracked.quiescence;return result})}
 /** Internal-only lifecycle handle; result retains the public render deadline. */
 renderTracked(input:NativeDrawingProject,options:NativeRenderOptions={}):{result:Promise<NativeRenderResult>;quiescence:Promise<void>}{
  const tracker:RenderQuiescenceTracker={};let resolve!:()=>void,reject!:(error:unknown)=>void
  const quiescence=new Promise<void>((yes,no)=>{resolve=yes;reject=no});void quiescence.catch(()=>{})
  const result=this.renderInternal(input,options,tracker)
  const finish=()=>{if(tracker.reservation){this.jobs.delete(tracker.reservation);this.scheduleIdle();this.updatePressureMonitor()}}
  void (async()=>{await result.catch(()=>{});if(tracker.cleanupFailure!==undefined)throw tracker.cleanupFailure;await tracker.work?.catch(()=>{});await tracker.lateContext;if(tracker.cleanupFailure!==undefined)throw tracker.cleanupFailure})().then(()=>{finish();resolve()},error=>{this.quiescenceFailed=true;finish();reject(error)})
  return {result,quiescence}
 }
 private async renderInternal(input:NativeDrawingProject,options:NativeRenderOptions,tracker:RenderQuiescenceTracker):Promise<NativeRenderResult>{
  if(this.closed)throw new NativeRenderError('RENDERER_CLOSED','renderer 已关闭')
  const timeout=options.timeoutMs??RENDER_BUDGET.timeoutMs
  if(!Number.isInteger(timeout)||timeout<1||timeout>RENDER_BUDGET.timeoutMs)throw new NativeRenderError('INVALID_TIMEOUT','timeoutMs 必须为1–60000')
  if(options.background!==undefined&&!['white','transparent'].includes(options.background))throw new NativeRenderError('INVALID_BACKGROUND','仅支持白底或透明')
  exportScale(1,1,options.scale??1)
  if(options.signal?.aborted)throw new NativeRenderError('ABORTED','任务已中断')
  if(this.quiescenceFailed)throw new NativeRenderError('BROWSER_CLEANUP_FAILED','上次渲染清理状态不明，禁止启动新渲染')
  if(this.jobs.size>=this.maxJobs)throw new NativeRenderError('RENDERER_BUSY','并发渲染任务超出预算')
  const started=performance.now(),abort=new AbortController();tracker.reservation=abort;this.jobs.add(abort);this.cancelIdle()
  let context:BrowserContext|undefined,contextOwner:Promise<Browser>|undefined,contextPending:Promise<BrowserContext>|undefined,contextClosing:Promise<void>|undefined,contextAbandoned=false,contextClosedCleanly=false,controller:DrawioHostController|undefined,timer:ReturnType<typeof setTimeout>|undefined
  // Active work and finally can race to close the same context. A late context
  // after browser retirement must never retire a replacement browser.
  const closeContext=(target:BrowserContext,canContinue=false)=>contextClosing??=(async()=>{
   try{await cleanupDeadline(Promise.resolve().then(()=>target.close()),this.contextCleanupMs,'浏览器上下文清理超时');contextClosedCleanly=true}
   catch{if(!contextAbandoned){try{await this.retireBrowser(canContinue?abort:undefined,contextOwner)}catch(error){tracker.cleanupFailure=error;throw error}if(!canContinue)throw new NativeRenderError('BROWSER_CLEANUP_FAILED','浏览器上下文清理失败')}}
  })()
  const onAbort=()=>abort.abort(new NativeRenderError('ABORTED','任务被调用方中断'));options.signal?.addEventListener('abort',onAbort,{once:true})
  const interrupted=new Promise<never>((_,reject)=>{abort.signal.addEventListener('abort',()=>reject(abort.signal.reason),{once:true});timer=setTimeout(()=>abort.abort(new NativeRenderError('RENDER_TIMEOUT','渲染任务超出硬时间预算')),timeout)})
  this.updatePressureMonitor()
  const check=()=>{if(abort.signal.aborted)throw abort.signal.reason;if(this.closed)throw new NativeRenderError('RENDERER_CLOSED','renderer 已关闭')}
  try{const work=(async()=>{
   const project=await validateNativeProject(structuredClone(input));check();assertNativeResourceSafety(project.rendering.engine.xml)
   const {fonts,fontSubset}=(()=>{const native=parseNative(project.rendering.engine.xml),fonts=fontsUsed(native);let fontSubset:string[]|undefined
    if(useCompactFontProfile)try{fontSubset=compactFontSubset(project.rendering.engine.xml,native)}catch{/* An unrecognized input keeps the original complete font. */}
    return {fonts,fontSubset}
   })(),origin=await this.start();check()
   // Admission, not an OS memory quota: retain headroom before a new browser
   // context and its CPU worker can allocate. Other services can still compete.
   if(await this.sampleAdmissionMemory()<HEAVY_MEMORY_PROFILE.browserAdmissionBytes)throw new NativeRenderError('RENDER_MEMORY_LOW','可用内存不足，未启动本次绘图渲染；请稍后显式重试')
   check();const beforeBrowser=performance.now(),browser=await this.getBrowser(abort.signal);check();const owner=this.browser
   if(!owner||await owner!==browser||this.browser!==owner||this.browserClosing)throw new NativeRenderError('BROWSER_CLEANUP_FAILED','浏览器已退役，未创建上下文')
   check();contextOwner=owner;const browserStartMs=performance.now()-beforeBrowser
   contextPending=browser.newContext({viewport:{width:1800,height:1200},serviceWorkers:'block'})
   // A context may arrive after the outer deadline and browser retirement.
   tracker.lateContext=contextPending.then(async late=>{if(abort.signal.aborted||this.closed)await closeContext(late)},()=>{})
   void tracker.lateContext.catch(()=>{})
   context=await contextPending;check();const page=await context.newPage();check()
   const external:string[]=[],failures:string[]=[];await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();external.push(url);return route.abort()})
   page.on('pageerror',e=>{failures.push(e.message);for(const request of pending.values())request.reject(new NativeRenderError('EDITOR_SCRIPT_ERROR',e.message));pending.clear()});const target={},pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();let lastBounds:{width:number|undefined;height:number|undefined}|undefined
   let readyResolve!:()=>void,readyReject!:(e:Error)=>void;const ready=new Promise<void>((yes,no)=>{readyResolve=yes;readyReject=no});void ready.catch(()=>{})
   abort.signal.addEventListener('abort',()=>{readyReject(abort.signal.reason);for(const p of pending.values())p.reject(abort.signal.reason);pending.clear()},{once:true})
   const post=(data:string,targetOrigin:string)=>{void page.evaluate(({data,targetOrigin})=>(window as any).__sendNative(data,targetOrigin),{data,targetOrigin}).catch(e=>{readyReject(e);for(const p of pending.values())p.reject(e)})}
   controller=new DrawioHostController({sessionKey:randomUUID(),initialXML:project.rendering.engine.xml,title:isNativeCanvasProject(project)?project.title:project.content.title,origin,source:()=>target,post,fontFamilies:fonts,fontSubset,onReady:readyResolve,onError:e=>readyReject(new NativeRenderError(e.code,e.message))})
   await page.exposeBinding('__nativeMessage',({frame},data:unknown,eventOrigin:unknown)=>{
    if(frame!==page.mainFrame()||eventOrigin!==origin||typeof data!=='string'||data.length>RENDER_BUDGET.maxMessageBytes||Buffer.byteLength(data)>RENDER_BUDGET.maxMessageBytes)return
    let event:any;try{event=JSON.parse(data)}catch{return}if(event?.event==='load')lastBounds=captureRenderBounds(event)
    if(event?.event==='export'&&typeof event.message?.message==='string'&&pending.has(event.message.message)){
     const request=pending.get(event.message.message)!;pending.delete(event.message.message)
     if(event.error!==undefined||event.message.action!=='export'||event.message.format!==event.format)request.reject(new NativeRenderError('EXPORT_FAILED','原生导出错误或格式失配'));else request.resolve(event)
    }else controller?.handle({source:target,origin,data})
   })
   const loadStart=performance.now();await page.goto(origin+'/renderer',{waitUntil:'load'});await page.locator('iframe').evaluate((el,url)=>(el as HTMLIFrameElement).src=url,drawioHostURL(origin,project.rendering.engine.xml));await ready;check()
   const frame=page.frames().find(f=>f.url().startsWith(origin+'/drawio/'));if(!frame)throw new NativeRenderError('EDITOR_MISSING','原生编辑器frame未加载')
   const fontReady=await frame.evaluate(async families=>{for(const family of families)await document.fonts.load(`16px "${family}"`,'中文流程');await document.fonts.ready;return families.every(f=>document.fonts.check(`16px "${f}"`,'中文流程'))},fonts)
   if(!fontReady)throw new NativeRenderError('FONT_NOT_READY','固定字体未加载')
   const nativeXML=await controller.captureXML(),projected=isNativeCanvasProject(project)?undefined:await projectDrawio(nativeXML);check()
   const signature=isNativeCanvasProject(project)?nativeCanvasRenderSignature:drawioRenderSignature
   if(!isNativeCanvasProject(project)&&projected!.contentHash!==project.rendering.engine.contentHash||signature(nativeXML)!==signature(project.rendering.engine.xml))throw new NativeRenderError('NATIVE_DOCUMENT_CHANGED','原生load/save改变了业务或人工几何/样式')
   const loadMs=performance.now()-loadStart,scale=exportScale(lastBounds?.width as number,lastBounds?.height as number,options.scale??1),background=options.background??'white',exportStart=performance.now()
   const exportOne=async(format:'png'|'svg')=>{check();const id=randomUUID(),result=new Promise<any>((resolve,reject)=>pending.set(id,{resolve,reject}));post(JSON.stringify({action:'export',format,message:id,scale,border:8,background:background==='white'?'#ffffff':'none',transparent:background==='transparent',embedImages:true,embedFonts:false,...(format==='svg'?{asText:true}:{})}),origin);return result}
   const svgReply=await exportOne('svg');check();const pngReply=await exportOne('png');check()
   if(typeof svgReply.data!=='string'||Buffer.byteLength(svgReply.data)>RENDER_BUDGET.maxSVGBytes)throw new NativeRenderError('OUTPUT_BUDGET','SVG输出超量或无效')
   const png=decodePNGReply(pngReply)
   const width=png.readUInt32BE(16),height=png.readUInt32BE(20);if(width>RENDER_BUDGET.maxDimension||height>RENDER_BUDGET.maxDimension||width*height>RENDER_BUDGET.maxPixels)throw new NativeRenderError('DIMENSION_BUDGET','原生PNG超出像素预算')
   await closeContext(context,true);check()
   const checkResources=()=>{if(external.length||failures.length)throw new NativeRenderError('UNRESOLVED_RESOURCE',`阻断外联/编辑器错误：${[...external,...failures].join(';').slice(0,2000)}`)}
   checkResources()
   let releasePressureGate:(()=>void)|undefined
   try{
    if(contextClosedCleanly){let available:number|undefined
     try{available=await this.sampleAvailableMemory()}catch{/* The worker retains its own mandatory memory admission. */}
     check();checkResources()
     // Install the worker fence before starting browser close, without yielding.
     if(available!==undefined&&available<HEAVY_MEMORY_PROFILE.svgAdmissionBytes&&this.jobs.size===1&&this.jobs.has(abort)&&this.browser===contextOwner&&!this.browserClosing&&!this.browserCloseError&&!this.pressureGate&&(!this.ownedBrowser||this.ownedBrowser.browser===browser)){
      let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve),gate={promise,release:()=>{if(this.pressureGate===gate)this.pressureGate=undefined;release()}}
      this.pressureGate=gate;releasePressureGate=gate.release
      await this.releaseBrowser();check();checkResources()
     }
    }
    const work=this.packageSVG(svgReply.data,abort.signal,Math.max(1,Math.floor(Math.min(30000,timeout-(performance.now()-started)))))
    this.packageWorks.add(work);void work.then(()=>this.packageWorks.delete(work),()=>this.packageWorks.delete(work))
    const packaged=await work,{svg}=packaged;check()
    if(Buffer.byteLength(svg)>RENDER_BUDGET.maxSVGBytes)throw new NativeRenderError('OUTPUT_BUDGET','封装SVG超出字节预算')
    // Drawing/font/resource checks run in the bounded CPU worker; a synchronous
    // SVG parse cannot prevent HTTP timers or the export heartbeat from running.
    checkResources()
    const warnings=fonts.filter(f=>f!==RUNTIME_FONT_FAMILY).map(f=>`字体 ${f} 由固定 ${RUNTIME_FONT_FAMILY} 兼容替代；源XML/几何未改`);if(scale<(options.scale??1))warnings.push(`实际导出比例 ${scale}（尺寸/像素预算）`)
    const result={png,svg,width,height,scale,nativeXML,nativeSVG:svgReply.data,runtime:{drawioVersion:DRAWIO_VERSION,browserVersion:browser.version(),fontFamily:RUNTIME_FONT_FAMILY,fontSha256:RUNTIME_FONT_SHA256},timings:{totalMs:performance.now()-started,browserStartMs,loadMs,exportMs:performance.now()-exportStart},warnings}
    transferSVGProof(packaged,result)
    return result
   }finally{releasePressureGate?.()}
  })();tracker.work=work;return await Promise.race([interrupted,work])}finally{
   clearTimeout(timer);options.signal?.removeEventListener('abort',onAbort);controller?.dispose()
   try{
    if(context){try{await closeContext(context)}catch(error){if(this.browserCloseError)throw error}}
    else if(contextPending){contextAbandoned=true;try{await this.retireBrowser(undefined,contextOwner)}catch(error){tracker.cleanupFailure=error;throw error}}
   }finally{this.updatePressureMonitor()}
  }
 }
 async close(){this.closed=true;this.updatePressureMonitor();this.closingSignal.abort();this.cancelIdle();for(const job of this.jobs)job.abort(new NativeRenderError('RENDERER_CLOSED','renderer 已关闭'));await this.startup?.catch(()=>{});try{await this.releaseBrowser()}finally{this.server?.closeAllConnections();if(this.server?.listening)await new Promise<void>(resolve=>this.server!.close(()=>resolve()))}}
}
