import {test} from 'node:test'
import assert from 'node:assert/strict'
import {NativeDrawioRenderer} from '../server/rendering/renderer'
import {sampleFor} from '../src/drawing/core/samples'
import {extractContent} from '../src/drawing/core/layers'
import {compileDrawio} from '../src/drawing/engine/drawio'
import {createDrawingProject} from '../src/drawing/engine/project'
import {HeavyWorkRunner,SVG_HEAVY_WORK_ADMISSION_BYTES,runHeavyWork,readVerifiedSVG} from '../server/heavy-work/runner'
import {resolveRuntimeAssets} from '../server/rendering/assets'
import {RUNTIME_FONT_FILE} from '../src/drawing/engine/runtime-assets'
import {resolve} from 'node:path'

const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>resolve=yes);return {promise,resolve}}
async function until(fn:()=>boolean){const end=Date.now()+3000;while(!fn()){if(Date.now()>end)throw Error('mock checkpoint not reached');await wait(5)}}
async function project(){const content=extractContent(sampleFor('flowchart'));return createDrawingProject(content,await compileDrawio(content),{createdAt:1,updatedAt:1})}

function harness(xml:string,options:{close?:()=>Promise<void>;browserClose?:()=>Promise<void>;sample?:()=>Promise<number>;pressureSample?:()=>Promise<number>;closeError?:boolean;workerError?:boolean;external?:'before'|'during';svg?:string}={}){
 const events:string[]=[],origin='http://127.0.0.1:12345',main={},png=Buffer.alloc(24)
 Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(20,16);png.writeUInt32BE(12,20)
 let binding:any,pageError:(e:Error)=>void=()=>{},route:(v:any)=>unknown=()=>{},contextCloses=0,browserCloses=0,workers=0
 const outside=()=>route({request:()=>({url:()=> 'https://external.invalid/private'}),abort:()=>{},continue:()=>{}})
 const emit=(value:unknown)=>binding({frame:main},JSON.stringify(value),origin)
 const frame={url:()=>origin+'/drawio/index.html',evaluate:async()=>true}
 const page={mainFrame:()=>main,on:(_event:string,fn:(e:Error)=>void)=>{pageError=fn},exposeBinding:async(_name:string,fn:any)=>{binding=fn},goto:async()=>{if(options.external==='before')outside()},frames:()=>[frame],
  locator:()=>({evaluate:async()=>{emit({event:'configure'});emit({event:'init'});emit({event:'load',xml,modelBounds:{width:20,height:12}})}}),
  evaluate:async(_fn:unknown,{data}:{data:string})=>{const request=JSON.parse(data);if(request.action!=='export')return
   events.push(request.format);if(request.format==='xml')emit({event:'export',format:'xml',message:request,xml})
   else emit({event:'export',format:request.format,message:request,data:request.format==='png'?'data:image/png;base64,'+png.toString('base64'):(options.svg??'<svg width="20" height="12"/>')})
  }}
 const context={newPage:async()=>page,route:async(_pattern:string,handler:(v:any)=>unknown)=>{route=handler},close:async()=>{contextCloses++;events.push('close:start');if(options.closeError)pageError(Error('page error before close'));if(options.external==='during')outside();await options.close?.();events.push('close:end')}}
 const browser={newContext:async()=>context,close:async()=>{browserCloses++;events.push('browser:close');await options.browserClose?.()},version:()=> 'mock'}
 const renderer=new NativeDrawioRenderer({browserIdleMs:60000,contextCleanupMs:40,browserCleanupMs:80}) as any
 // Exercise legacy shared-browser retirement races with synthetic concurrency;
 // separate tests below verify the production default of one reservation.
 renderer.maxJobs=2
 renderer.start=async()=>origin;renderer.browser=Promise.resolve(browser)
 renderer.sampleAvailableMemory=options.sample??(async()=>SVG_HEAVY_WORK_ADMISSION_BYTES)
 renderer.samplePressureMemory=options.pressureSample??(async()=>1024**3)
 renderer.packageSVG=async(svg:string)=>{workers++;events.push('worker');if(options.workerError)pageError(Error('queued page error'));return {svg}}
 return {renderer,browser,context,events,get contextCloses(){return contextCloses},get browserCloses(){return browserCloses},get workers(){return workers}}
}

test('captures both formats and validates PNG before closing context and starting SVG worker',async()=>{
 const p=await project(),h=harness(p.rendering.engine.xml)
 try{const result=await h.renderer.render(p);assert.deepEqual(h.events,['xml','svg','png','close:start','close:end','worker']);assert.equal(h.contextCloses,1);assert.equal(h.browserCloses,0);assert.equal(result.nativeXML,p.rendering.engine.xml);assert.equal(result.width,20);assert.equal(result.height,12);assert.equal(result.nativeSVG,'<svg width="20" height="12"/>')}
 finally{await h.renderer.close()}
})

