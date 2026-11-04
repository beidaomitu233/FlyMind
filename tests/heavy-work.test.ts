import {test} from 'node:test'
import assert from 'node:assert/strict'
import {HeavyWorkRunner} from '../server/heavy-work/runner'
import {compileDrawio} from '../server/heavy-work/engine'
import {technicalReferenceContent} from '../src/drawing/core/technical-sample'
import {boundByNodeMemory,linuxHeavyMemory,reclaimableInactiveFile} from '../server/heavy-work/resources'
import {heavyFailure} from '../server/heavy-work/protocol'
const factory=()=>new HeavyWorkRunner({childURL:new URL('./fixtures/heavy-work-child.mjs',import.meta.url),availableMemory:async()=>2**30,rss:async()=>undefined})

test('isolated synchronous CPU work times out while the parent stays responsive and the slot recovers',async()=>{
 const runner=factory();let ticks=0;const heartbeat=setInterval(()=>ticks++,20)
 try{
  await assert.rejects(runner.run('compile',{spin:true},{timeoutMs:500}),(e:any)=>e.code==='HEAVY_WORK_TIMEOUT')
  assert.ok(ticks>=3,'parent event loop was not occupied by child computation')
  const next=await runner.run<{id:string;pid:number}>('compile',{id:'after-timeout'});assert.equal(next.id,'after-timeout');assert.notEqual(next.pid,process.pid)
 }finally{clearInterval(heartbeat);await runner.close()}
})

test('global slot is serial and pending admissions are bounded without replaying a task',async()=>{
 const runner=factory()
 try{
  const calls=Array.from({length:5},(_,i)=>runner.run<{id:number;pid:number}>('compile',{id:i,delay:60}))
  await assert.rejects(runner.run('compile',{id:5}),(e:any)=>e.code==='HEAVY_WORK_BUSY')
  const replies=await Promise.all(calls);assert.deepEqual(replies.map(r=>r.id),[0,1,2,3,4]);assert.equal(new Set(replies.map(r=>r.pid)).size,5)
 }finally{await runner.close()}
})

test('low available memory refuses before launch; excessive sampled child RSS is terminated',async()=>{
 const low=new HeavyWorkRunner({availableMemory:async()=>1}),high=new HeavyWorkRunner({childURL:new URL('./fixtures/heavy-work-child.mjs',import.meta.url),availableMemory:async()=>2**30,rss:async()=>1024**3})
 try{await assert.rejects(low.run('compile',{}),(e:any)=>e.code==='HEAVY_WORK_MEMORY_LOW');await assert.rejects(high.run('compile',{spin:true}),(e:any)=>e.code==='HEAVY_WORK_MEMORY_LIMIT')}
 finally{await low.close();await high.close()}
})

test('Linux admission uses reclaimable MemAvailable and the tightest service/ancestor cgroup',async()=>{
 const files:Record<string,string>={'/proc/meminfo':'MemFree: 1 kB\nMemAvailable: 2097152 kB\n','/proc/self/cgroup':'0::/system.slice/flymind.service\n','/sys/fs/cgroup/memory.max':'max','/sys/fs/cgroup/memory.current':'1','/sys/fs/cgroup/system.slice/memory.max':'1073741824','/sys/fs/cgroup/system.slice/memory.current':'536870912','/sys/fs/cgroup/system.slice/flymind.service/memory.max':'1073741824','/sys/fs/cgroup/system.slice/flymind.service/memory.current':'268435456'}
 const read=async(path:string)=>{if(!(path in files))throw Error('absent');return files[path]}
 assert.equal(await linuxHeavyMemory(1024,read),512*1024**2)
 files['/proc/self/cgroup']='0::/\n';assert.equal(await linuxHeavyMemory(1024,read),2*1024**3)
 files['/proc/self/cgroup']='5:cpu,memory:/docker/test\n';files['/sys/fs/cgroup/memory/docker/memory.limit_in_bytes']='536870912';files['/sys/fs/cgroup/memory/docker/memory.usage_in_bytes']='268435456'
 assert.equal(await linuxHeavyMemory(1024,read),256*1024**2)
})

