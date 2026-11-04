import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,realpath,writeFile,readFile,mkdir,rm,lstat,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {cleanupSuccessfulAttempt} from '../deploy/cloud/control-plane-promote.mjs'

const sha=value=>createHash('sha256').update(value).digest('hex')
const release={environment:'production',releaseId:'run-123-1',archiveSHA:'a'.repeat(64)}
const options={rootProtected:false,syncDir:async()=>{},readMounts:async()=>[]}
const exists=async path=>{try{await lstat(path);return true}catch(error){if(error.code==='ENOENT')return false;throw error}}
async function fixture(){
 const parent=await realpath(tmpdir()),root=await realpath(await mkdtemp(join(parent,'flymind-cp-clean-'))),state=join(root,'state'),attempt=join(state,release.releaseId),candidate=join(attempt,'candidate'),lock=join(state,'.control-plane.lock'),outside=join(root,'user-data'),jar=join(root,'installed.jar')
 for(const directory of [state,attempt,candidate,lock,outside])await mkdir(directory)
 await writeFile(jar,'new jar');await writeFile(join(outside,'untouched'),'user data');await writeFile(join(attempt,'previous.jar'),'old jar');await writeFile(join(attempt,'candidate.tar.gz'),'archive');await writeFile(join(candidate,'file'),'candidate')
 const owner={pid:process.pid,...release},result={...release,ok:true,jarSHA:sha('new jar'),steps:['writer-stopped','database-backup-verified','new-java-ready']},intent={jarSHA:sha('new jar')}
 for(const [path,value] of [[join(lock,'owner.json'),owner],[join(attempt,'result.json'),result],[join(attempt,'start-intent.json'),intent],[join(attempt,'backup.json'),{databaseBackup:{file:'protected.sql.gz'}}]])await writeFile(path,JSON.stringify(value))
 return {root,state,attempt,candidate,lock,outside,jar,owner,result,intent,config:{stateDirectory:state,jarPath:jar},async close(){assert.ok(root.startsWith(parent+sep)&&root.split(sep).at(-1).startsWith('flymind-cp-clean-'));await rm(root,{recursive:true,force:true})}}
}

test('confirmed success removes only payload and allows idempotent replay, preserving linked external data and receipts',async()=>{
 const f=await fixture();try{
  await symlink(f.outside,join(f.candidate,'external-link'),process.platform==='win32'?'junction':'dir')
  const syncs=[],cleanup=()=>cleanupSuccessfulAttempt({config:f.config,release},{...options,syncDir:async path=>syncs.push(path)})
  assert.deepEqual(await cleanup(),{status:'cleaned'});assert.equal(await exists(f.candidate),false);assert.equal(await exists(join(f.attempt,'candidate.tar.gz')),false)
  assert.equal(await readFile(join(f.outside,'untouched'),'utf8'),'user data');assert.equal(await readFile(join(f.attempt,'previous.jar'),'utf8'),'old jar')
  for(const file of ['result.json','start-intent.json','backup.json'])assert.ok(await exists(join(f.attempt,file)))
  assert.deepEqual(syncs,[f.attempt,f.attempt,f.attempt]);assert.deepEqual(await cleanup(),{status:'cleaned'});assert.ok(await exists(join(f.attempt,'result.json')))
 }finally{await f.close()}
})

test('failed, uncertain, unowned, wrong JAR, recovery and mounted cases never delete payloads',async()=>{
 for(const kind of ['failed','missing-result','missing-intent','owner','jar','recovery','mounted','pending']){
  const f=await fixture();try{
   if(kind==='failed')await writeFile(join(f.attempt,'result.json'),JSON.stringify({...f.result,ok:false}))
   if(kind==='missing-result')await rm(join(f.attempt,'result.json'))
   if(kind==='missing-intent')await rm(join(f.attempt,'start-intent.json'))
   if(kind==='owner')await writeFile(join(f.lock,'owner.json'),JSON.stringify({...f.owner,pid:process.pid+1}))
   if(kind==='jar')await writeFile(f.jar,'other jar')
   if(kind==='recovery')await writeFile(join(f.state,'recovery-required.json'),'{}')
   if(kind==='pending')await writeFile(join(f.attempt,'.result-pending.json'),'{}')
   const readMounts=async()=>kind==='mounted'?[join(f.candidate,'nested-mount')]:[]
   assert.deepEqual(await cleanupSuccessfulAttempt({config:f.config,release},{...options,readMounts}),{status:'not-cleaned'},kind)
   assert.ok(await exists(join(f.candidate,'file')),kind);assert.ok(await exists(join(f.attempt,'candidate.tar.gz')),kind);assert.ok(await exists(join(f.attempt,'previous.jar')),kind)
  }finally{await f.close()}
 }
})

test('candidate and archive redirection each refuse cleanup without following outside paths',async()=>{
 for(const kind of ['candidate','archive']){const f=await fixture();try{
  if(kind==='candidate'){await rm(f.candidate,{recursive:true});await symlink(f.outside,f.candidate,process.platform==='win32'?'junction':'dir')}
  else{await rm(join(f.attempt,'candidate.tar.gz'));await symlink(f.outside,join(f.attempt,'candidate.tar.gz'),process.platform==='win32'?'junction':'dir')}
  assert.deepEqual(await cleanupSuccessfulAttempt({config:f.config,release},options),{status:'not-cleaned'});assert.equal(await readFile(join(f.outside,'untouched'),'utf8'),'user data');assert.ok(await exists(join(f.attempt,'previous.jar')))
 }finally{await f.close()}}
})

test('cleanup failures are nonfatal and replay finishes a partial cleanup',async()=>{
 const f=await fixture();try{
  let calls=0;const failed=await cleanupSuccessfulAttempt({config:f.config,release},{...options,syncDir:async()=>{if(++calls===2)throw Error('injected fsync failure')}})
  assert.deepEqual(failed,{status:'not-cleaned'});assert.equal(await exists(f.candidate),false);assert.ok(await exists(join(f.attempt,'candidate.tar.gz')));assert.ok(await exists(join(f.attempt,'result.json')))
  assert.deepEqual(await cleanupSuccessfulAttempt({config:f.config,release},options),{status:'cleaned'});assert.equal(await exists(join(f.attempt,'candidate.tar.gz')),false);assert.equal(await readFile(join(f.attempt,'previous.jar'),'utf8'),'old jar')
 }finally{await f.close()}
})
