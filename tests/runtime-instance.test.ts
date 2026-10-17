import {pathToFileURL} from 'node:url'
import {spawn,type ChildProcess} from 'node:child_process'
import {DiagramStore} from '../server/store'
import {NativeDiagramService} from '../server/application/native-diagrams'
import {NativeExportService} from '../server/application/native-exports'
import {runtimeOrigin,runtimeAllowedOrigins} from '../server/runtime-instance/origin'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,readdir,rename} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {randomUUID} from 'node:crypto'
import {runtimeConfiguration,runtimeCapabilities,VERSION} from '../server/runtime-instance/config'
import {acquireRuntimeLease,readOwner,lockDirectory,wait,processAlive} from '../server/runtime-instance/lock'
import {challengeProof,validateRuntimeHealth} from '../server/runtime-instance/protocol'
import {ensureNativeRuntime} from '../server/runtime-instance/client'
import {NativeClient} from '../src/drawing/services/native-client'
import {createServer} from 'node:net'
import {prepareNativeRuntime} from '../server/runtime-instance/boot'
async function temporary(){const root=await mkdtemp(join(tmpdir(),'flymind-instance-unit-'));return {root,config:runtimeConfiguration({dataRoot:join(root,'data'),privateRuntimeRoot:join(root,'private'),port:0,env:{FLYMIND_NATIVE_PILOT:'1'}})}}
async function cleanup(root:string){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-instance-unit-'));await rm(root,{recursive:true,force:true})}
test('ensure rejects disabled pilot, missing/production data roots and invalid config without creating a database',async()=>{
 await assert.rejects(ensureNativeRuntime({env:{FLYMIND_NATIVE_PILOT:'0'}}),{code:'NATIVE_PILOT_DISABLED'});await assert.rejects(ensureNativeRuntime({env:{FLYMIND_NATIVE_PILOT:'1',FLYMIND_DATA_DIR:''}}),{code:'DATA_ROOT_REQUIRED'});await assert.rejects(ensureNativeRuntime({dataRoot:resolve('data'),env:{FLYMIND_NATIVE_PILOT:'1'}}),{code:'ISOLATED_ROOT_REQUIRED'});assert.throws(()=>runtimeConfiguration({dataRoot:tmpdir(),env:{FLYMIND_NATIVE_PILOT:'1'},port:99999}),{code:'INVALID_PORT'})
})
test('health exact capabilities, app/root/instance and HMAC are verified before any bearer',()=>{
 const expected={rootPathId:'a'.repeat(64),instanceId:randomUUID(),pid:process.pid,token:'private-not-logged',challenge:'b'.repeat(64)},health:any={name:'flymind',version:VERSION,storage:'sqlite',dataRootId:'c'.repeat(64),runtime:{application:'flymind',appVersion:VERSION,apiVersion:1,instanceId:expected.instanceId,rootPathId:expected.rootPathId,pid:process.pid},capabilities:runtimeCapabilities()};health.proof=challengeProof(expected.token,expected.challenge,health);assert.equal(validateRuntimeHealth(health,expected).dataRootId,health.dataRootId)
 for(const [changes,code] of [[{name:'other'},'FOREIGN_SERVICE'],[{version:'old'},'RUNTIME_VERSION_MISMATCH'],[{capabilities:{...health.capabilities,configureRendering:!health.capabilities.configureRendering}},'RUNTIME_VERSION_MISMATCH'],[{runtime:{...health.runtime,rootPathId:'wrong'}},'DATA_ROOT_MISMATCH'],[{runtime:{...health.runtime,instanceId:randomUUID()}},'INSTANCE_MISMATCH'],[{proof:'bad'},'RUNTIME_AUTHENTICATION_FAILED']] as const)assert.throws(()=>validateRuntimeHealth({...health,...changes},expected),{code})
})
test('live unknown owner and string PID are not stolen; closing a stale lease cannot remove a new owner',async()=>{
 const {root,config}=await temporary();try{const lease=await acquireRuntimeLease(config);assert.ok(lease);assert.equal(await acquireRuntimeLease(config),undefined);const path=join(lockDirectory(config),'owner.json'),original=await readFile(path,'utf8');await writeFile(path,JSON.stringify({...lease.owner,application:'unknown'}));await assert.rejects(acquireRuntimeLease(config),{code:'FOREIGN_LOCK_OWNER'});await writeFile(path,JSON.stringify({...lease.owner,pid:String(process.pid)}));await assert.rejects(acquireRuntimeLease(config),{code:'INVALID_LOCK_OWNER'});await writeFile(path,original);await lease.release();const next=await acquireRuntimeLease(config);assert.ok(next);await lease.release();assert.equal((await readOwner(config))?.instanceId,next.owner.instanceId);await next.release()}finally{await cleanup(root)}
})
test('crash between recovery mkdir and owner write, damaged guard and live guard are handled with grace and rechecks',async()=>{
 const all=await Promise.all([temporary(),temporary(),temporary()]);try{
  for(const [i,{config}] of all.entries()){const lease=await acquireRuntimeLease(config);assert.ok(lease);await lease.update({pid:2147483000});const guard=join(lockDirectory(config),'recovery');await mkdir(guard);if(i===1)await writeFile(join(guard,'owner.json'),'{broken');if(i===2)await writeFile(join(guard,'owner.json'),JSON.stringify({pid:process.pid,nonce:randomUUID()}))}
  await wait(5100)
  for(const [i,{config}] of all.entries()){await acquireRuntimeLease(config);if(i<2){await acquireRuntimeLease(config);const reclaimed=await acquireRuntimeLease(config);assert.ok(reclaimed);await reclaimed.release()}else{assert.equal(await acquireRuntimeLease(config),undefined);assert.ok(await stat(join(lockDirectory(config),'recovery')))}}
 }finally{for(const {root} of all)await cleanup(root)}
})
test('fast missing-entry exit and ENOENT spawn fail once without creating SQLite or leaking an active lock',async()=>{
 const {root,config}=await temporary();try{const missing=join(root,'missing-project');await mkdir(missing);for(const projectRoot of [missing,join(root,'nonexistent-cwd')]){await assert.rejects(ensureNativeRuntime({dataRoot:config.dataRoot,privateRuntimeRoot:config.privateRuntimeRoot,port:0,projectRoot,env:{FLYMIND_NATIVE_PILOT:'1'},timeoutMs:3000}),(e:any)=>['STARTUP_FAILED','SPAWN_FAILED'].includes(e.code));await assert.rejects(stat(join(config.dataRoot,'flymind.sqlite')),/ENOENT/)}assert.equal(await readOwner(config),undefined)}finally{await cleanup(root)}
})
test('controlled post-bind failure closes the owned socket and lease before any SQLite init',async()=>{
 const {root,config}=await temporary();let port=0
 try{await assert.rejects(prepareNativeRuntime({dataRoot:config.dataRoot,privateRuntimeRoot:config.privateRuntimeRoot,port:0,env:{FLYMIND_NATIVE_PILOT:'1'}},{afterBind:async server=>{port=(server.address() as any).port;const early=await fetch(runtimeOrigin(port)+'/studio-api/health',{signal:AbortSignal.timeout(1000)});assert.equal(early.status,503);assert.equal(early.headers.get('cache-control'),'no-store');assert.equal((await early.json()).code,'RUNTIME_STARTING');throw Error('controlled-after-bind')}}),/controlled-after-bind/);assert.equal(await readOwner(config),undefined);await assert.rejects(stat(join(config.dataRoot,'flymind.sqlite')),/ENOENT/);const listener=createServer();await new Promise<void>((yes,no)=>{listener.once('error',no);listener.listen(port,'127.0.0.1',yes)});await new Promise<void>(r=>listener.close(()=>r()))}finally{await cleanup(root)}
})
test('store init failure after owned bind closes the Runtime socket and lock',async()=>{
 const {root,config}=await temporary(),listener=createServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));const port=(listener.address() as any).port;await new Promise<void>(r=>listener.close(()=>r()))
 try{await mkdir(config.dataRoot,{recursive:true});await writeFile(join(config.dataRoot,'flymind.sqlite'),'isolated-corrupt-sqlite-fixture');await assert.rejects(ensureNativeRuntime({dataRoot:config.dataRoot,privateRuntimeRoot:config.privateRuntimeRoot,port,env:{FLYMIND_NATIVE_PILOT:'1'},timeoutMs:5000}),(e:any)=>{assert.ok(Number.isSafeInteger(e.failedChildPid));assert.equal(processAlive(e.failedChildPid),false);return ['SQLITE_NOTADB','STARTUP_FAILED'].includes(e.code)});assert.equal(await readOwner(config),undefined);const retry=createServer();await new Promise<void>((yes,no)=>{retry.once('error',no);retry.listen(port,'127.0.0.1',yes)});await new Promise<void>(r=>retry.close(()=>r()))}finally{await cleanup(root)}
})
test('occupied non-HTTP port fails explicitly before SQLite and releases only its own lease',async(t)=>{
 const {root,config}=await temporary(),listener=createServer(socket=>socket.destroy());await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));const port=(listener.address() as any).port
 try{let failure:any;try{await ensureNativeRuntime({dataRoot:config.dataRoot,privateRuntimeRoot:config.privateRuntimeRoot,port,env:{FLYMIND_NATIVE_PILOT:'1'},timeoutMs:5000})}catch(error){failure=error}
  // Only stderr startup errors are retained, never owner/credential JSON.
  const logs=await readdir(config.privateRuntimeRoot).catch(()=>[]),startupErrors=[];for(const file of logs.filter(file=>file.endsWith('.log'))){const text=await readFile(join(config.privateRuntimeRoot,file),'utf8');startupErrors.push(...text.split(/\r?\n/).filter(line=>/EPERM|EACCES|EADDRINUSE|PORT_OCCUPIED|rename|listen/i.test(line)).map(line=>line.replace(/\b[A-Za-z0-9_-]{43}\b/g,'[redacted]')))}
  const diagnostic={code:failure?.code,failedChildPid:failure?.failedChildPid,childAlive:failure?.failedChildPid?processAlive(failure.failedChildPid):undefined,startupErrors};const output=resolve('output/playwright/runtime-instance-d06');await mkdir(output,{recursive:true});await writeFile(join(output,'occupied-port.json'),JSON.stringify(diagnostic,null,2));t.diagnostic(JSON.stringify(diagnostic));assert.equal(failure?.code,'PORT_OCCUPIED');assert.ok(Number.isSafeInteger(failure.failedChildPid));assert.equal(processAlive(failure.failedChildPid),false);assert.equal(await readOwner(config),undefined);await assert.rejects(stat(join(config.dataRoot,'flymind.sqlite')),/ENOENT/);assert.ok(listener.listening)
 }finally{await new Promise<void>(r=>listener.close(()=>r()));await cleanup(root)}
})

