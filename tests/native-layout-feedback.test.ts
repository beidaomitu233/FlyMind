import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

const source=await readFile(new URL('../src/drawing/ui/NativeStudio.vue',import.meta.url),'utf8')
const start=source.indexOf('async function configureLayout('),end=source.indexOf('\nasync function groupSelection(',start)
assert.ok(start>=0&&end>start)
const script=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const ref=(value:unknown)=>({value})
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve}}
function fixture(failure?:Error){
 const events:string[]=[],firstPaint=deferred(),lastPaint=deferred(),merge=deferred()
 const record={document:{content:{title:'same content'},rendering:{engine:{xml:'new XML'},preferences:{orientation:'horizontal'}}}}
 const session={diagramId:'diagram-a',flush:async()=>{events.push('flush')},snapshot:()=>({baseRevision:2}),adoptCommitted:async()=>{events.push('adopt')}}
 let paints=0
 const context:any={session,client:{configureRendering:async()=>{events.push('request');if(failure)throw failure;return record}},host:ref({mergeXML:async()=>{events.push('merge');await merge.promise}}),pendingContent:undefined,pendingRendering:undefined,ready:ref(true),busy:ref(false),layoutEnabled:ref(true),layoutLoading:ref(false),layoutLoadingLabel:ref(''),sessionKey:ref('root:session-a'),identitySuspended:ref(false),viewDisposed:false,timer:undefined,clearTimeout,saveTask:undefined,crypto:{randomUUID:()=> 'stable-request'},capture:async()=>{events.push('capture')},orientation:ref('vertical'),propertyContent:ref(undefined),message:ref(''),refreshList:async()=>{events.push('list')},fail:(e:Error)=>{events.push('error:'+e.message)},NativeApiError:class extends Error{},paintViewport:()=>{events.push('paint');return ++paints===1?firstPaint.promise:lastPaint.promise}}
 const configure=runInNewContext(script+'\nconfigureLayout',context) as (orientation?:string)=>Promise<void>
 return {context,events,firstPaint,lastPaint,merge,configure}
}
const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}

test('explicit layout paints feedback before capture and keeps it through load ACK and final paint',async()=>{
 const f=fixture(),task=f.configure('horizontal')
 assert.equal(f.context.layoutLoading.value,true);assert.match(f.context.layoutLoadingLabel.value,/横向/);assert.deepEqual(f.events,['paint'])
 // A second click during the pending operation performs no second request.
 await f.configure();assert.deepEqual(f.events,['paint'])
 f.firstPaint.resolve();await drain();assert.deepEqual(f.events,['paint','capture','flush','request','merge']);assert.equal(f.context.layoutLoading.value,true)
 f.merge.resolve();await drain();assert.ok(f.events.includes('adopt'));assert.equal(f.context.layoutLoading.value,true);assert.equal(f.context.pendingRendering.requestId,'stable-request')
 f.lastPaint.resolve();await task
 assert.equal(f.context.layoutLoading.value,false);assert.equal(f.context.busy.value,false);assert.equal(f.context.pendingRendering,undefined);assert.equal(f.context.orientation.value,'horizontal')
})

test('uncertain layout failure clears feedback and retries the original request without another save',async()=>{
 const f=fixture(new Error('network uncertain')),task=f.configure()
 f.firstPaint.resolve();await task
 assert.equal(f.context.layoutLoading.value,false);assert.equal(f.context.busy.value,false);assert.equal(f.context.pendingRendering.requestId,'stable-request')
 const before=f.events.filter(e=>e==='capture').length
 f.context.client.configureRendering=async()=>{throw new Error('still uncertain')}
 const retry=f.configure();f.lastPaint.resolve();await retry
 assert.equal(f.events.filter(e=>e==='capture').length,before);assert.equal(f.context.pendingRendering.requestId,'stable-request');assert.equal(f.context.layoutLoading.value,false)
})

test('leaving during the first paint cannot start a layout write',async()=>{
 const f=fixture(),task=f.configure();f.context.viewDisposed=true;f.firstPaint.resolve();await task
 assert.deepEqual(f.events,['paint']);assert.equal(f.context.layoutLoading.value,false);assert.equal(f.context.busy.value,false)
})
