import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {cloudRegistrationError} from '../src/drawing/services/cloud-client'

// Execute the actual form handlers with UI/session dependencies isolated. Browser
// layout and the real Java authority are verified separately by PM.
const source=await readFile(new URL('../src/drawing/ui/CloudStudio.vue',import.meta.url),'utf8')
const handler=(name:string,end:string)=>source.slice(source.indexOf(name),source.indexOf(end,source.indexOf(name)))
const code=ts.transpileModule(handler('function switchAuthMode()','\nconst workspaceOpen=')+'\n'+handler('async function login()','\nasync function changePassword()'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const ref=<T>(value:T)=>({value})
function fixture(){
 const calls:string[]=[],queries:unknown[]=[],user={user:{id:'new-user',name:'New'},teams:[{id:'personal',name:'Personal',role:'owner'}]}
 const context={authMode:ref<'login'|'register'>('register'),busy:ref(false),phone:ref(' 13800000000 '),password:ref('easy12'),passwordVisible:ref(true),error:ref(''),authorizationId:ref(''),route:{query:{diagram:'current',invite:'keep'} as Record<string,string>},team:ref<unknown>(undefined),authApi:{login:async(_phone:string,_password:string)=>{calls.push('login')},register:async(_phone:string,_password:string)=>{calls.push('register')},me:async()=>{calls.push('me');return user}},bind:()=>{calls.push('bind')},announce:()=>{calls.push('announce')},inspectConsent:async()=>{calls.push('consent')},replaceQuery:async(q:unknown)=>{queries.push(q)},cloudRegistrationError,guarded:async(action:()=>Promise<void>)=>{if(context.busy.value)return;context.busy.value=true;context.error.value='';try{await action()}catch(error){context.error.value=(error as Error).message}finally{context.busy.value=false}}}
 const methods=runInNewContext(code+'\n({login,switchAuthMode})',context) as {login:()=>Promise<void>;switchAuthMode:()=>void}
 return {context,calls,queries,...methods}
}

test('registration clears credentials and continues the original personal-space or OAuth context',async()=>{
 const f=fixture();await f.login();assert.deepEqual(f.calls,['register','me','bind','announce']);assert.deepEqual(JSON.parse(JSON.stringify(f.queries)),[{diagram:'current',invite:'keep',team:'personal'}]);assert.equal(f.context.password.value,'');assert.equal(f.context.passwordVisible.value,false);assert.equal(f.context.authMode.value,'login')
 const consent=fixture();consent.context.authorizationId.value='original-consent';await consent.login();assert.deepEqual(consent.calls,['register','me','bind','announce','consent']);assert.equal(consent.queries.length,0);assert.equal(consent.context.authMode.value,'login')
})

test('registration errors clear password, do not bind a user, and mode switches keep non-secret context',async()=>{
 const f=fixture();f.context.authApi.register=async()=>{throw Error('账号已存在')};await f.login();assert.equal(f.context.error.value,'账号已存在');assert.equal(f.context.password.value,'');assert.equal(f.context.passwordVisible.value,false);assert.equal(f.calls.includes('me'),false)
 f.context.password.value='secret';f.context.passwordVisible.value=true;f.switchAuthMode();assert.equal(f.context.authMode.value,'login');assert.equal(f.context.error.value,'');assert.equal(f.context.password.value,'');assert.equal(f.context.phone.value,' 13800000000 ');assert.equal(f.context.route.query.invite,'keep')
 f.context.phone.value='legacy-account';f.context.password.value='old';await f.login();assert.equal(f.calls[0],'login')
})

test('registration local errors and duplicate submits cannot send another account request',async()=>{
 const invalid=fixture();invalid.context.password.value='123';await invalid.login();assert.equal(invalid.calls.length,0);assert.equal(invalid.context.password.value,'');assert.ok(invalid.context.error.value)
 const f=fixture();let finish!:()=>void;f.context.authApi.register=()=>new Promise<void>(resolve=>{finish=resolve;f.calls.push('register')});const pending=f.login();await f.login();f.switchAuthMode();assert.equal(f.context.authMode.value,'register');assert.deepEqual(f.calls,['register']);finish();await pending;assert.equal(f.context.busy.value,false)
})
