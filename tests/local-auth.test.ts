import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,lstat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import express from 'express'
import {request as httpRequest} from 'node:http'
import {LocalAuthorizationGate,localAuthBrowserRouter,PrivateLocalAuthStore,type LocalAuthState,type LocalAuthStore} from '../server/local-auth'
class MemoryStore implements LocalAuthStore {state?:LocalAuthState;fail=false;async read(){return this.state?structuredClone(this.state):undefined}async update(change:(s:LocalAuthState|undefined)=>LocalAuthState){if(this.fail)throw Error('controlled disk failure');this.state=structuredClone(change(await this.read()));return this.read() as Promise<LocalAuthState>}}
const APP='a'.repeat(43),GRANT='fm_local_'+'b'.repeat(43),NOW=1900000000000
function setup(){const store=new MemoryStore(),calls:Array<{path:string;init?:RequestInit}>=[];let active=true,userId='u1',role='editor',released:((r:Response)=>void)|undefined,delay=false;const json=(data:unknown)=>Response.json({code:200,data})
 const transport:typeof fetch=async(input,init)=>{const url=new URL(String(input));assert.equal(url.origin,'https://identity.example');assert.equal(init?.redirect,'error');calls.push({path:url.pathname,init});const body=init?.body?JSON.parse(String(init.body)):undefined
  if(url.pathname.endsWith('/auth/login'))return json({sessionToken:APP,user:{id:userId,name:'Account'},expiresAt:NOW+100000})
  if(url.pathname.endsWith('/auth/me'))return json({user:{id:userId,name:'Account'},expiresAt:NOW+100000,teams:[{id:'t1',name:'Team',role}]})
  if(url.pathname.endsWith('/local/grants')){assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+APP);return json({grantToken:GRANT,expiresAt:NOW+100000})}
  if(url.pathname.endsWith('/local/introspect')){assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+GRANT);const reply=active?json({user:{id:userId,name:'Account'},session:{id:'grant1',expiresAt:NOW+100000},team:{id:'t1',name:'Team',role},binding:{deviceId:body.deviceId,dataRootId:body.dataRootId}}):Response.json({code:401},{status:401});if(delay)return new Promise(r=>{released=r});return reply}
  if(url.pathname.endsWith('/local/revoke'))assert.equal(store.state?.credential,undefined)
  return json({success:true})
 }
 const options={controlPlaneOrigin:'https://identity.example',dataRootId:'workspace1',store,fetch:transport,now:()=>NOW};const gate=new LocalAuthorizationGate(options)
 return {gate,store,calls,options,deactivate:()=>{active=false},changeUser:()=>{userId='u2'},viewer:()=>{role='viewer'},delay:()=>{delay=true},release:()=>released!(json({user:{id:'u1',name:'Account'},session:{id:'grant1',expiresAt:NOW+100000},team:{id:'t1',name:'Team',role:'editor'},binding:{deviceId:store.state!.deviceId,dataRootId:'workspace1'}}))}
}
const login=(gate:LocalAuthorizationGate)=>gate.login({phone:'13800000001',password:'integration-password',teamId:'t1'})

