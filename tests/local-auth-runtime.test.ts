import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import childProcess,{spawn,type ChildProcess} from 'node:child_process'
import {syncBuiltinESMExports} from 'node:module'
import {EventEmitter} from 'node:events'
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises'
import {join,resolve,sep} from 'node:path'
import {tmpdir} from 'node:os'
import {localRuntimeAuthorization} from '../server/local-auth/runtime'
import {assertRuntimeCapabilities} from '../server/runtime-instance/protocol'
import {PrivateLocalAuthStore} from '../server/local-auth/store'
import {LocalAuthorizationGate} from '../server/local-auth/gate'

async function expectHTTP(response:Response,status:number,stage:string,code?:string){
 // Keep failures actionable without printing response text, credentials or private paths.
 let actualCode='unclassified';try{const body=await response.json();if(typeof body.code==='string'&&/^[A-Z][A-Z0-9_]{0,80}$/.test(body.code))actualCode=body.code}catch{}
 assert.equal(response.status,status,`${stage}: ${actualCode}`)
 if(code)assert.equal(actualCode,code,stage)
}

test('shipped Runtime configuration has no auth opt-out',()=>{
 for(const env of [{},{FLYMIND_LOCAL_AUTH:'0'},{FLYMIND_CONTROL_PLANE_ORIGIN:'http://public.example'}])assert.throws(()=>localRuntimeAuthorization(env),{code:'LOCAL_AUTH_CONFIGURATION_REQUIRED'})
})

