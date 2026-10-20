import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer,request,type Server} from 'node:http'
import {mkdtemp,rm,stat} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {CloudMaintenanceGate,closeHTTPGracefully} from '../server/cloud/maintenance'
import {acquireCloudApplicationLease} from '../server/cloud/application-lease'
import {createCloudMcpGateway} from '../server/cloud/mcp-gateway'
import {CloudOAuthMcpHost} from '../server/cloud/oauth-mcp'
import {validatePreparedRelease} from '../server/cloud/prepared-release'
import {cloudMcpHandshake} from '../server/cloud/mcp-compat'

const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve}}
async function listen(server:Server){await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+(server.address() as {port:number}).port}

test('prepared candidate binds release label, exact policy/supply digest and target runtime ABI',async()=>{
 const actual=(await cloudMcpHandshake()).release,candidate={prepared:true,releaseId:actual.releaseId,platform:process.platform,arch:process.arch,abi:process.versions.modules,release:actual}
 assert.equal(validatePreparedRelease(candidate,actual),actual)
 for(const bad of [{...candidate,prepared:false},{...candidate,abi:'wrong'},{...candidate,releaseId:'other'},{...candidate,release:{...actual,engineResourceKey:'a'.repeat(64)}},{...candidate,release:{...actual,policyBundleHash:'b'.repeat(64)}}])assert.throws(()=>validatePreparedRelease(bad,actual),{code:'CLOUD_BUNDLE_INVALID'})
})

test('maintenance waits actual delayed HTTP mutation and delivers its ACK; new writes get 503',async()=>{
 const gate=new CloudMaintenanceGate({ready:false}),entered=deferred(),finish=deferred();let mutations=0
 assert.throws(()=>gate.enter('POST'),{code:'CLOUD_UPDATING'});gate.markReady()
 const server=createServer(async(req,res)=>{let release:(()=>void)|undefined;try{release=gate.enter(req.method!);if(req.method==='POST'){entered.resolve();await finish.promise;mutations++}res.end(JSON.stringify({mutations}))}catch(e){res.writeHead(503,{'Retry-After':'2'});res.end(JSON.stringify({code:(e as any).code}))}finally{release?.()}})
 const base=await listen(server)
 try{
  const accepted=fetch(base,{method:'POST'});await entered.promise
  const draining=gate.drain({timeoutMs:1000});assert.equal(gate.snapshot().pendingWrites,1)
  const denied=await fetch(base,{method:'POST'});assert.equal(denied.status,503);assert.equal(denied.headers.get('retry-after'),'2');assert.equal((await denied.json() as any).code,'CLOUD_UPDATING')
  finish.resolve();await draining;assert.equal((await (await accepted).json() as any).mutations,1)
  assert.deepEqual(gate.snapshot(),{state:'updating',ready:false,pendingWrites:0})
 }finally{finish.resolve();await closeHTTPGracefully(server,{timeoutMs:2000})}
})

test('aborted socket does not release accepted write; drain timeout keeps same-root lease across ports',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flymind-cloud-drain-')),gate=new CloudMaintenanceGate(),entered=deferred(),finish=deferred(),settled=deferred()
 const lease=await acquireCloudApplicationLease({cloudDataRoot:root,port:19201})
 const server=createServer(async(_req,res)=>{const release=gate.enter('POST');entered.resolve();try{await finish.promise;res.end('committed')}finally{release();settled.resolve()}})
 const base=await listen(server);const req=request(base,{method:'POST'});req.on('error',()=>{});req.end()
 try{
  await entered.promise;req.destroy();await assert.rejects(gate.drain({timeoutMs:20}),{code:'CLOUD_DRAIN_TIMEOUT'})
  assert.equal(gate.snapshot().pendingWrites,1)
  await assert.rejects(acquireCloudApplicationLease({cloudDataRoot:root,port:19202}),{code:'CLOUD_WRITER_EXISTS'})
  finish.resolve();await settled.promise;await gate.drain({timeoutMs:1000});await closeHTTPGracefully(server,{timeoutMs:2000});await lease.release()
  const next=await acquireCloudApplicationLease({cloudDataRoot:root,port:19202});await next.release()
 }finally{finish.resolve();req.destroy();await closeHTTPGracefully(server,{timeoutMs:2000});await lease.release();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-cloud-drain-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
})

