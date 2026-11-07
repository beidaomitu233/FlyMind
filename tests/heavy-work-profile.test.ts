import {test} from 'node:test'
import assert from 'node:assert/strict'

// The production profile is captured once from the service environment.
process.env.FLYMIND_MEMORY_PROFILE='compact-1g'
const {resolveMemoryProfile,usesCompactFontSupply,HEAVY_MEMORY_PROFILE}=await import('../server/heavy-work/memory-profile')
const {HeavyWorkRunner}=await import('../server/heavy-work/runner')
const {NativeDrawioRenderer}=await import('../server/rendering/renderer')
const MiB=1024**2
const childURL=new URL('./fixtures/heavy-work-profile-child.mjs',import.meta.url)

test('default and unknown profiles retain the original limits; compact is explicit',()=>{
 for(const name of [undefined,'','typo','COMPACT-1G'])assert.deepEqual(resolveMemoryProfile(name),{browserAdmissionBytes:512*MiB,svgAdmissionBytes:512*MiB,svgRssBytes:384*MiB,svgHeapMiB:256,browserPressureBytes:128*MiB})
 assert.deepEqual(resolveMemoryProfile('compact-1g'),{browserAdmissionBytes:384*MiB,svgAdmissionBytes:384*MiB,svgRssBytes:256*MiB,svgHeapMiB:160,browserPressureBytes:64*MiB})
 // The 1.5 GiB host keeps compact fonts on the original admission/process budgets.
 assert.deepEqual(resolveMemoryProfile('compact-1_5g'),resolveMemoryProfile(undefined))
 assert.equal(usesCompactFontSupply('compact-1g'),true);assert.equal(usesCompactFontSupply('compact-1_5g'),true);assert.equal(usesCompactFontSupply(undefined),false)
 assert.deepEqual(HEAVY_MEMORY_PROFILE,resolveMemoryProfile('compact-1g'))
})

test('compact SVG rejects below 384 MiB and uses the 160 MiB child heap',async()=>{
 const low=new HeavyWorkRunner({childURL,availableMemory:async()=>384*MiB-1})
 try{await assert.rejects(low.run('svg-fonts',{svg:'x',fontFile:'x'}),{code:'HEAVY_WORK_MEMORY_LOW'})}finally{await low.close()}
 const allowed=new HeavyWorkRunner({childURL,availableMemory:async()=>384*MiB,rss:async()=>0})
 try{const result=await allowed.run<{args:string[]}>('svg-fonts',{svg:'x',fontFile:'x'});assert.ok(result.args.includes('--max-old-space-size=160'))}finally{await allowed.close()}
})

test('compact browser launch rejects below its admission before starting Chromium',async()=>{
 const renderer=new NativeDrawioRenderer() as any;renderer.sampleAdmissionMemory=async()=>384*MiB-1
 try{await assert.rejects(renderer.getBrowser(),{code:'RENDER_MEMORY_LOW'})}finally{await renderer.close()}
})

test('compact renderer pressure monitor accepts 64 MiB and cancels below it',async()=>{
 const renderer=new NativeDrawioRenderer() as any,job=new AbortController();let available=64*MiB,observed!:()=>void
 const firstSample=new Promise<void>(resolve=>{observed=resolve})
 renderer.samplePressureMemory=async()=>{observed();return available};renderer.jobs.add(job)
 try{
  renderer.updatePressureMonitor();await firstSample;await new Promise(resolve=>setImmediate(resolve));assert.equal(job.signal.aborted,false)
  const cancelled=new Promise<void>(resolve=>job.signal.addEventListener('abort',()=>resolve(),{once:true}));available=64*MiB-1
  let timeout:ReturnType<typeof setTimeout>|undefined
  try{await Promise.race([cancelled,new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(Error('pressure monitor did not cancel')),2000)})])}finally{clearTimeout(timeout)}
  assert.equal(job.signal.reason.code,'RENDER_MEMORY_PRESSURE')
 }finally{renderer.jobs.delete(job);await renderer.close()}
})

test('compact compile keeps its existing admission and heap',async()=>{
 const low=new HeavyWorkRunner({childURL,availableMemory:async()=>384*MiB-1})
 try{await assert.rejects(low.run('compile',{}),{code:'HEAVY_WORK_MEMORY_LOW'})}finally{await low.close()}
 const allowed=new HeavyWorkRunner({childURL,availableMemory:async()=>384*MiB,rss:async()=>0})
 try{const result=await allowed.run<{args:string[]}>('compile',{});assert.ok(result.args.includes('--max-old-space-size=256'))}finally{await allowed.close()}
})

test('compact SVG still terminates on RSS or 128 MiB pressure',async()=>{
 for(const [rss,pressure,code] of [[257*MiB,false,'HEAVY_WORK_MEMORY_LIMIT'],[0,true,'HEAVY_WORK_MEMORY_PRESSURE']] as const){
  let samples=0;const runner=new HeavyWorkRunner({childURL,rss:async()=>rss,availableMemory:async()=>++samples===1||!pressure?384*MiB:128*MiB-1})
  try{await assert.rejects(runner.run('svg-fonts',{svg:'x',fontFile:'x',spin:true}),{code})}finally{await runner.close()}
 }
})