test('single renderer reservation survives cancellation until late SVG work actually settles',async()=>{
 const standard=new NativeDrawioRenderer() as any;assert.equal(standard.maxJobs,1);await standard.close()
 const p=await project(),h=harness(p.rendering.engine.xml),work=deferred<{svg:string}>(),abort=new AbortController();h.renderer.maxJobs=1
 let started=false;h.renderer.packageSVG=()=>{started=true;return work.promise}
 try{const first=h.renderer.renderTracked(p,{signal:abort.signal});await until(()=>started)
  await assert.rejects(h.renderer.render(p),{code:'RENDERER_BUSY'});abort.abort();await assert.rejects(first.result,{code:'ABORTED'})
  await assert.rejects(h.renderer.render(p),{code:'RENDERER_BUSY'});work.resolve({svg:'<svg/>'});await first.quiescence
  h.renderer.packageSVG=async(svg:string)=>({svg});const result=await h.renderer.render(p);assert.equal(result.width,20)
 }finally{work.resolve({svg:'<svg/>'});await h.renderer.close()}
})

test('single renderer reservation blocks until a late context closes',async()=>{
 const p=await project(),h=harness(p.rendering.engine.xml),late=deferred<any>(),abort=new AbortController();h.renderer.maxJobs=1;let started=false,closed=false
 h.browser.newContext=()=>{started=true;return late.promise}
 try{const first=h.renderer.renderTracked(p,{signal:abort.signal});await until(()=>started);abort.abort();await assert.rejects(first.result,{code:'ABORTED'})
  await assert.rejects(h.renderer.render(p),{code:'RENDERER_BUSY'});late.resolve({close:async()=>{closed=true}});await first.quiescence;assert.equal(closed,true);assert.equal(h.renderer.jobs.size,0)
 }finally{late.resolve({close:async()=>{}});await h.renderer.close()}
})

test('renderer transfers proof only from its actual fixed SVG child result',async()=>{
 const p=await project(),h=harness(p.rendering.engine.xml,{svg:'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="12"><text font-family="Arial">流程</text></svg>'})
 h.renderer.packageSVG=(svg:string,signal:AbortSignal)=>runHeavyWork('svg-fonts',{svg,fontFile:resolve(resolveRuntimeAssets().fontRoot,RUNTIME_FONT_FILE)},{signal})
 try{const result=await h.renderer.render(p);assert.equal(readVerifiedSVG(result),result.svg);result.svg='<svg/>';assert.equal(readVerifiedSVG(result),undefined)}finally{await h.renderer.close()}
})

test('only low memory after clean context close releases browser before worker',async()=>{
 const p=await project()
 for(const [available,closes] of [[SVG_HEAVY_WORK_ADMISSION_BYTES-1,1],[SVG_HEAVY_WORK_ADMISSION_BYTES,0],[SVG_HEAVY_WORK_ADMISSION_BYTES+1,0]] as const){
  const h=harness(p.rendering.engine.xml,{sample:async()=>available})
  try{await h.renderer.render(p);assert.equal(h.browserCloses,closes);assert.equal(h.workers,1)
   if(closes)assert.ok(h.events.indexOf('close:end')<h.events.indexOf('browser:close')&&h.events.indexOf('browser:close')<h.events.indexOf('worker'))
  }finally{await h.renderer.close()}
 }
})

test('sampling failure preserves worker admission and unclean context does not sample',async()=>{
 const p=await project(),failing=harness(p.rendering.engine.xml,{sample:async()=>{throw Error('sample failed')}})
 try{await failing.renderer.render(p);assert.equal(failing.browserCloses,0);assert.equal(failing.workers,1)}finally{await failing.renderer.close()}
 let samples=0;const unclean=harness(p.rendering.engine.xml,{close:()=>new Promise(()=>{}),sample:async()=>{samples++;return 0}})
 try{await unclean.renderer.render(p);assert.equal(unclean.browserCloses,1);assert.equal(samples,0);assert.equal(unclean.workers,1)}finally{await unclean.renderer.close()}
})

test('worker retains its independent admission if memory remains low after browser release',async()=>{
 const p=await project(),h=harness(p.rendering.engine.xml,{sample:async()=>0}),runner=new HeavyWorkRunner({availableMemory:async()=>0})
 h.renderer.packageSVG=(svg:string,signal:AbortSignal)=>runner.run('svg-fonts',{svg,fontFile:'unused'},{signal})
 try{await assert.rejects(h.renderer.render(p),{code:'HEAVY_WORK_MEMORY_LOW'});assert.equal(h.browserCloses,1)}finally{await runner.close();await h.renderer.close()}
})

test('another job joining while memory is sampled prevents proactive close',async()=>{
 const p=await project(),sample=deferred<number>(),h=harness(p.rendering.engine.xml,{sample:()=>sample.promise}),abort=new AbortController()
 let calls=0,otherStarted=false,otherClosed=0
 h.browser.newContext=async()=>++calls===1?h.context:{newPage:()=>{otherStarted=true;return new Promise(()=>{})},close:async()=>{otherClosed++}}
 try{const first=h.renderer.render(p);await until(()=>h.contextCloses===1);const second=assert.rejects(h.renderer.render(p,{signal:abort.signal}),{code:'ABORTED'})
  await until(()=>otherStarted);sample.resolve(0);await first;assert.equal(h.browserCloses,0);assert.equal(otherClosed,0)
  abort.abort();await second;assert.equal(otherClosed,1)
 }finally{await h.renderer.close()}
})