test('only proven clean inactive file pages are credited, with strict conservative fallback',()=>{
 const stat='inactive_file 1000\nfile_dirty 100\nfile_writeback 50\nshmem 200\n'
 assert.equal(reclaimableInactiveFile(stat,2000),650)
 assert.equal(reclaimableInactiveFile(stat,300),300)
 assert.equal(reclaimableInactiveFile('inactive_file 100\nfile_dirty 70\nfile_writeback 20\nshmem 11\n',1000),0)
 for(const invalid of [stat.replace('shmem 200\n',''),stat+'shmem 1\n',stat.replace('file_dirty 100','file_dirty -1'),stat.replace('file_dirty 100','file_dirty 9007199254740992')])assert.equal(reclaimableInactiveFile(invalid,2000),0)
 assert.equal(reclaimableInactiveFile(stat,-1),0)
})

test('clean file credit is computed separately for each cgroup and remains bounded by host and Node',async()=>{
 const M=1024**2,files:Record<string,string>={
  '/proc/meminfo':`MemAvailable: ${900*1024} kB\n`, '/proc/self/cgroup':'0::/flymind.slice/app.service\n',
  '/sys/fs/cgroup/memory.max':'max','/sys/fs/cgroup/memory.current':'0',
  '/sys/fs/cgroup/flymind.slice/memory.max':String(1024*M),'/sys/fs/cgroup/flymind.slice/memory.current':String(700*M),
  '/sys/fs/cgroup/flymind.slice/memory.stat':`inactive_file ${200*M}\nfile_dirty ${10*M}\nfile_writeback ${5*M}\nshmem ${15*M}\n`,
  '/sys/fs/cgroup/flymind.slice/app.service/memory.max':String(700*M),'/sys/fs/cgroup/flymind.slice/app.service/memory.current':String(300*M),
  '/sys/fs/cgroup/flymind.slice/app.service/memory.stat':`inactive_file ${100*M}\nfile_dirty 0\nfile_writeback 0\nshmem 0\n`,
 }
 const read=async(path:string)=>{if(!(path in files))throw Error('absent');return files[path]}
 const available=await linuxHeavyMemory(100*M,read)
 assert.equal(available,494*M) // parent 324+170, child 400+100
 assert.equal(boundByNodeMemory(available,300*M),300*M)
 assert.equal(boundByNodeMemory(available,800*M),available)
 assert.equal(boundByNodeMemory(available,undefined),available)
 delete files['/sys/fs/cgroup/flymind.slice/memory.stat'];assert.equal(await linuxHeavyMemory(100*M,read),324*M)
 files['/sys/fs/cgroup/flymind.slice/memory.stat']='inactive_file 100\n';assert.equal(await linuxHeavyMemory(100*M,read),324*M)
 files['/proc/meminfo']=`MemAvailable: ${200*1024} kB\n`;assert.equal(await linuxHeavyMemory(100*M,read),200*M)
 files['/proc/meminfo']=`MemAvailable: ${900*1024} kB\n`
 files['/sys/fs/cgroup/flymind.slice/memory.current']=String(1100*M)
 files['/sys/fs/cgroup/flymind.slice/memory.stat']=`inactive_file ${500*M}\nfile_dirty 0\nfile_writeback 0\nshmem 0\n`
 assert.equal(await linuxHeavyMemory(100*M,read),0) // Never credit an already over-limit group.
 files['/proc/self/cgroup']='broken';files['/sys/fs/cgroup/memory.max']=String(1024*M);files['/sys/fs/cgroup/memory.current']=String(700*M)
 files['/sys/fs/cgroup/memory.stat']=`inactive_file ${500*M}\nfile_dirty 0\nfile_writeback 0\nshmem 0\n`
 assert.equal(await linuxHeavyMemory(100*M,read),324*M) // Unknown membership never gains credit.
})

test('memory pressure after admission terminates the active child and the slot can recover',async()=>{
 let readings=0,pressured=true
 const runner=new HeavyWorkRunner({childURL:new URL('./fixtures/heavy-work-child.mjs',import.meta.url),availableMemory:async()=>++readings===1||!pressured?2**30:64*1024**2,rss:async()=>undefined})
 try{
  await assert.rejects(runner.run('compile',{spin:true}),(e:any)=>e.code==='HEAVY_WORK_MEMORY_PRESSURE')
  assert.ok(readings>=2,'admission succeeded before live pressure was detected')
  pressured=false;const next=await runner.run<{id:string}>('compile',{id:'memory-recovered'});assert.equal(next.id,'memory-recovered')
 }finally{await runner.close()}
})