test('Windows transient owner-file sharing cannot mask a real occupied port or leave the owned lease', {skip:process.platform!=='win32'},async(t)=>{
 const {root,config}=await temporary(),listener=createServer(socket=>socket.destroy());await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));const port=(listener.address() as any).port,lease=await acquireRuntimeLease(config);assert.ok(lease)
 const script=join(root,'hold-owner.ps1'),signal=join(root,'owner-held.txt');await writeFile(script,"$stream = [System.IO.File]::Open($env:FLYMIND_TEST_OWNER, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)\ntry { [System.IO.File]::WriteAllText($env:FLYMIND_TEST_SIGNAL, 'held'); [Console]::ReadLine() | Out-Null } finally { $stream.Dispose() }")
 const holder=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',script],{env:{...process.env,FLYMIND_TEST_OWNER:join(lockDirectory(config),'owner.json'),FLYMIND_TEST_SIGNAL:signal},stdio:['pipe','ignore','pipe'],windowsHide:true});let stderr='';holder.stderr!.on('data',b=>stderr+=b);const closed=new Promise<void>((yes,no)=>{holder.once('error',no);holder.once('close',()=>yes())});let releaseTimer:ReturnType<typeof setTimeout>|undefined
 try{
  const deadline=Date.now()+4000;while(Date.now()<deadline&&!await stat(signal).then(()=>true,()=>false)){if(holder.exitCode!==null)throw Error(stderr);await wait(10)}assert.ok(await stat(signal))
  let sharingFailure:any;try{await rename(lockDirectory(config),lockDirectory(config)+'.sharing-check')}catch(error){sharingFailure=error}assert.equal(sharingFailure?.code,'EPERM','the controlled Windows handle must deny directory rename');assert.equal(sharingFailure?.syscall,'rename')
  releaseTimer=setTimeout(()=>holder.stdin!.end(),200)
  let failure:any;try{await prepareNativeRuntime({dataRoot:config.dataRoot,privateRuntimeRoot:config.privateRuntimeRoot,port,env:{FLYMIND_NATIVE_PILOT:'1',FLYMIND_RUNTIME_CLAIM:lease.owner.nonce}})}catch(error){failure=error}
  const evidence={sharingCode:sharingFailure.code,sharingSyscall:sharingFailure.syscall,startupCode:failure?.code,startupSyscall:failure?.syscall};const output=resolve('output/playwright/runtime-instance-d06');await mkdir(output,{recursive:true});await writeFile(join(output,'controlled-sharing.json'),JSON.stringify(evidence,null,2));t.diagnostic(JSON.stringify(evidence));assert.equal(failure?.code,'PORT_OCCUPIED');await closed;assert.equal(processAlive(holder.pid),false);assert.equal(await readOwner(config),undefined);await assert.rejects(stat(join(config.dataRoot,'flymind.sqlite')),/ENOENT/);assert.ok(listener.listening)
 }finally{clearTimeout(releaseTimer);holder.stdin?.end();await closed;await lease.release();await new Promise<void>(r=>listener.close(()=>r()));await cleanup(root)}
})
test('browser NativeClient refuses root rebind and bootstraps cookie without exposing a bearer token',async()=>{
 const id='root-a',health:any={name:'flymind',version:VERSION,storage:'sqlite',dataRootId:id,runtime:{application:'flymind',appVersion:VERSION,apiVersion:1,instanceId:randomUUID(),rootPathId:'path'},capabilities:runtimeCapabilities()},requests:Array<{url:string;init:any}>=[]
 const client=new NativeClient('',{bootstrapSession:true,expectedDataRootId:id,fetch:(async(url,init)=>{requests.push({url:String(url),init});const value=String(url).endsWith('/health')?health:String(url).endsWith('/session')?{dataRootId:id,instanceId:health.runtime.instanceId}:[];return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}})}) as typeof fetch});await client.list();assert.equal(requests.filter(r=>r.url.endsWith('/session')).length,1);assert.equal(requests.at(-1)?.init.credentials,'same-origin');assert.ok(requests.every(r=>!r.init.headers?.Authorization));assert.equal(client.expectedDataRootId,id);health.dataRootId='different';await assert.rejects(client.health(),{code:'WORKSPACE_MISMATCH'});assert.equal(client.expectedDataRootId,id)
})