test('a job arriving during proactive browser close waits for the fence',async()=>{
 const p=await project(),closing=deferred<void>(),h=harness(p.rendering.engine.xml,{sample:async()=>0,browserClose:()=>closing.promise}),abort=new AbortController()
 h.renderer.browserCleanupMs=1000
 let entered=false,otherStarted=false,otherClosed=0,replacementCloses=0
 const replacement={newContext:async()=>({newPage:()=>{otherStarted=true;return new Promise(()=>{})},close:async()=>{otherClosed++}}),close:async()=>{replacementCloses++},version:()=> 'replacement'}
 try{const first=h.renderer.render(p);await until(()=>h.browserCloses===1);const original=h.renderer.getBrowser.bind(h.renderer)
  h.renderer.getBrowser=()=>{entered=true;return original()}
  const second=assert.rejects(h.renderer.render(p,{signal:abort.signal}),{code:'ABORTED'});await until(()=>entered);assert.equal(otherStarted,false)
  h.renderer.getBrowser=()=>{h.renderer.browser??=Promise.resolve(replacement);return h.renderer.browser}
  closing.resolve();await first;await until(()=>otherStarted);assert.equal(replacementCloses,0)
  abort.abort();await second;assert.equal(otherClosed,1)
 }finally{await h.renderer.close()}
})

test('pressure fence waits for SVG work to settle before allowing a replacement browser',async()=>{
 const p=await project(),work=deferred<{svg:string}>(),h=harness(p.rendering.engine.xml,{sample:async()=>0});let started=false
 h.renderer.packageSVG=()=>{started=true;return work.promise}
 try{const first=h.renderer.render(p);await until(()=>started);assert.ok(h.renderer.pressureGate);assert.equal(h.browserCloses,1)
  const replacement={close:async()=>{}};let acquired=false
  const waiting=h.renderer.getBrowser().then((browser:any)=>{acquired=true;return browser});h.renderer.browser=Promise.resolve(replacement)
  await wait(20);assert.equal(acquired,false);work.resolve({svg:'<svg width="20" height="12"/>'})
  await first;assert.equal(await waiting,replacement);assert.equal(h.renderer.pressureGate,undefined)
 }finally{await h.renderer.close()}
})

test('render cancellation keeps pressure fence until late work settles; canceled waiters never launch',async()=>{
 const p=await project(),work=deferred<{svg:string}>(),h=harness(p.rendering.engine.xml,{sample:async()=>0}),abort=new AbortController(),waitingAbort=new AbortController();let started=false
 h.renderer.packageSVG=()=>{started=true;return work.promise}
 try{const first=assert.rejects(h.renderer.render(p,{signal:abort.signal}),{code:'ABORTED'});await until(()=>started)
  const blocked=assert.rejects(h.renderer.getBrowser(waitingAbort.signal),{code:'ABORTED'});abort.abort();await first;assert.ok(h.renderer.pressureGate)
  waitingAbort.abort(Object.assign(Error('cancel waiting'),{code:'ABORTED'}));await blocked
  const replacement={close:async()=>{}};h.renderer.browser=Promise.resolve(replacement);let acquired=false
  const another=h.renderer.getBrowser().then((browser:any)=>{acquired=true;return browser});await wait(20);assert.equal(acquired,false)
  work.resolve({svg:'<svg width="20" height="12"/>'});assert.equal(await another,replacement);assert.equal(h.renderer.pressureGate,undefined)
 }finally{await h.renderer.close()}
})

test('timeout or renderer close never frees pressure fence ahead of late worker completion',async()=>{
 const p=await project()
 for(const action of ['timeout','close'] as const){const work=deferred<{svg:string}>(),h=harness(p.rendering.engine.xml,{sample:async()=>0});let started=false
  h.renderer.packageSVG=()=>{started=true;return work.promise}
  try{const first=assert.rejects(h.renderer.render(p,{timeoutMs:action==='timeout'?650:5000}),{code:action==='timeout'?'RENDER_TIMEOUT':'RENDERER_CLOSED'});await until(()=>started)
   const waiting=action==='close'?assert.rejects(h.renderer.getBrowser(),{code:'RENDERER_CLOSED'}):undefined
   if(action==='close')await h.renderer.close();await waiting;await first;assert.ok(h.renderer.pressureGate)
   if(action==='close')await assert.rejects(h.renderer.getBrowser(),{code:'RENDERER_CLOSED'})
   const gate=h.renderer.pressureGate.promise;work.resolve({svg:'<svg width="20" height="12"/>'});await gate;assert.equal(h.renderer.pressureGate,undefined)
  }finally{await h.renderer.close()}
 }
})

