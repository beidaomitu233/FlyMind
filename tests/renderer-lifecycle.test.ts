import {test} from 'node:test'
import assert from 'node:assert/strict'
import {NativeDrawioRenderer} from '../server/rendering/renderer'
import {sampleFor} from '../src/drawing/core/samples'
import {extractContent} from '../src/drawing/core/layers'
import {compileDrawio} from '../src/drawing/engine/drawio'
import {createDrawingProject} from '../src/drawing/engine/project'
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms))
function fake(close=async()=>{}){const r=new NativeDrawioRenderer({browserIdleMs:10}) as any;let closes=0;r.browser=Promise.resolve({close:async()=>{closes++;await close()}});return {r,closes:()=>closes}}
test('idle browser closes once; active render reservations postpone cleanup',async()=>{const {r,closes}=fake();const job=new AbortController();r.jobs.add(job);r.scheduleIdle();await wait(25);assert.equal(closes(),0);r.jobs.delete(job);r.scheduleIdle();await wait(25);assert.equal(closes(),1);assert.equal(r.browser,undefined);await r.close();assert.equal(closes(),1)})
test('new browser acquisition waits for an in-progress idle close and late close cannot clear replacement',async()=>{let release!:()=>void;const {r,closes}=fake(()=>new Promise<void>(yes=>release=yes));const old=r.browser;const closing=r.releaseBrowser();await Promise.resolve();const replacement=Promise.resolve({newBrowser:true});let reached=false;const original=r.getBrowser.bind(r);const acquiring=original().then((b:any)=>{reached=true;return b});await Promise.resolve();assert.equal(reached,false);r.getBrowser=()=>replacement;release();await closing;assert.equal(closes(),1);assert.notEqual(r.browser,old);assert.deepEqual(await acquiring,{newBrowser:true});await r.close()})
test('cleanup failure rejects subsequent acquisition instead of launching another browser',async()=>{const failure=Object.assign(Error('owned cleanup failed'),{code:'BROWSER_CLEANUP_FAILED'}),{r,closes}=fake(async()=>{throw failure});await assert.rejects(r.releaseBrowser(),failure);await assert.rejects(r.getBrowser(),failure);assert.equal(closes(),1);r.browser=undefined;r.browserCloseError=undefined;await r.close()})
test('cloud readiness can prove browser launch then release it; default retains warm capability until idle',async()=>{const {r,closes}=fake();r.start=async()=>'';await r.ready({keepBrowser:false});assert.equal(closes(),1);assert.equal(r.browser,undefined);await r.close();const warm=fake();warm.r.start=async()=>'';await warm.r.ready();assert.equal(warm.closes(),0);await warm.r.close();assert.equal(warm.closes(),1)})
test('close waits for a launch already in progress and closes the resolved owned browser',async()=>{const r=new NativeDrawioRenderer() as any;let resolve!:()=>void,closed=0;r.browser=new Promise<void>(yes=>resolve=yes);const closing=r.close();await Promise.resolve();r.ownedBrowser={close:async()=>{closed++}};resolve();await closing;assert.equal(closed,1);assert.equal(r.ownedBrowser,undefined)})
test('unexpected disconnect fences new acquisition until owned cleanup finishes; duplicate and stale events are harmless',async()=>{
 const r=new NativeDrawioRenderer() as any;let finish!:()=>void,started!:()=>void,closes=0
 const began=new Promise<void>(yes=>started=yes),old=Promise.resolve({})
 r.browser=old;r.ownedBrowser={close:async()=>{closes++;started();await new Promise<void>(yes=>finish=yes)}}
 r.browserDisconnected(old);r.browserDisconnected(old);await began;assert.ok(r.browserClosing);assert.equal(closes,1)
 let acquired=false;const waiting=r.getBrowser().then((b:any)=>{acquired=true;return b});await Promise.resolve();assert.equal(acquired,false)
 const replacement=Promise.resolve({replacement:true});r.getBrowser=()=>replacement;finish();await r.browserClosing
 assert.deepEqual(await waiting,{replacement:true});r.browser=replacement;r.browserDisconnected(old);assert.equal(r.browser,replacement);assert.equal(closes,1)
 r.browser=undefined;await r.close()
})
test('unexpected disconnect cleanup failure remains fail-closed for an unowned/Linux browser too',async()=>{const failure=Object.assign(Error('close failed'),{code:'BROWSER_CLEANUP_FAILED'}),{r,closes}=fake(async()=>{throw failure});r.browserDisconnected(r.browser);await assert.rejects(r.browserClosing,failure);await assert.rejects(r.getBrowser(),failure);assert.equal(closes(),1);r.browser=undefined;r.browserCloseError=undefined;await r.close()})