test('Windows ACL timeout fails closed; only a later request retries full initialization',async t=>{
 if(process.platform!=='win32')return // The real ACL subprocess exists only on Windows.
 const root=await mkdtemp(join(tmpdir(),'flymind-local-runtime-acl-'));let attempts=0,providerCalls=0
 t.mock.method(childProcess,'spawn',(_command:unknown,_args:unknown,options:any)=>{
  assert.equal(options.timeout,30000);assert.equal(options.windowsHide,true);assert.equal(options.shell,false)
  const fake=new EventEmitter();attempts++;queueMicrotask(()=>fake.emit('close',attempts===1?null:0,attempts===1?'SIGTERM':null));return fake
 });syncBuiltinESMExports()
 try{
  const store=new PrivateLocalAuthStore(join(root,'private')),gate=new LocalAuthorizationGate({controlPlaneOrigin:'https://identity.example',dataRootId:'r1',store,fetch:async()=>{providerCalls++;throw Error('must not contact authority without credentials')}})
  await assert.rejects(gate.authorize(),(error:any)=>error.status===503&&error.code==='LOCAL_AUTH_STORE_TIMEOUT')
  await assert.rejects(stat(join(root,'private','state.json')),{code:'ENOENT'});assert.equal(attempts,1);assert.equal(providerCalls,0)
  await assert.rejects(gate.authorize(),(error:any)=>error.status===401&&error.code==='LOCAL_LOGIN_REQUIRED')
  assert.equal(attempts,2);assert.equal(providerCalls,0)
  await assert.rejects(gate.authorize(),(error:any)=>error.status===401);assert.equal(attempts,2)
 }finally{t.mock.restoreAll();syncBuiltinESMExports();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-local-runtime-acl-'));await rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:100})}
})
test('real temporary Runtime gates browser cookie and private MCP bearer, revocation denies without changing data',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flymind-local-runtime-')),authority=express();let active=true,available=true;let introspections=0;const appToken='a'.repeat(43),grant='fm_local_'+'g'.repeat(43)
 authority.use(express.json());authority.post('/app/flymind/auth/login',(_q,r)=>r.json({code:200,data:{sessionToken:appToken,expiresAt:Date.now()+60000,user:{id:'u1',name:'Test'}}}));authority.get('/app/flymind/auth/me',(_q,r)=>r.json({code:200,data:{expiresAt:Date.now()+60000,user:{id:'u1',name:'Test'},teams:[{id:'t1',name:'Team',role:'editor'}]}}));authority.post('/app/flymind/local/grants',(_q,r)=>r.json({code:200,data:{grantToken:grant,expiresAt:Date.now()+60000}}));authority.post('/app/flymind/local/introspect',(q,r)=>{introspections++;return !available?r.status(503).json({code:503}):active?r.json({code:200,data:{user:{id:'u1',name:'Test'},session:{id:'s1',expiresAt:Date.now()+60000},team:{id:'t1',name:'Team',role:'editor'},binding:q.body}}):r.status(401).json({code:401})});authority.post('/app/flymind/local/revoke',(_q,r)=>{active=false;r.json({code:200,data:{revoked:true}})})
 const provider=authority.listen(0,'127.0.0.1');await new Promise<void>(r=>provider.once('listening',r));const providerAddress=provider.address();if(!providerAddress||typeof providerAddress==='string')throw Error('provider')
 let child:ChildProcess|undefined,stderr='',exited:Promise<number|null>|undefined
 try{
  const env={...process.env,FLYMIND_CONTROL_PLANE_ORIGIN:'http://127.0.0.1:'+providerAddress.port,FLYMIND_NATIVE_PILOT:'1',FLYMIND_DATA_DIR:join(root,'data'),FLYMIND_PRIVATE_RUNTIME_DIR:join(root,'private'),FLYMIND_PORT:'0'}
  child=spawn(process.execPath,['--import','tsx','server/runtime.ts'],{cwd:resolve('.'),env,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});child.stderr!.on('data',b=>{stderr+=String(b)});exited=new Promise(r=>child!.once('exit',r))
  const health:any=await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error('Runtime readiness timeout: '+stderr)),20000);child!.once('error',no);child!.once('exit',code=>{clearTimeout(timer);no(Error('Runtime exited '+code+': '+stderr))});child!.on('message',(m:any)=>{if(m.type==='flymind-runtime-ready'){clearTimeout(timer);yes(m.health)}})})
  assert.equal(health.capabilities.localAuthorization,true)
  const {localAuthorization:_,...oldCapabilities}=health.capabilities
  assert.throws(()=>assertRuntimeCapabilities({...health,capabilities:oldCapabilities}),{code:'RUNTIME_VERSION_MISMATCH'})
  const credentialFile=(await readdir(join(root,'private'))).find(f=>f.endsWith('.json'));assert.ok(credentialFile)
  const credential=JSON.parse(await readFile(join(root,'private',credentialFile),'utf8')),base='http://127.0.0.1:'+credential.port
  const bearer={Authorization:'Bearer '+credential.sessionToken,'X-FlyMind-DataRoot-Id':credential.dataRootId}
  assert.equal((await fetch(base+'/studio-api/local-auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:'x'.repeat(3000)})})).status,413)
  await expectHTTP(await fetch(base+'/studio-api/native/workspace',{headers:bearer}),401,'fresh private store, no credential','LOCAL_LOGIN_REQUIRED');assert.equal(introspections,0)
  const session=await fetch(base+'/studio-api/session',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'});assert.equal(session.status,200);const cookie=session.headers.get('set-cookie')!.split(';')[0]
  assert.equal((await fetch(base+'/studio-api/native/workspace',{headers:{Cookie:cookie}})).status,401)
  const before=await stat(join(root,'data','flymind.sqlite'))
  const login=await fetch(base+'/studio-api/local-auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({phone:'13800000001',password:'test-password',teamId:'t1'})});assert.equal(login.status,200);assert.ok(!(await login.text()).includes(grant))
  assert.equal((await fetch(base+'/studio-api/native/workspace',{headers:bearer})).status,200)
  assert.equal((await fetch(base+'/studio-api/native/workspace',{headers:{Cookie:cookie}})).status,200)
  available=false
  await expectHTTP(await fetch(base+'/studio-api/native/workspace',{headers:bearer}),503,'authority unavailable','LOCAL_AUTH_UNAVAILABLE')
  available=true
  await expectHTTP(await fetch(base+'/studio-api/native/workspace',{headers:bearer}),200,'authority recovered')
  active=false
  await expectHTTP(await fetch(base+'/studio-api/native/workspace',{headers:bearer}),401,'authority explicitly revoked','LOCAL_LOGIN_REQUIRED')
  assert.equal((await fetch(base+'/studio-api/native/groups',{method:'POST',headers:{...bearer,'Content-Type':'application/json'},body:JSON.stringify({name:'must-not-write'})})).status,401)
  const after=await stat(join(root,'data','flymind.sqlite'));assert.equal(after.size,before.size)
  active=true;assert.deepEqual(await (await fetch(base+'/studio-api/native/groups',{headers:bearer})).json(),{groups:[]})
  assert.equal((await fetch(base+'/studio-api/health')).status,200)
 }finally{
  if(child&&child.exitCode===null){child.send({type:'flymind-test-shutdown'});const closed=await Promise.race([exited!.then(()=>true),new Promise<false>(r=>setTimeout(()=>r(false),8000))]);if(!closed){child.kill();await exited;assert.fail('Runtime did not gracefully stop')}}
  await new Promise<void>(r=>provider.close(()=>r()));assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-local-runtime-'));await rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:100})
 }
})