test('pressure fence survives renderer abort until actual heavy child close',async()=>{
 const p=await project(),h=harness(p.rendering.engine.xml,{sample:async()=>0}),runner=new HeavyWorkRunner({childURL:new URL('./fixtures/heavy-work-child.mjs',import.meta.url),availableMemory:async()=>2**30,rss:async()=>undefined}),abort=new AbortController()
 h.renderer.packageSVG=(_svg:string,signal:AbortSignal)=>runner.run('svg-fonts',{spin:true},{signal,timeoutMs:5000})
 try{const result=assert.rejects(h.renderer.render(p,{signal:abort.signal}),{code:'ABORTED'});await until(()=>!!(runner as any).active?.child)
  const child=(runner as any).active.child;let childClosed=false;child.once('close',()=>{childClosed=true})
  const gate=h.renderer.pressureGate.promise;let premature=false;void gate.then(()=>{if(!childClosed)premature=true})
  abort.abort();await result;await gate;assert.equal(childClosed,true);assert.equal(premature,false)
 }finally{await runner.close();await h.renderer.close()}
})

test('non-pressure path does not install a browser fence',async()=>{
 const p=await project(),work=deferred<{svg:string}>(),h=harness(p.rendering.engine.xml);let started=false
 h.renderer.packageSVG=()=>{started=true;return work.promise}
 try{const first=h.renderer.render(p);await until(()=>started);assert.equal(h.renderer.pressureGate,undefined);assert.equal(await h.renderer.getBrowser(),h.browser)
  work.resolve({svg:'<svg width="20" height="12"/>'});await first
 }finally{await h.renderer.close()}
})

test('tracked render returns cancellation promptly but waits for its non-pressure package work',async()=>{
 const p=await project(),h=harness(p.rendering.engine.xml),work=deferred<{svg:string}>(),abort=new AbortController();let started=false,settled=false
 h.renderer.packageSVG=()=>{started=true;return work.promise}
 try{const tracked=h.renderer.renderTracked(p,{signal:abort.signal});void tracked.quiescence.then(()=>{settled=true})
  await until(()=>started);abort.abort();await assert.rejects(tracked.result,{code:'ABORTED'});await wait(20);assert.equal(settled,false)
  work.resolve({svg:'<svg/>'});await tracked.quiescence;assert.equal(settled,true)
 }finally{work.resolve({svg:'<svg/>'});await h.renderer.close()}
})

test('tracked render quiescence waits for actual heavy child close after cancellation',async()=>{
 const p=await project(),h=harness(p.rendering.engine.xml),runner=new HeavyWorkRunner({childURL:new URL('./fixtures/heavy-work-child.mjs',import.meta.url),availableMemory:async()=>2**30,rss:async()=>undefined}),abort=new AbortController()
 h.renderer.packageSVG=(_svg:string,signal:AbortSignal)=>runner.run('svg-fonts',{spin:true},{signal,timeoutMs:5000})
 try{const tracked=h.renderer.renderTracked(p,{signal:abort.signal});await until(()=>!!(runner as any).active?.child)
  const child=(runner as any).active.child;let closed=false,premature=false;child.once('close',()=>{closed=true});void tracked.quiescence.then(()=>{if(!closed)premature=true})
  abort.abort();await assert.rejects(tracked.result,{code:'ABORTED'});await tracked.quiescence;assert.equal(closed,true);assert.equal(premature,false)
 }finally{await runner.close();await h.renderer.close()}
})

test('tracked cancellation waits for its pending browser launch without changing direct result',async()=>{
 const p=await project(),h=harness(p.rendering.engine.xml),launch=deferred<any>(),abort=new AbortController();let started=false,settled=false
 h.renderer.getBrowser=()=>{started=true;return launch.promise}
 try{const tracked=h.renderer.renderTracked(p,{signal:abort.signal});void tracked.quiescence.then(()=>{settled=true});await until(()=>started)
  abort.abort();await assert.rejects(tracked.result,{code:'ABORTED'});await wait(20);assert.equal(settled,false)
  launch.resolve(h.browser);await tracked.quiescence;assert.equal(settled,true)
 }finally{launch.resolve(h.browser);await h.renderer.close()}
})

test('tracked late context waits for its own close after browser retirement',async()=>{
 const p=await project(),h=harness(p.rendering.engine.xml),late=deferred<any>(),close=deferred<void>(),abort=new AbortController();let started=false,closing=false,settled=false
 h.browser.newContext=()=>{started=true;return late.promise}
 try{const tracked=h.renderer.renderTracked(p,{signal:abort.signal});void tracked.quiescence.then(()=>{settled=true});await until(()=>started)
  abort.abort();await assert.rejects(tracked.result,{code:'ABORTED'});assert.equal(h.browserCloses,1)
  late.resolve({close:async()=>{closing=true;await close.promise}});await until(()=>closing);await wait(10);assert.equal(settled,false)
  close.resolve();await tracked.quiescence;assert.equal(settled,true)
 }finally{late.resolve({close:async()=>{}});close.resolve();await h.renderer.close()}
})

test('tracked context and browser cleanup failure rejects quiescence',async()=>{
 const p=await project(),h=harness(p.rendering.engine.xml,{close:()=>new Promise(()=>{}),browserClose:async()=>{throw Error('browser close failed')}})
 try{const tracked=h.renderer.renderTracked(p);await assert.rejects(tracked.result);await assert.rejects(tracked.quiescence,/browser close failed/);await assert.rejects(h.renderer.render(p),{code:'BROWSER_CLEANUP_FAILED'})}
 finally{h.renderer.browser=undefined;h.renderer.browserCloseError=undefined;await h.renderer.close()}
})