test('missing config is explicit, no credential denies without contacting provider, status exposes no path or token',async()=>{
 for(const origin of ['', 'http://evil.test','https://u:p@example.test','https://example.test/path','https://example.test/'])assert.throws(()=>new LocalAuthorizationGate({controlPlaneOrigin:origin,dataRootId:'r',store:new MemoryStore()}),(e:any)=>e.code==='LOCAL_AUTH_CONFIGURATION_REQUIRED')
 const s=setup();assert.deepEqual(await s.gate.status(),{provider:'identity.example',dataRootId:'workspace1',loginRequired:true});assert.equal(s.calls.length,0);await assert.rejects(s.gate.authorize(),(e:any)=>e.code==='LOCAL_LOGIN_REQUIRED')
})
test('password login checks me teams before explicit device exchange; only device grant is persisted',async()=>{
 const s=setup(),selection=await s.gate.login({phone:'13800000001',password:'integration-password'});assert.ok('selectionRequired'in selection);assert.ok(!JSON.stringify(selection).includes(APP));assert.equal(s.store.state?.credential,undefined)
 if(!('selectionId'in selection))throw Error('selection missing');await assert.rejects(s.gate.clientDeviceGrant({selectionId:selection.selectionId,teamId:'other'}));await s.gate.clientDeviceGrant({selectionId:selection.selectionId,teamId:'t1'})
 assert.deepEqual(s.calls.slice(0,3).map(c=>c.path),['/app/flymind/auth/login','/app/flymind/auth/me','/app/flymind/local/grants']);assert.equal(s.store.state!.credential!.token,GRANT);assert.ok(!JSON.stringify(s.store.state).includes(APP));assert.equal((await s.gate.authorize('diagram:write')).user.id,'u1')
})
test('provider root user team bindings never silently change; server revocation and viewer role fail closed',async()=>{
 const s=setup();await login(s.gate)
 for(const options of [{...s.options,dataRootId:'other-root'},{...s.options,controlPlaneOrigin:'https://other.example'}])await assert.rejects(new LocalAuthorizationGate(options).authorize(),(e:any)=>e.code==='LOCAL_AUTH_BINDING_MISMATCH')
 s.changeUser();await assert.rejects(login(s.gate),(e:any)=>e.code==='LOCAL_AUTH_BINDING_MISMATCH')
 const v=setup();await login(v.gate);v.viewer();await assert.rejects(v.gate.authorize('diagram:write'),(e:any)=>e.status===403);assert.equal((await v.gate.authorize('diagram:read')).team.role,'viewer');v.deactivate();await assert.rejects(v.gate.authorize(),(e:any)=>e.status===401)
})
test('logout clears durable credential before remote revoke and late online successes cannot reopen it',async()=>{
 const s=setup();await login(s.gate);s.delay();const pending=s.gate.authorize();await new Promise(r=>setTimeout(r,10));await s.gate.logout();s.release();await assert.rejects(pending);assert.equal(s.store.state!.credential,undefined);assert.equal(s.store.state!.userId,'u1');await assert.rejects(s.gate.authorize());assert.equal((await s.gate.status()).loginRequired,true)
})
test('network unavailable has no offline grace, write failure revokes newly issued grant and logout failure stays closed',async()=>{
 const s=setup();await login(s.gate);const offline=new LocalAuthorizationGate({...s.options,fetch:async()=>{throw Error('offline')}});await assert.rejects(offline.authorize(),(e:any)=>e.status===503)
 const failing=setup();await failing.gate.status();failing.store.fail=true;await assert.rejects(login(failing.gate));assert.equal(failing.store.state!.credential,undefined);assert.ok(failing.calls.some(c=>c.path.endsWith('/local/revoke')))
 s.store.fail=true;await assert.rejects(s.gate.logout());s.store.fail=false;await assert.rejects(s.gate.authorize(),(e:any)=>e.status===401)
})
test('private file store persists only local token under isolated owner-only directory',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flymind-local-auth-'));try{const directory=join(root,'private'),store=new PrivateLocalAuthStore(directory),s=setup(),gate=new LocalAuthorizationGate({...s.options,store});await login(gate);const text=await readFile(join(directory,'state.json'),'utf8');assert.ok(text.includes(GRANT));assert.ok(!text.includes(APP));assert.equal((await new PrivateLocalAuthStore(directory).read())!.userId,'u1');if(process.platform!=='win32')assert.equal((await lstat(join(directory,'state.json'))).mode&0o077,0)
 }finally{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-local-auth-'));await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:100})}
})
test('browser router requires exact Host Origin JSON, enforces body limit and never returns grant tokens',async()=>{
 const s=setup(),app=express(),server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();if(!address||typeof address==='string')throw Error();const origin='http://127.0.0.1:'+address.port;app.use('/local-auth',localAuthBrowserRouter(s.gate,{runtimeOrigin:origin}));try{
 const send=(path:string,body:unknown,headers:Record<string,string>={})=>fetch(origin+'/local-auth'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)})
 assert.equal((await send('/login',{phone:'13800000001',password:'integration-password'},{Origin:'http://evil.test'})).status,403);assert.equal(await new Promise<number>((ok,no)=>{const r=httpRequest(origin+'/local-auth/login',{method:'POST',headers:{Host:'evil.test',Origin:origin,'Content-Type':'application/json'}},res=>{res.resume();ok(res.statusCode!)});r.once('error',no);r.end('{}')}),403);assert.equal((await send('/login',{password:'x'.repeat(3000)})).status,413)
 const response=await send('/login',{phone:'13800000001',password:'integration-password',teamId:'t1'});assert.equal(response.status,200);const text=await response.text();assert.ok(!text.includes(GRANT));assert.ok(!text.includes(APP));assert.equal((await send('/logout',{})).status,200)
 }finally{server.closeAllConnections();await new Promise<void>((ok,no)=>server.close(e=>e?no(e):ok()))}
})

test('another gate logout invalidates a pending team choice by durable generation, not only in-memory epoch',async()=>{
 const s=setup(),choice=await s.gate.login({phone:'13800000001',password:'integration-password'});if(!('selectionId'in choice))throw Error('selection missing')
 await new LocalAuthorizationGate(s.options).logout();await assert.rejects(s.gate.clientDeviceGrant({selectionId:choice.selectionId,teamId:'t1'}),(e:any)=>e.status===401);assert.equal(s.store.state!.credential,undefined)
})
