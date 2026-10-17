import {createServer,type Server} from 'node:http'
import {randomUUID,createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import express from 'express'
import {chromium,type Browser,type BrowserContext} from 'playwright-core'
import {launchHiddenBrowser,type HiddenBrowser} from './hidden-browser'
import {inspectNativeSVGResources} from './svg-resources'
import {resolveRuntimeAssets,checkRuntimeAssets,runtimeAssetsRouter} from './assets'
import {NativeRenderError,type NativeRenderOptions,type NativeRenderResult,type RuntimeAssetPaths} from './types'
import {RENDER_BUDGET,exportScale} from './budgets'
import {packageNativeSVGFonts} from './svg-fonts'
import type {NativeDrawingProject} from '../../src/drawing/engine/types'
import {validateNativeProject,isNativeCanvasProject,assertNativeResourceSafety,nativeCanvasRenderSignature} from '../../src/drawing/engine/native-canvas'
import {DRAWIO_VERSION} from '../../src/drawing/engine/constants'
import {DrawioHostController} from '../../src/drawing/engine/drawio-host/controller'
import {drawioHostURL} from '../../src/drawing/engine/drawio-host/library'
import {drawioRenderSignature,projectDrawio} from '../../src/drawing/engine/drawio'
import {parseNative,attr} from '../../src/drawing/engine/drawio/xml'
import {RUNTIME_BROWSER_VERSION,RUNTIME_FONT_ALIASES,RUNTIME_FONT_FAMILY,RUNTIME_FONT_SHA256,RUNTIME_FONT_FILE} from '../../src/drawing/engine/runtime-assets'

function fontsUsed(xml:string){
 const n=parseNative(xml),fonts=new Set<string>([RUNTIME_FONT_FAMILY])
 for(const e of n.cells.values()){
  const style=attr(e.cell,'style')??'';for(const match of style.matchAll(/(?:^|;)fontFamily=([^;]+)(?:;|$)/g))fonts.add(match[1])
  const label=attr(e.object,'label')??attr(e.cell,'value')??''
  if(label&&!/(?:^|;)fontFamily=/.test(style))fonts.add('Helvetica')
  if(/(?:^|;)html=1(?:;|$)/.test(style)&&/<(?:iframe|script|foreignObject)\b|font-family\s*[:=]|<font\b/i.test(label))throw new NativeRenderError('UNSUPPORTED_HTML_RESOURCE','装饰包含未支持的 HTML 字体/资源')
 }
 for(const f of fonts)if(!(RUNTIME_FONT_ALIASES as readonly string[]).includes(f))throw new NativeRenderError('UNSUPPORTED_FONT',`无固定供应字体：${f}`)
 return [...fonts]
}
export class NativeDrawioRenderer {
 private readonly assets:RuntimeAssetPaths
 private ownedBrowser?:HiddenBrowser
 private browser?:Promise<Browser>;private server?:Server;private startup?:Promise<string>;private closed=false
 private jobs=new Set<AbortController>()
 constructor(options:{assets?:RuntimeAssetPaths}={}){this.assets=options.assets??resolveRuntimeAssets()}
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
 private getBrowser(){
  if(this.browser)return this.browser
  let owned:HiddenBrowser|undefined
  const launching=(async()=>{
   const browser=process.platform==='win32'?(owned=await launchHiddenBrowser(this.assets.browserExecutable)).browser:await chromium.launch({executablePath:this.assets.browserExecutable,headless:true,args:['--disable-background-networking','--disable-component-update']})
   if(owned)this.ownedBrowser=owned
   if(this.closed||browser.version()!==RUNTIME_BROWSER_VERSION){if(owned)await owned.close();else await browser.close();throw new NativeRenderError(this.closed?'RENDERER_CLOSED':'BROWSER_VERSION_MISMATCH',this.closed?'renderer 已关闭':`需要 ${RUNTIME_BROWSER_VERSION}，实际 ${browser.version()}`)}
   browser.on('disconnected',()=>{if(this.browser===launching)this.browser=undefined})
   return browser
  })().catch(async error=>{if(this.browser===launching)this.browser=undefined;await owned?.close().catch(()=>{});throw error})
  this.browser=launching;return launching
 }
 async render(input:NativeDrawingProject,options:NativeRenderOptions={}):Promise<NativeRenderResult>{
  if(this.closed)throw new NativeRenderError('RENDERER_CLOSED','renderer 已关闭')
  const timeout=options.timeoutMs??RENDER_BUDGET.timeoutMs
  if(!Number.isInteger(timeout)||timeout<1||timeout>RENDER_BUDGET.timeoutMs)throw new NativeRenderError('INVALID_TIMEOUT','timeoutMs 必须为1–60000')
  if(options.background!==undefined&&!['white','transparent'].includes(options.background))throw new NativeRenderError('INVALID_BACKGROUND','仅支持白底或透明')
  exportScale(1,1,options.scale??1)
  if(options.signal?.aborted)throw new NativeRenderError('ABORTED','任务已中断')
  if(this.jobs.size>=RENDER_BUDGET.maxJobs)throw new NativeRenderError('RENDERER_BUSY','并发渲染任务超出预算')
  const started=performance.now(),abort=new AbortController();this.jobs.add(abort)
  let context:BrowserContext|undefined,controller:DrawioHostController|undefined,timer:ReturnType<typeof setTimeout>|undefined
  const onAbort=()=>abort.abort(new NativeRenderError('ABORTED','任务被调用方中断'));options.signal?.addEventListener('abort',onAbort,{once:true})
  const interrupted=new Promise<never>((_,reject)=>{abort.signal.addEventListener('abort',()=>reject(abort.signal.reason),{once:true});timer=setTimeout(()=>abort.abort(new NativeRenderError('RENDER_TIMEOUT','渲染任务超出硬时间预算')),timeout)})
  const check=()=>{if(abort.signal.aborted)throw abort.signal.reason;if(this.closed)throw new NativeRenderError('RENDERER_CLOSED','renderer 已关闭')}
  try{return await Promise.race([interrupted,(async()=>{
   const project=await validateNativeProject(structuredClone(input));check();assertNativeResourceSafety(project.rendering.engine.xml);const fonts=fontsUsed(project.rendering.engine.xml),origin=await this.start();check()
   const beforeBrowser=performance.now(),browser=await this.getBrowser();check();const browserStartMs=performance.now()-beforeBrowser
   context=await browser.newContext({viewport:{width:1800,height:1200},serviceWorkers:'block'});if(abort.signal.aborted||this.closed)await context.close().catch(()=>{});check();const page=await context.newPage();check()
   const external:string[]=[],failures:string[]=[];await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();external.push(url);return route.abort()})
   page.on('pageerror',e=>{failures.push(e.message);for(const request of pending.values())request.reject(new NativeRenderError('EDITOR_SCRIPT_ERROR',e.message));pending.clear()});const target={},pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();let lastLoad:any
   let readyResolve!:()=>void,readyReject!:(e:Error)=>void;const ready=new Promise<void>((yes,no)=>{readyResolve=yes;readyReject=no})
   abort.signal.addEventListener('abort',()=>{readyReject(abort.signal.reason);for(const p of pending.values())p.reject(abort.signal.reason);pending.clear()},{once:true})
   const post=(data:string,targetOrigin:string)=>{void page.evaluate(({data,targetOrigin})=>(window as any).__sendNative(data,targetOrigin),{data,targetOrigin}).catch(e=>{readyReject(e);for(const p of pending.values())p.reject(e)})}
   controller=new DrawioHostController({sessionKey:randomUUID(),initialXML:project.rendering.engine.xml,title:isNativeCanvasProject(project)?project.title:project.content.title,origin,source:()=>target,post,fontFamilies:fonts,onReady:readyResolve,onError:e=>readyReject(new NativeRenderError(e.code,e.message))})
   await page.exposeBinding('__nativeMessage',({frame},data:unknown,eventOrigin:unknown)=>{
    if(frame!==page.mainFrame()||eventOrigin!==origin||typeof data!=='string'||data.length>RENDER_BUDGET.maxMessageBytes||Buffer.byteLength(data)>RENDER_BUDGET.maxMessageBytes)return
    let event:any;try{event=JSON.parse(data)}catch{return}if(event?.event==='load')lastLoad=event
    if(event?.event==='export'&&typeof event.message?.message==='string'&&pending.has(event.message.message)){
     const request=pending.get(event.message.message)!;pending.delete(event.message.message)
     if(event.error!==undefined||event.message.action!=='export'||event.message.format!==event.format)request.reject(new NativeRenderError('EXPORT_FAILED','原生导出错误或格式失配'));else request.resolve(event)
    }else controller?.handle({source:target,origin,data})
   })
   const loadStart=performance.now();await page.goto(origin+'/renderer',{waitUntil:'load'});await page.locator('iframe').evaluate((el,url)=>(el as HTMLIFrameElement).src=url,drawioHostURL(origin));await ready;check()
   const frame=page.frames().find(f=>f.url().startsWith(origin+'/drawio/'));if(!frame)throw new NativeRenderError('EDITOR_MISSING','原生编辑器frame未加载')
   const fontReady=await frame.evaluate(async families=>{for(const family of families)await document.fonts.load(`16px "${family}"`,'中文流程');await document.fonts.ready;return families.every(f=>document.fonts.check(`16px "${f}"`,'中文流程'))},fonts)
   if(!fontReady)throw new NativeRenderError('FONT_NOT_READY','固定字体未加载')
   const nativeXML=await controller.captureXML(),projected=isNativeCanvasProject(project)?undefined:await projectDrawio(nativeXML);check()
   const signature=isNativeCanvasProject(project)?nativeCanvasRenderSignature:drawioRenderSignature
   if(!isNativeCanvasProject(project)&&projected!.contentHash!==project.rendering.engine.contentHash||signature(nativeXML)!==signature(project.rendering.engine.xml))throw new NativeRenderError('NATIVE_DOCUMENT_CHANGED','原生load/save改变了业务或人工几何/样式')
   const loadMs=performance.now()-loadStart,bounds=lastLoad?.modelBounds,scale=exportScale(bounds?.width,bounds?.height,options.scale??1),background=options.background??'white',exportStart=performance.now()
   const exportOne=async(format:'png'|'svg')=>{check();const id=randomUUID(),result=new Promise<any>((resolve,reject)=>pending.set(id,{resolve,reject}));post(JSON.stringify({action:'export',format,message:id,scale,border:8,background:background==='white'?'#ffffff':'none',transparent:background==='transparent',embedImages:true,embedFonts:false,...(format==='svg'?{asText:true}:{})}),origin);return result}
   const svgReply=await exportOne('svg');check();const pngReply=await exportOne('png');check()
   if(typeof svgReply.data!=='string'||Buffer.byteLength(svgReply.data)>RENDER_BUDGET.maxSVGBytes)throw new NativeRenderError('OUTPUT_BUDGET','SVG输出超量或无效')
   const svg=packageNativeSVGFonts(svgReply.data,await readFile(resolve(this.assets.fontRoot,RUNTIME_FONT_FILE)))
   if(Buffer.byteLength(svg)>RENDER_BUDGET.maxSVGBytes)throw new NativeRenderError('OUTPUT_BUDGET','封装SVG超出字节预算')
   const {urls}=inspectNativeSVGResources(svg)
   const embeddedFonts=urls.filter(url=>/^data:(font\/|application\/(?:x-font-|font|octet-stream))/i.test(url))
   if(!embeddedFonts.length||embeddedFonts.some(url=>createHash('sha256').update(Buffer.from(url.slice(url.indexOf(',')+1),'base64')).digest('hex')!==RUNTIME_FONT_SHA256))throw new NativeRenderError('FONT_NOT_EMBEDDED','SVG未嵌入固定SHA字体')
   if(typeof pngReply.data!=='string'||!pngReply.data.startsWith('data:image/png;base64,')||pngReply.data.length>RENDER_BUDGET.maxPNGBytes*4/3+100)throw new NativeRenderError('OUTPUT_BUDGET','PNG输出超量或无效')
   const png=Buffer.from(pngReply.data.slice(pngReply.data.indexOf(',')+1),'base64');if(png.length<24||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new NativeRenderError('INVALID_PNG','原生PNG无效')
   const width=png.readUInt32BE(16),height=png.readUInt32BE(20);if(width>RENDER_BUDGET.maxDimension||height>RENDER_BUDGET.maxDimension||width*height>RENDER_BUDGET.maxPixels)throw new NativeRenderError('DIMENSION_BUDGET','原生PNG超出像素预算')
   if(external.length||failures.length)throw new NativeRenderError('UNRESOLVED_RESOURCE',`阻断外联/编辑器错误：${[...external,...failures].join(';').slice(0,2000)}`)
   const warnings=fonts.filter(f=>f!==RUNTIME_FONT_FAMILY).map(f=>`字体 ${f} 由固定 ${RUNTIME_FONT_FAMILY} 兼容替代；源XML/几何未改`);if(scale<(options.scale??1))warnings.push(`实际导出比例 ${scale}（尺寸/像素预算）`)
   return {png,svg,width,height,scale,nativeXML,nativeSVG:svgReply.data,runtime:{drawioVersion:DRAWIO_VERSION,browserVersion:browser.version(),fontFamily:RUNTIME_FONT_FAMILY,fontSha256:RUNTIME_FONT_SHA256},timings:{totalMs:performance.now()-started,browserStartMs,loadMs,exportMs:performance.now()-exportStart},warnings}
  })()])}finally{clearTimeout(timer);options.signal?.removeEventListener('abort',onAbort);controller?.dispose();await context?.close().catch(()=>{});this.jobs.delete(abort)}
 }
 async close(){this.closed=true;for(const job of this.jobs)job.abort(new NativeRenderError('RENDERER_CLOSED','renderer 已关闭'));await this.startup?.catch(()=>{});try{const browser=await this.browser?.catch(()=>undefined);if(this.ownedBrowser)await this.ownedBrowser.close();else await browser?.close()}finally{this.server?.closeAllConnections();if(this.server?.listening)await new Promise<void>(resolve=>this.server!.close(()=>resolve()))}}
}