test('cancel or close while sampling or proactively closing prevents worker',async()=>{
 const p=await project()
 for(const phase of ['sample','close'] as const)for(const action of ['cancel','close'] as const){
  const gate=deferred<any>(),h=harness(p.rendering.engine.xml,{sample:()=>phase==='sample'?gate.promise:Promise.resolve(0),browserClose:()=>phase==='close'?gate.promise:Promise.resolve()}),abort=new AbortController()
  h.renderer.browserCleanupMs=1000
  try{const result=assert.rejects(h.renderer.render(p,{signal:abort.signal}),{code:action==='cancel'?'ABORTED':'RENDERER_CLOSED'})
   await until(()=>phase==='sample'?h.contextCloses===1:h.browserCloses===1)
   const closing=action==='cancel'?(abort.abort(),undefined):h.renderer.close();gate.resolve(phase==='sample'?0:undefined);await result;await closing;assert.equal(h.workers,0)
  }finally{await h.renderer.close()}
 }
})

test('proactive browser close failure and timeout keep the fail-closed fence',async()=>{
 const p=await project()
 for(const failure of ['reject','timeout'] as const){const h=harness(p.rendering.engine.xml,{sample:async()=>0,browserClose:()=>failure==='reject'?Promise.reject(Error('close failed')):new Promise(()=>{})})
  try{await assert.rejects(h.renderer.render(p));assert.equal(h.workers,0);assert.equal(h.browserCloses,1);await assert.rejects(h.renderer.getBrowser())}
  finally{h.renderer.browser=undefined;h.renderer.browserCloseError=undefined;await h.renderer.close()}
 }
})

test('old generation replaced during memory sampling cannot close the new browser',async()=>{
 const p=await project(),sample=deferred<number>(),h=harness(p.rendering.engine.xml,{sample:()=>sample.promise});let replacementCloses=0
 try{const result=h.renderer.render(p);await until(()=>h.contextCloses===1);const old=h.renderer.browser;h.renderer.browserDisconnected(old);await h.renderer.browserClosing
  const replacement={close:async()=>{replacementCloses++}};h.renderer.browser=Promise.resolve(replacement);sample.resolve(0);await result
  assert.equal(replacementCloses,0);assert.equal(h.browserCloses,1);assert.equal(await h.renderer.browser,replacement)
 }finally{await h.renderer.close()}
})

test('cancellation while context closes never runs worker or closes twice',async()=>{
 const p=await project(),closing=deferred<void>(),h=harness(p.rendering.engine.xml,{close:()=>closing.promise}),abort=new AbortController()
 try{const result=assert.rejects(h.renderer.render(p,{signal:abort.signal}),{code:'ABORTED'});await until(()=>h.contextCloses===1);abort.abort();closing.resolve();await result;assert.equal(h.contextCloses,1);assert.equal(h.workers,0);assert.equal(h.browserCloses,0)}
 finally{await h.renderer.close()}
})

test('successful early close does not retire browser or another active context',async()=>{
 const p=await project(),h=harness(p.rendering.engine.xml),otherPage=deferred<any>(),abort=new AbortController();let calls=0,otherStarted=false,otherClosed=0
 h.browser.newContext=async()=>++calls===1?h.context:{newPage:()=>{otherStarted=true;return otherPage.promise},close:async()=>{otherClosed++}}
 try{const first=h.renderer.render(p),second=assert.rejects(h.renderer.render(p,{signal:abort.signal}),{code:'ABORTED'})
  await until(()=>otherStarted);await first;assert.equal(h.contextCloses,1);assert.equal(h.browserCloses,0);assert.equal(otherClosed,0)
  abort.abort();await second;assert.equal(otherClosed,1);assert.equal(h.browserCloses,0)
 }finally{await h.renderer.close()}
})

test('stuck early close retires shared browser and aborts concurrent context without starting worker',async()=>{
 const p=await project(),h=harness(p.rendering.engine.xml,{close:()=>new Promise(()=>{}),browserClose:()=>new Promise(()=>{})}),pending=deferred<any>()
 let calls=0,otherClosed=0;h.browser.newContext=async()=>++calls===1?h.context:pending.promise
 try{
  const first=assert.rejects(h.renderer.render(p),{code:'BROWSER_CLEANUP_FAILED'}),second=assert.rejects(h.renderer.render(p),{code:'BROWSER_CLEANUP_FAILED'})
  await until(()=>calls===2);pending.resolve({newPage:()=>new Promise(()=>{}),close:async()=>{otherClosed++}})
  await first;await second;assert.equal(h.contextCloses,1);assert.equal(h.browserCloses,1);assert.equal(otherClosed,1);assert.equal(h.workers,0)
  await assert.rejects(h.renderer.getBrowser(),{code:'BROWSER_CLEANUP_FAILED'})
 }finally{h.renderer.browser=undefined;h.renderer.browserCloseError=undefined;await h.renderer.close()}
})