test('gateway quiesce tracks the awaited MCP operation, not socket close; maintenance rejects OAuth newcomers',async()=>{
 const entered=deferred(),finish=deferred(),original=CloudOAuthMcpHost.prototype.handle
 CloudOAuthMcpHost.prototype.handle=async(_req,res)=>{entered.resolve();await finish.promise;res.end('ACK')}
 const gateway=createCloudMcpGateway({publicOrigin:'http://localhost',applicationOrigin:'http://localhost',controlPlaneURL:'http://localhost:1',gatewayKey:'private-test-gateway-key-32bytes-0000',allowInsecureLoopback:true}),server=createServer(gateway.app),base=await listen(server)
 const req=request(base+'/mcp',{method:'POST',headers:{Host:'localhost',Origin:'http://localhost','Content-Type':'application/json'}});req.on('error',()=>{});req.end('{}')
 try{
  await entered.promise;req.destroy();await assert.rejects(gateway.quiesce({timeoutMs:20}),{code:'CLOUD_DRAIN_TIMEOUT'});assert.equal(gateway.maintenance.snapshot().pendingWrites,1)
  const response=await new Promise<{status:number;retry:string|undefined}>(yes=>{const r=request(base+'/authorize',{headers:{Host:'localhost'}},res=>{res.resume();res.on('end',()=>yes({status:res.statusCode!,retry:res.headers['retry-after']}))});r.end()});assert.deepEqual(response,{status:503,retry:'2'})
  finish.resolve();await gateway.quiesce({timeoutMs:1000});assert.equal(gateway.maintenance.snapshot().pendingWrites,0)
 }finally{finish.resolve();CloudOAuthMcpHost.prototype.handle=original;await gateway.close();await closeHTTPGracefully(server,{timeoutMs:2000})}
})

test('production entry prewarms fixed browser, rejects cross-port second writer, releases only on actual exit, and fails closed for missing assets',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flymind-cloud-start-'))
 const children:Array<ReturnType<typeof start>>=[]
 async function unusedPort(){const s=createServer();await listen(s);const port=(s.address() as {port:number}).port;await closeHTTPGracefully(s);return port}
 function start(port:number,extra:NodeJS.ProcessEnv={}){
  const child=spawn(process.execPath,['--import','tsx','server/cloud/start.ts'],{cwd:resolve('.'),windowsHide:true,shell:false,stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,FLYMIND_CLOUD_DATA_DIR:join(root,'data'),FLYMIND_CLOUD_PORT:String(port),FLYMIND_CLOUD_PUBLIC_ORIGIN:'http://127.0.0.1:'+port,FLYMIND_CLOUD_CONTROL_PLANE_URL:'http://127.0.0.1:1',FLYMIND_CLOUD_DEV_LOOPBACK:'1',FLYMIND_GATEWAY_KEY:'private-test-gateway-key-32bytes-0000',...extra}})
  let stderr='';child.stderr!.on('data',b=>stderr+=b.toString())
  const closed=new Promise<number|null>(r=>child.once('close',r))
  const ready=new Promise<any>((yes,no)=>{child.once('error',no);child.on('message',(m:any)=>{if(m.type==='flymind-cloud-ready'||m.type==='flymind-cloud-error')yes(m)});child.once('close',()=>no(Error('startup exited: '+stderr)))})
  // Observe immediately, including early startup failures.
  void ready.catch(()=>{})
  const result={child,ready,closed,stderr:()=>stderr};children.push(result);return result
 }
 async function bounded<T>(value:Promise<T>){let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([value,new Promise<never>((_,no)=>timer=setTimeout(()=>no(Error('entry lifecycle timeout')),20000))])}finally{clearTimeout(timer!)}}
 try{
  const first=start(await unusedPort());assert.equal((await bounded(first.ready)).type,'flymind-cloud-ready')
  const second=start(await unusedPort());assert.equal((await bounded(second.ready)).code,'CLOUD_WRITER_EXISTS');assert.equal(await bounded(second.closed),1)
  first.child.send({type:'flymind-cloud-shutdown'});assert.equal(await bounded(first.closed),0,first.stderr())
  const next=start(await unusedPort());assert.equal((await bounded(next.ready)).type,'flymind-cloud-ready');next.child.send({type:'flymind-cloud-shutdown'});assert.equal(await bounded(next.closed),0,next.stderr())
  const missingRoot=join(root,'must-not-create'),missing=start(await unusedPort(),{FLYMIND_CLOUD_DATA_DIR:missingRoot,FLYMIND_RESOURCES_DIR:join(root,'missing-assets')})
  assert.equal((await bounded(missing.ready)).code,'DRAWIO_MISSING');assert.equal(await bounded(missing.closed),1);await assert.rejects(stat(missingRoot),{code:'ENOENT'})
 }finally{
  for(const entry of children){if(entry.child.exitCode===null&&entry.child.connected)entry.child.send({type:'flymind-cloud-shutdown'});await bounded(entry.closed)}
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-cloud-start-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})
 }
})
