import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,dirname,basename} from 'node:path'
import type {Readable,Writable} from 'node:stream'
import {chromium,type Browser,type ConnectOverCDPTransport} from 'playwright-core'
import {NativeRenderError} from './types'

export interface HiddenBrowser {browser:Browser;pid:number;profileDirectory:string;close():Promise<void>}
/** Fixed headless shell is a Windows console executable. Playwright's own
 * launch spawn omits windowsHide; own only this process and its private CDP pipe. */
export const hiddenBrowserSpawnOptions=()=>({windowsHide:true,shell:false,stdio:['ignore','ignore','pipe','pipe','pipe'] as ['ignore','ignore','pipe','pipe','pipe']})
const delay=(ms:number)=>new Promise<void>(resolve=>{const timer=setTimeout(resolve,ms);timer.unref()})
async function ownedTreeKill(child:ChildProcess){
 if(!child.pid||child.exitCode!==null||child.signalCode!==null)return
 if(process.platform==='win32')await new Promise<void>((resolve,reject)=>{const killer=spawn('taskkill.exe',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,shell:false,stdio:'ignore',timeout:3000});killer.once('error',reject);killer.once('close',code=>code===0||child.exitCode!==null?resolve():reject(new NativeRenderError('BROWSER_CLEANUP_FAILED','无法关闭自有浏览器进程树')))})
 else child.kill('SIGKILL')
}
export async function launchHiddenBrowser(executablePath:string):Promise<HiddenBrowser>{
 const profileDirectory=await mkdtemp(join(tmpdir(),'flymind-render-browser-'))
 let child:ChildProcess|undefined,browser:Browser|undefined,exitResolved=false,closePromise:Promise<void>|undefined
 let resolveExit!:()=>void
 const exited=new Promise<void>(resolve=>resolveExit=resolve)
 let buffered=Buffer.alloc(0),stderr='',ended=false,notified=false
 let rejectStartup!:(error:Error)=>void
 const startupFailure=new Promise<never>((_resolve,reject)=>rejectStartup=reject)
 const notify=(reason:string)=>{if(notified)return;notified=true;transport.onclose?.(reason)}
 const queued:object[]=[]
 const transport:ConnectOverCDPTransport={send(message){const pipe=child?.stdio[3] as Writable|undefined;if(ended||!pipe||pipe.destroyed)throw new NativeRenderError('BROWSER_DISCONNECTED','浏览器私有管道已关闭');pipe.write(JSON.stringify(message)+'\0')},close(){ended=true;(child?.stdio[3] as Writable|undefined)?.destroy();(child?.stdio[4] as Readable|undefined)?.destroy();notify('Browser transport closed')},open(){for(const message of queued.splice(0))transport.onmessage?.(message)}}
 async function close(){
  if(closePromise)return closePromise
  closePromise=(async()=>{
   if(browser?.isConnected()){
    const command=browser.newBrowserCDPSession().then(session=>session.send('Browser.close')).catch(()=>{})
    await Promise.race([command,delay(1500)])
   }
   transport.close();await Promise.race([browser?.close().catch(()=>{}),delay(1500)])
   if(child?.pid&&!exitResolved){await Promise.race([exited,delay(3000)]);if(!exitResolved){await ownedTreeKill(child);await Promise.race([exited,delay(3000)])}if(!exitResolved)throw new NativeRenderError('BROWSER_CLEANUP_FAILED','自有浏览器未退出，未清理仍使用中的临时目录')}
   if(dirname(resolve(profileDirectory))!==resolve(tmpdir())||!basename(profileDirectory).startsWith('flymind-render-browser-'))throw new NativeRenderError('BROWSER_CLEANUP_FAILED','拒绝清理非本次浏览器临时目录');await rm(profileDirectory,{recursive:true,force:true,maxRetries:5,retryDelay:100})
  })();return closePromise
 }
 try{
  child=spawn(executablePath,['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-extensions','--disable-default-apps','--disable-sync','--disable-breakpad','--no-first-run','--no-default-browser-check','--enable-automation','--enable-unsafe-swiftshader','--hide-scrollbars','--mute-audio',`--user-data-dir=${profileDirectory}`,'--remote-debugging-pipe','--no-startup-window'],hiddenBrowserSpawnOptions())
  child.once('error',error=>{ended=true;rejectStartup(error);notify('Browser process failed')})
  child.once('close',()=>{exitResolved=true;resolveExit();ended=true;if(!browser)rejectStartup(new NativeRenderError('BROWSER_START_FAILED','浏览器在连接前退出'));notify('Browser process exited');if(browser)void close().catch(()=>{})})
  ;(child.stdio[3] as Writable).once('error',error=>{ended=true;rejectStartup(error);notify('Browser write pipe failed')})
  ;(child.stderr as Readable).on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString('utf8')).slice(-2000)})
  ;(child.stdio[4] as Readable).on('data',(chunk:Buffer)=>{
   buffered=Buffer.concat([buffered,chunk]);if(buffered.length>128*1024*1024){transport.close();rejectStartup(new NativeRenderError('BROWSER_PROTOCOL_FAILED','CDP frame budget exceeded'));notify('CDP frame budget exceeded');return}
   let boundary:number
   while((boundary=buffered.indexOf(0))!==-1){const frame=buffered.subarray(0,boundary);buffered=buffered.subarray(boundary+1);if(!frame.length)continue;try{const message=JSON.parse(frame.toString('utf8'));if(!message||typeof message!=='object'||Array.isArray(message))throw Error();if(transport.onmessage)transport.onmessage(message);else queued.push(message)}catch{transport.close();rejectStartup(new NativeRenderError('BROWSER_PROTOCOL_FAILED','Invalid private CDP frame'));notify('Invalid private CDP frame');return}}
  })
  ;(child.stdio[4] as Readable).once('error',()=>{ended=true;rejectStartup(new NativeRenderError('BROWSER_PROTOCOL_FAILED','Browser pipe failed'));notify('Browser pipe failed')})
  browser=await Promise.race([chromium.connectOverCDP(transport,{timeout:15000}),startupFailure])
  browser.on('disconnected',()=>{void close().catch(()=>{})})
  if(!child.pid)throw new NativeRenderError('BROWSER_START_FAILED','未获得自有浏览器进程')
  return {browser,pid:child.pid,profileDirectory,close}
 }catch(error){await close();throw new NativeRenderError('BROWSER_START_FAILED',`${error instanceof Error?error.message:String(error)}${stderr?'；'+stderr:''}`)}
}