test('successful browser retirement preserves finished images while aborting another job',async()=>{
 const p=await project(),closing=deferred<void>(),lateClose=deferred<void>(),h=harness(p.rendering.engine.xml,{close:()=>lateClose.promise,browserClose:()=>closing.promise})
 let calls=0,otherClosed=0,otherStarted=false
 h.browser.newContext=async()=>++calls===1?h.context:{newPage:()=>{otherStarted=true;return new Promise(()=>{})},close:async()=>{otherClosed++}}
 try{
  const first=h.renderer.render(p),second=assert.rejects(h.renderer.render(p),{code:'BROWSER_CLEANUP_FAILED'})
  await until(()=>otherStarted&&h.browserCloses===1);assert.ok(h.renderer.browserClosing);assert.equal(h.workers,0);await second;assert.equal(otherClosed,1)
  closing.resolve();const result=await first;assert.equal(result.width,20);assert.equal(h.workers,1);assert.equal(h.contextCloses,1);assert.equal(h.browserCloses,1)
  let replacementCloses=0;const replacement={close:async()=>{replacementCloses++}};h.renderer.browser=Promise.resolve(replacement)
  lateClose.resolve();await wait(10);assert.equal(await h.renderer.browser,replacement);assert.equal(replacementCloses,0)
 }finally{await h.renderer.close()}
})

test('existing browser retirement cannot exempt the current task',{timeout:15000},async()=>{
 const p=await project(),closing=deferred<void>(),aborted=deferred<void>();let h:ReturnType<typeof harness>,retirement:Promise<void>|undefined
 h=harness(p.rendering.engine.xml,{close:()=>{const job=[...h.renderer.jobs][0] as AbortController;job.signal.addEventListener('abort',()=>aborted.resolve(),{once:true});retirement=h.renderer.releaseBrowser();return new Promise(()=>{})},browserClose:()=>closing.promise})
 h.renderer.contextCleanupMs=250;h.renderer.browserCleanupMs=10000
 try{
  const result=assert.rejects(h.renderer.render(p),{code:'BROWSER_CLEANUP_FAILED'});await aborted.promise
  assert.ok(retirement);assert.equal(h.workers,0);closing.resolve();await retirement;await result;assert.equal(h.browserCloses,1)
 }finally{closing.resolve();await h.renderer.close()}
})

test('retirement fence exists before abort handlers can request another browser',async()=>{
 const p=await project(),closing=deferred<void>(),h=harness(p.rendering.engine.xml,{close:()=>new Promise(()=>{}),browserClose:()=>closing.promise})
 let calls=0,fenced=false,otherStarted=false
 h.browser.newContext=async()=>++calls===1?h.context:{newPage:()=>{otherStarted=true;return new Promise(()=>{})},close:async()=>{}}
 try{
  const first=h.renderer.render(p),second=assert.rejects(h.renderer.render(p),{code:'BROWSER_CLEANUP_FAILED'})
  await until(()=>otherStarted);const other=[...h.renderer.jobs][1] as AbortController
  other.signal.addEventListener('abort',()=>{fenced=!!h.renderer.browserClosing},{once:true})
  await until(()=>h.browserCloses===1);assert.equal(fenced,true);closing.resolve();await first;await second
 }finally{await h.renderer.close()}
})

test('external cancellation and renderer close during retirement prevent worker startup',async()=>{
 const p=await project()
 for(const action of ['cancel','close'] as const){const closing=deferred<void>(),h=harness(p.rendering.engine.xml,{close:()=>new Promise(()=>{}),browserClose:()=>closing.promise}),abort=new AbortController()
  try{const result=assert.rejects(h.renderer.render(p,{signal:abort.signal}),{code:action==='cancel'?'ABORTED':'RENDERER_CLOSED'})
   await until(()=>h.browserCloses===1);const close=action==='cancel'?(abort.abort(),undefined):h.renderer.close()
   closing.resolve();await result;await close;assert.equal(h.workers,0);assert.equal(h.browserCloses,1)
  }finally{await h.renderer.close()}
 }
})

test('deadline during browser retirement prevents worker startup after eventual close',async()=>{
 const p=await project(),closing=deferred<void>(),h=harness(p.rendering.engine.xml,{close:()=>new Promise(()=>{}),browserClose:()=>closing.promise})
 h.renderer.browserCleanupMs=2000
 try{const result=assert.rejects(h.renderer.render(p,{timeoutMs:650}),{code:'RENDER_TIMEOUT'})
  await until(()=>h.browserCloses===1);await until(()=>[...h.renderer.jobs].some((job:any)=>job.signal.aborted));closing.resolve();await result;assert.equal(h.workers,0)
 }finally{await h.renderer.close()}
})

test('unsafe resource discovered before successful forced retirement still prevents worker',async()=>{
 const p=await project(),h=harness(p.rendering.engine.xml,{close:()=>new Promise(()=>{}),external:'during'})
 try{await assert.rejects(h.renderer.render(p),{code:'UNRESOLVED_RESOURCE'});assert.equal(h.browserCloses,1);assert.equal(h.workers,0)}finally{await h.renderer.close()}
})