const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>resolve=yes);return {promise,resolve}}
async function project(math=false){const content=extractContent(sampleFor('flowchart')),compiled=await compileDrawio(content);if(math)compiled.xml=compiled.xml.replace('math="0"','math="1"');return createDrawingProject(content,compiled,{createdAt:1,updatedAt:1})}
function mockRenderer(browser:any){const r=new NativeDrawioRenderer({browserIdleMs:60000,contextCleanupMs:25,browserCleanupMs:60}) as any;r.start=async()=> 'http://127.0.0.1:12345';r.browser=Promise.resolve(browser);return r}
async function waitUntil(fn:()=>boolean){const end=Date.now()+3000;while(!fn()){if(Date.now()>end)throw Error('mock checkpoint not reached');await wait(5)}}

test('timed-out newContext fences acquisition, retires browser, and closes a late context',async()=>{
 const pending=deferred<any>(),closing=deferred<void>();let started=false,closes=0,lateCloses=0
 const browser={newContext:()=>{started=true;return pending.promise},close:async()=>{closes++;await closing.promise}},r=mockRenderer(browser),input=await project()
 const render=assert.rejects(r.render(input,{timeoutMs:600}),{code:'RENDER_TIMEOUT'});await waitUntil(()=>started);await waitUntil(()=>!!r.browserClosing)
 let acquired=false;const waiting=r.getBrowser().then(()=>{acquired=true});await wait(10);assert.equal(acquired,false)
 pending.resolve({close:async()=>{lateCloses++}});await waitUntil(()=>lateCloses===1);const replacement=Promise.resolve({replacement:true});r.getBrowser=()=>replacement;closing.resolve();await render;await waiting
 assert.equal(closes,1);await waitUntil(()=>r.jobs.size===0);await r.close()
})

test('stuck context close aborts concurrent render, and stuck browser close fails closed',async()=>{
 const started=[false,false];let i=0,closes=0
 const browser={newContext:async()=>{const n=i++;return {newPage:()=>{started[n]=true;return new Promise(()=>{})},close:()=>n===0?new Promise(()=>{}):Promise.resolve()}},close:()=>{closes++;return new Promise(()=>{})}}
 const r=mockRenderer(browser),input=await project(),a=new AbortController(),b=new AbortController();r.maxJobs=2 // Synthetic legacy shared-browser race.
 const one=assert.rejects(r.render(input,{signal:a.signal}),{code:'BROWSER_CLEANUP_FAILED'}),two=assert.rejects(r.render(input,{signal:b.signal}),{code:'BROWSER_CLEANUP_FAILED'})
 await waitUntil(()=>started.every(Boolean));a.abort();await one;await two;assert.equal(closes,1);assert.ok(r.jobs.size>=1);await assert.rejects(r.getBrowser(),{code:'BROWSER_CLEANUP_FAILED'})
 // Retain the failure fence in production; clear only the fake for test teardown.
 r.browser=undefined;r.browserCloseError=undefined;await r.close()
})

test('renderer passes actual XML to host URL for both ordinary and math documents',async()=>{
 for(const math of [false,true]){let url='';const stop=Error('captured host URL')
  const page={on:()=>{},exposeBinding:async()=>{},goto:async()=>{},locator:()=>({evaluate:async(_fn:unknown,value:string)=>{url=value;throw stop}})}
  const browser={newContext:async()=>({newPage:async()=>page,route:async()=>{},close:async()=>{}}),close:async()=>{}},r=mockRenderer(browser)
  await assert.rejects(r.render(await project(math)),stop);assert.equal(new URL(url).searchParams.get('math'),math?null:'0');await r.close()
 }
})