test('default HTTP port connection origin and runtime allowlist use the same URL normalization',()=>{
 for(const port of [80,5179,65535]){const base=runtimeOrigin(port),url=new URL('/studio-api/health',base);assert.equal(url.origin,base);assert.ok(runtimeAllowedOrigins(port).has(base));assert.ok(runtimeAllowedOrigins(port).has(runtimeOrigin(port,'localhost')))}
 assert.equal(runtimeOrigin(80),'http://127.0.0.1');assert.equal(runtimeOrigin(80,'localhost'),'http://localhost');assert.ok(!runtimeAllowedOrigins(80).has('https://evil.example'))
})

test('startup error IPC waits for owned child close and delayed stderr before returning failure',async()=>{
 const {root,config}=await temporary(),project=join(root,'controlled-project'),pidFile=join(root,'failed-pid.txt'),closedFile=join(root,'last-write.txt')
 try{
  await mkdir(join(project,'server'),{recursive:true})
  await writeFile(join(project,'server/start.mjs'),`import {writeFile} from 'node:fs/promises';await writeFile(process.env.FLYMIND_PROBE_PID,String(process.pid));process.send({type:'flymind-runtime-error',code:'CONTROLLED_FAILURE'});await new Promise(r=>setTimeout(r,350));console.error('controlled late stderr');await writeFile(process.env.FLYMIND_PROBE_LAST,'finished');process.exitCode=1;`)
  await assert.rejects(ensureNativeRuntime({dataRoot:config.dataRoot,privateRuntimeRoot:config.privateRuntimeRoot,port:0,projectRoot:project,env:{FLYMIND_NATIVE_PILOT:'1',FLYMIND_PROBE_PID:pidFile,FLYMIND_PROBE_LAST:closedFile},timeoutMs:3000}),(e:any)=>{assert.equal(e.code,'CONTROLLED_FAILURE');assert.equal(processAlive(e.failedChildPid),false);return true})
  const pid=Number(await readFile(pidFile,'utf8'));assert.ok(Number.isSafeInteger(pid));assert.equal(processAlive(pid),false);assert.equal(await readFile(closedFile,'utf8'),'finished');assert.equal(await readOwner(config),undefined)
 }finally{await cleanup(root)}
})