test('page errors during early close still reject the completed export',async()=>{
 const p=await project(),h=harness(p.rendering.engine.xml,{closeError:true})
 try{await assert.rejects(h.renderer.render(p),{code:'UNRESOLVED_RESOURCE'});assert.equal(h.contextCloses,1);assert.equal(h.workers,0)}finally{await h.renderer.close()}
})

test('queued page errors observed after worker still reject the completed export',async()=>{
 const p=await project(),h=harness(p.rendering.engine.xml,{workerError:true})
 try{await assert.rejects(h.renderer.render(p),{code:'UNRESOLVED_RESOURCE'});assert.equal(h.contextCloses,1);assert.equal(h.workers,1)}finally{await h.renderer.close()}
})

test('external requests observed before or during early close still reject',async()=>{
 const p=await project()
 for(const external of ['before','during'] as const){const h=harness(p.rendering.engine.xml,{external})
  try{await assert.rejects(h.renderer.render(p),{code:'UNRESOLVED_RESOURCE'});assert.equal(h.contextCloses,1);assert.equal(h.workers,0)}finally{await h.renderer.close()}
 }
})

test('late abandoned context failure cannot retire a replacement browser',async()=>{
 const p=await project(),h=harness(p.rendering.engine.xml),late=deferred<any>(),abort=new AbortController();let started=false,lateCloses=0,replacementCloses=0
 h.browser.newContext=()=>{started=true;return late.promise}
 try{
  const result=assert.rejects(h.renderer.render(p,{signal:abort.signal}),{code:'ABORTED'});await until(()=>started);abort.abort();await result;assert.equal(h.browserCloses,1)
  const replacement={close:async()=>{replacementCloses++}};h.renderer.browser=Promise.resolve(replacement)
  late.resolve({close:async()=>{lateCloses++;throw Error('late failure')}});await until(()=>lateCloses===1);await wait(10)
  assert.equal(replacementCloses,0);assert.equal(await h.renderer.browser,replacement)
 }finally{await h.renderer.close()}
})

test('active old context timeout cannot retire or abort a replacement browser job',async()=>{
 const p=await project(),h=harness(p.rendering.engine.xml,{close:()=>new Promise(()=>{})}),abort=new AbortController()
 h.renderer.contextCleanupMs=600
 let replacementCloses=0,replacementContextCloses=0,replacementStarted=false
 const replacement={newContext:async()=>({newPage:()=>{replacementStarted=true;return new Promise(()=>{})},close:async()=>{replacementContextCloses++}}),close:async()=>{replacementCloses++},version:()=> 'replacement'}
 try{
  const first=h.renderer.render(p);await until(()=>h.contextCloses===1)
  const old=h.renderer.browser;h.renderer.browserDisconnected(old);await h.renderer.browserClosing;assert.equal(h.browserCloses,1)
  h.renderer.browser=Promise.resolve(replacement)
  const second=assert.rejects(h.renderer.render(p,{signal:abort.signal}),{code:'ABORTED'})
  await until(()=>replacementStarted);await first
  assert.equal(replacementCloses,0);assert.equal(replacementContextCloses,0);assert.equal(h.workers,1);assert.equal(await h.renderer.browser,replacement)
  abort.abort();await second;assert.equal(replacementContextCloses,1);assert.equal(replacementCloses,0)
 }finally{await h.renderer.close()}
})

test('failed old browser cleanup stays fenced when its active context times out',async()=>{
 const p=await project(),h=harness(p.rendering.engine.xml,{close:()=>new Promise(()=>{}),browserClose:async()=>{throw Error('close failed')}})
 try{
  const result=assert.rejects(h.renderer.render(p));await until(()=>h.contextCloses===1)
  h.renderer.browserDisconnected(h.renderer.browser);await assert.rejects(h.renderer.browserClosing,/close failed/)
  await result;assert.equal(h.workers,0);assert.equal(h.browserCloses,1);await assert.rejects(h.renderer.getBrowser(),/close failed/)
 }finally{h.renderer.browser=undefined;h.renderer.browserCloseError=undefined;await h.renderer.close()}
})

test('runtime pressure fences a shared browser before aborting both active jobs',async()=>{
 const p=await project(),memory=deferred<number>(),closing=deferred<void>(),h=harness(p.rendering.engine.xml,{pressureSample:()=>memory.promise,browserClose:()=>closing.promise});let started=0,fenced=false
 h.browser.newContext=async()=>({newPage:()=>{started++;return new Promise(()=>{})},close:async()=>{}})
 try{const one=assert.rejects(h.renderer.render(p),{code:'RENDER_MEMORY_PRESSURE'}),two=assert.rejects(h.renderer.render(p),{code:'RENDER_MEMORY_PRESSURE'})
  await until(()=>started===2);for(const job of h.renderer.jobs as Set<AbortController>)job.signal.addEventListener('abort',()=>{fenced=!!h.renderer.browserClosing},{once:true})
  memory.resolve(128*1024*1024-1);await until(()=>h.browserCloses===1);assert.equal(fenced,true);assert.equal(h.workers,0)
  closing.resolve();await one;await two;assert.equal(h.browserCloses,1)
 }finally{await h.renderer.close()}
})