test('timeout and close settle during memory admission; a late check cannot spawn or clear a newer slot',async()=>{
 let release!:(n:number)=>void,calls=0
 const runner=new HeavyWorkRunner({childURL:new URL('./fixtures/heavy-work-child.mjs',import.meta.url),availableMemory:()=>++calls===1?new Promise<number>(r=>{release=r}):Promise.resolve(2**30),rss:async()=>undefined})
 await assert.rejects(runner.run('compile',{}, {timeoutMs:30}),(e:any)=>e.code==='HEAVY_WORK_TIMEOUT')
 const next=runner.run<{id:string}>('compile',{id:'newer',delay:60});release(2**30);assert.equal((await next).id,'newer');await runner.close()
 let admit!:(n:number)=>void
 const closing=new HeavyWorkRunner({availableMemory:()=>new Promise<number>(r=>{admit=r})}),pending=closing.run('compile',{})
 const rejected=assert.rejects(pending,(e:any)=>e.code==='HEAVY_WORK_CLOSED');await closing.close();await rejected;admit(2**30)
 await assert.rejects(closing.run('compile',{}),(e:any)=>e.code==='HEAVY_WORK_CLOSED')
})

test('cancelled queued/active calls and close are explicit failures; engine failures retain their code',async()=>{
 const runner=factory(),controller=new AbortController(),queued=new AbortController()
 const a=runner.run('compile',{spin:true},{signal:controller.signal}),b=runner.run('compile',{}, {signal:queued.signal})
 const deniedA=assert.rejects(a,(e:any)=>e.code==='HEAVY_WORK_ABORTED'),deniedB=assert.rejects(b,(e:any)=>e.code==='HEAVY_WORK_ABORTED')
 queued.abort();controller.abort();await Promise.all([deniedA,deniedB])
 await assert.rejects(runner.run('compile',{error:true}),(e:any)=>e.code==='ROUTING_NO_SPACE'&&e.message==='没有合法通道')
 await runner.close();await assert.rejects(runner.run('compile',{}),(e:any)=>e.code==='HEAVY_WORK_CLOSED')
})

test('real isolated technical compilation preserves the complete 24-node content',async()=>{
 const content=technicalReferenceContent('u39-heavy-technical'),engine=await compileDrawio(content)
 assert.ok(engine.xml.includes('fmDocumentId="u39-heavy-technical"'));assert.equal(content.nodes.length,24)
 const {projectDrawio}=await import('../src/drawing/engine/drawio');const projection=await projectDrawio(engine.xml,content)
 assert.equal(projection.contentHash,engine.contentHash);assert.deepEqual(projection.content,content)
 const {createDrawingProject}=await import('../src/drawing/engine/project'),{normalizeDrawioEdits,patchDrawio}=await import('../server/heavy-work/engine'),project=await createDrawingProject(content,engine)
 const normalized=await normalizeDrawioEdits(engine.xml,project);assert.equal(normalized.contentHash,engine.contentHash)
 const changed=await patchDrawio(project,[{op:'update_node',id:content.nodes[0].id,changes:{label:'终端核验'}}]);assert.ok(changed.xml.includes('终端核验'))
})

test('unknown filesystem and runtime exceptions do not relay private diagnostics',()=>{
 for(const error of [Object.assign(Error('ENOENT: /private/secret'),{code:'ENOENT'}),Object.assign(Error('secret-token'),{code:'ERR_MODULE_NOT_FOUND'}),Error('private stack')]){
  const result=heavyFailure(error);assert.equal(result.ok,false);assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes('/private'))
 }
 assert.deepEqual(heavyFailure(Error('ROUTING_NO_SPACE: 没有合法通道')),{ok:false,error:{code:'ROUTING_NO_SPACE',message:'ROUTING_NO_SPACE: 没有合法通道'}})
})