test('ready credential failure closes a prequeued export worker before direct Runtime exits',async(t)=>{
 const {root,config}=await temporary(),listener=createServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));const port=(listener.address() as any).port;await new Promise<void>(r=>listener.close(()=>r()))
 let child:ChildProcess|undefined,childClosed:Promise<void>|undefined;const browserFile=join(root,'browser-pids.txt'),observer=join(root,'observe-spawn.mjs'),privateFile=join(root,'private-is-a-file')
 try{
  const store=new DiagramStore(config.dataRoot);await store.init();const diagrams=new NativeDiagramService(store,true),exports=new NativeExportService(store,true)
  const content={schemaVersion:1,id:'startup-queued',title:'启动失败队列',kind:'swimlane',nodes:[{id:'a',kind:'start',label:'开始',laneId:'owner',phaseId:'work'},{id:'b',kind:'end',label:'完成',laneId:'owner',phaseId:'work'}],edges:[{id:'ab',source:'a',target:'b'}],lanes:[{id:'owner',label:'办理人员'}],phases:[{id:'work',label:'办理'}],groups:[]}
  await diagrams.create({content,requestId:'startup-create'});const job=await exports.create(content.id,{expectedRevision:1,requestId:'startup-export'},diagrams.dataRootId!)
  await writeFile(privateFile,'ordinary-file-causes-ready-mkdir-failure');await writeFile(browserFile,'')
  // Observe only child PIDs launched by this exact Runtime; no OS-wide process scan.
  await writeFile(observer,`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {appendFileSync} from 'node:fs';const original=cp.spawn;cp.spawn=function(...args){const child=original.apply(this,args);if(String(args[0]).includes('chrome-headless-shell')&&child.pid)appendFileSync(process.env.FLYMIND_BROWSER_PID_LOG,String(child.pid)+'\\n');return child};syncBuiltinESMExports();`)
  child=spawn(process.execPath,['--import',pathToFileURL(observer).href,'server/start.mjs','--runtime'],{cwd:resolve('.'),env:{...process.env,FLYMIND_NATIVE_PILOT:'1',FLYMIND_DATA_DIR:config.dataRoot,FLYMIND_PORT:String(port),FLYMIND_PRIVATE_RUNTIME_DIR:privateFile,FLYMIND_BROWSER_PID_LOG:browserFile},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true})
  childClosed=new Promise<void>((yes,no)=>{child!.once('error',no);child!.once('close',()=>yes())});let stdout='',stderr='',failureCode:string|undefined
  child.stdout!.on('data',b=>stdout+=b);child.stderr!.on('data',b=>stderr+=b);child.on('message',(message:any)=>{if(message?.type==='flymind-runtime-error')failureCode=message.code})
  let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([childClosed,new Promise<never>((_r,no)=>{timer=setTimeout(()=>no(Error('failed Runtime did not exit')),15000)})])}finally{clearTimeout(timer)}
  assert.equal(processAlive(child.pid),false);assert.equal(child.exitCode,1);assert.ok(['EEXIST','ENOTDIR'].includes(failureCode??''),stderr);assert.equal(stdout,'')
  const failed=(await store.getNativeExport(job.id)).job;assert.equal(failed.attempts,1);assert.equal(failed.status,'failed');assert.equal(failed.error?.code,'EXPORT_WORKER_STOPPED');assert.equal(failed.leaseOwner,undefined);assert.equal(failed.leaseUntil,undefined);await assert.rejects(store.assertNativeExportLease(job.id,'old-worker',failed.leaseToken??''),(error:any)=>error.code==='EXPORT_LEASE_LOST')
  const browserPids=(await readFile(browserFile,'utf8')).trim().split(/\s+/).filter(Boolean).map(Number);t.diagnostic(JSON.stringify({failedPid:child.pid,exitCode:child.exitCode,failureCode,jobStatus:failed.status,attempts:failed.attempts,errorCode:failed.error?.code,browserPids}));for(const pid of browserPids){assert.ok(Number.isSafeInteger(pid));assert.equal(processAlive(pid),false)}
  assert.equal(await readOwner(config),undefined);const rebound=createServer();await new Promise<void>((yes,no)=>{rebound.once('error',no);rebound.listen(port,'127.0.0.1',yes)});await new Promise<void>(r=>rebound.close(()=>r()))
 }finally{
  if(child&&processAlive(child.pid)){child.kill();await childClosed?.catch(()=>{})}
  const browserPids=(await readFile(browserFile,'utf8').catch(()=>'')).trim().split(/\s+/).filter(Boolean).map(Number);for(const pid of browserPids){if(processAlive(pid))process.kill(pid,'SIGKILL')}
  await cleanup(root)
 }
})