test('runtime pressure aborts a running SVG packaging job',async()=>{
 const p=await project(),memory=deferred<number>(),h=harness(p.rendering.engine.xml,{pressureSample:()=>memory.promise});let started=false,aborted=false
 h.renderer.packageSVG=(_svg:string,signal:AbortSignal)=>new Promise((_yes,no)=>{started=true;signal.addEventListener('abort',()=>{aborted=true;no(signal.reason)},{once:true})})
 try{const result=assert.rejects(h.renderer.render(p),{code:'RENDER_MEMORY_PRESSURE'});await until(()=>started);memory.resolve(1);await result;assert.equal(aborted,true);assert.equal(h.browserCloses,1)}finally{await h.renderer.close()}
})

test('runtime pressure keeps the browser fence until the packaging promise settles',async()=>{
 const p=await project(),memory=deferred<number>(),work=deferred<{svg:string}>(),h=harness(p.rendering.engine.xml,{pressureSample:()=>memory.promise});let started=false
 h.renderer.packageSVG=()=>{started=true;return work.promise}
 try{const result=assert.rejects(h.renderer.render(p),{code:'RENDER_MEMORY_PRESSURE'});await until(()=>started);memory.resolve(1);await result;await until(()=>h.browserCloses===1);assert.ok(h.renderer.pressureGate)
  const replacement={close:async()=>{}},waiting=h.renderer.getBrowser();h.renderer.browser=Promise.resolve(replacement);let acquired=false;void waiting.then(()=>{acquired=true})
  await wait(20);assert.equal(acquired,false);work.resolve({svg:'<svg width="20" height="12"/>'});assert.equal(await waiting,replacement);assert.equal(h.renderer.pressureGate,undefined)
 }finally{work.resolve({svg:'<svg/>'});await h.renderer.close()}
})

test('pressure sample failure and timeout fail closed',async()=>{
 const p=await project()
 for(const pressureSample of [async()=>{throw Error('sampling failed')},()=>new Promise<number>(()=>{})]){const h=harness(p.rendering.engine.xml,{pressureSample});h.browser.newContext=()=>new Promise(()=>{})
  try{await assert.rejects(h.renderer.render(p),{code:'RENDER_MEMORY_CHECK_FAILED'});assert.equal(h.browserCloses,1);assert.equal(h.workers,0)}finally{await h.renderer.close()}
 }
})

test('stale pressure sample cannot retire a replacement browser',async()=>{
 const r=new NativeDrawioRenderer({browserIdleMs:60000}) as any,old=Promise.resolve({close:async()=>{}}),sample=deferred<number>(),job=new AbortController();let calls=0,replacementCloses=0
 r.browser=old;r.jobs.add(job);r.samplePressureMemory=()=>++calls===1?sample.promise:Promise.resolve(1024**3);r.updatePressureMonitor()
 try{await until(()=>calls===1);const replacement=Promise.resolve({close:async()=>{replacementCloses++}});r.browser=replacement;sample.resolve(0);await wait(140)
  assert.equal(job.signal.aborted,false);assert.equal(replacementCloses,0);assert.equal(r.browser,replacement)
 }finally{r.jobs.delete(job);await r.close()}
})

test('ready startup without jobs detects pressure while a browser launch is pending',async()=>{
 const r=new NativeDrawioRenderer({browserIdleMs:60000,browserCleanupMs:1000}) as any,memory=deferred<number>(),launch=deferred<any>();let closes=0
 r.start=async()=>'';r.browser=launch.promise;r.samplePressureMemory=()=>memory.promise;r.updatePressureMonitor()
 try{const ready=assert.rejects(r.ready({keepBrowser:false}),{code:'RENDER_MEMORY_PRESSURE'});memory.resolve(1);await until(()=>!!r.browserClosing);launch.resolve({close:async()=>{closes++}});await ready;assert.equal(closes,1)}finally{await r.close()}
})

test('close invalidates an in-flight pressure sample and stops the timer',async()=>{
 const r=new NativeDrawioRenderer({browserIdleMs:60000}) as any,memory=deferred<number>();let calls=0,closes=0
 r.browser=Promise.resolve({close:async()=>{closes++}});r.samplePressureMemory=()=>{calls++;return memory.promise};r.updatePressureMonitor();await until(()=>calls===1)
 await r.close();assert.equal(closes,1);assert.equal(r.pressureMonitor,undefined);memory.resolve(0);await wait(120);assert.equal(calls,1);assert.equal(closes,1)
})

test('pressure cleanup failure blocks replacement browser',async()=>{
 const failure=Error('owned browser cleanup failed'),r=new NativeDrawioRenderer({browserIdleMs:60000,browserCleanupMs:100}) as any,job=new AbortController()
 r.browser=Promise.resolve({close:async()=>{throw failure}});r.jobs.add(job);r.samplePressureMemory=async()=>0;r.updatePressureMonitor()
 try{await until(()=>!!r.browserCloseError);assert.equal(job.signal.reason.code,'RENDER_MEMORY_PRESSURE');await assert.rejects(r.getBrowser(),failure)}finally{r.jobs.delete(job);r.browser=undefined;r.browserCloseError=undefined;await r.close()}
})
