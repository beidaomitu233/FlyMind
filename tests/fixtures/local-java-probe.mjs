import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {join,resolve,sep} from 'node:path'
import {tmpdir} from 'node:os'
import {LocalAuthorizationGate} from '../../server/local-auth/index.ts'
let directory,lastResponse
const shape=value=>Array.isArray(value)?value.slice(0,1).map(shape):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,shape(item)])):typeof value
try{
 let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>4096)throw Error('input budget')}
 const {provider,phone,password,teamId}=JSON.parse(input);directory=await mkdtemp(join(tmpdir(),'flymind-java-gate-'))
 const options={controlPlaneOrigin:provider,credentialDirectory:join(directory,'credentials'),dataRootId:'java-gate-workspace',allowInsecureLoopback:true,fetch:async(...args)=>{const response=await fetch(...args);lastResponse={path:new URL(String(args[0])).pathname,status:response.status,shape:shape(await response.clone().json())};return response}},gate=new LocalAuthorizationGate(options)
 await assert.rejects(gate.authorize(),{code:'LOCAL_LOGIN_REQUIRED'})
 assert.equal((await gate.login({phone,password,teamId})).authorized,true)
 const principal=await gate.authorize('diagram:write');assert.equal(principal.team.id,teamId)
 const saved=JSON.parse(await readFile(join(directory,'credentials','state.json'),'utf8'))
 assert.match(saved.credential.token,/^fm_local_/);assert.ok(!JSON.stringify(saved).includes(password))
 await assert.rejects(new LocalAuthorizationGate({...options,dataRootId:'wrong-workspace'}).authorize(),{code:'LOCAL_AUTH_BINDING_MISMATCH'})
 const binding={deviceId:saved.deviceId,dataRootId:saved.dataRootId},inspect=()=>fetch(provider+'/app/flymind/local/introspect',{method:'POST',headers:{Authorization:'Bearer '+saved.credential.token,'Content-Type':'application/json'},body:JSON.stringify(binding)})
 assert.equal((await inspect()).status,200)
 assert.deepEqual(await gate.logout(),{loggedOut:true,remoteRevoked:true});assert.equal((await inspect()).status,401)
 await assert.rejects(gate.authorize(),{code:'LOCAL_LOGIN_REQUIRED'})
 assert.equal(JSON.parse(await readFile(join(directory,'credentials','state.json'),'utf8')).credential,undefined)
 await gate.login({phone,password,teamId});await gate.authorize('diagram:write');await gate.logout()
 console.log(JSON.stringify({ok:true,checks:['real-login-me-grant','online-authorize','fixed-root','remote-revoke','durable-logout','same-binding-relogin']}))
}catch(error){console.error(JSON.stringify({ok:false,code:typeof error?.code==='string'?error.code:'LOCAL_JAVA_PROBE_FAILED',lastResponse}));process.exitCode=1}
finally{if(directory){assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep)&&directory.includes('flymind-java-gate-'));await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100})}}
