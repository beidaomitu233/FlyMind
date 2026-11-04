import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm,stat,open} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,sep} from 'node:path'
import {spawn} from 'node:child_process'
import {createDeploymentCommandRunner,materializeCandidate} from '../deploy/cloud/materialize-candidate.mjs'
import {executeControlPlaneRelease,finalizeControlPlaneAttempt,writeControlPlaneResult,assertControlPlaneResultReady,writeControlPlaneRecovery,assertControlPlaneRecoveryReady} from '../deploy/cloud/control-plane-promote.mjs'
import {finalizeApplicationAttempt,writeApplicationReceipt,assertApplicationReceiptReady,recoverApplicationFailure,writeApplicationRecovery,assertApplicationRecoveryReady} from '../deploy/cloud/promote.mjs'

class FakeChild extends EventEmitter{
 constructor(pid=101){super();this.pid=pid;this.stdout=new PassThrough();this.stderr=new PassThrough();this.signals=[]}
 kill(signal){this.signals.push(signal);return true}
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function fixture(){const parent=await realpath(tmpdir()),root=await realpath(await mkdtemp(join(parent,'flymind-deploy-life-')));return {root,async close(){assert.ok(root.startsWith(parent+sep)&&root.split(sep).at(-1).startsWith('flymind-deploy-life-'));await rm(root,{recursive:true,force:true})}}}
const exists=path=>stat(path).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e})

test('real owned child timeout waits for OS close before returning',async()=>{
 let closeSeen=false
 const runner=createDeploymentCommandRunner({profile:'control',closeGraceMs:2000,spawnChild:(...args)=>{const child=spawn(...args);child.once('close',()=>{closeSeen=true});return child}})
 await assert.rejects(runner.run(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:50,noDescendants:true}),/deadline/)
 assert.equal(closeSeen,true);assert.equal(runner.state.uncertain,false)
})
test('real spawn failure without a process does not poison a lock',async()=>{
 const runner=createDeploymentCommandRunner({profile:'control',closeGraceMs:500})
 await assert.rejects(runner.run('flymind-test-no-such-executable-81d0',[],{timeoutMs:1000}))
 assert.equal(runner.state.uncertain,false)
})
test('delayed close is awaited, while an absent close permanently fences the attempt',async()=>{
 const child=new FakeChild(),runner=createDeploymentCommandRunner({profile:'control',closeGraceMs:100,spawnChild:()=>child})
 let done=false;const result=runner.run('fixture',[],{timeoutMs:10,noDescendants:true}).catch(e=>{done=true;return e})
 await wait(25);assert.equal(done,false);assert.deepEqual(child.signals,['SIGKILL']);child.emit('exit',null,'SIGKILL');await wait(5);assert.equal(done,false);child.emit('close',null,'SIGKILL')
 assert.match((await result).message,/deadline/);assert.equal(runner.state.uncertain,false)
 const late=new FakeChild(),second=createDeploymentCommandRunner({profile:'control',closeGraceMs:20,spawnChild:()=>late})
 const failure=await second.run('fixture',[],{timeoutMs:10,noDescendants:true}).catch(e=>e)
 assert.equal(failure.code,'DEPLOY_SUBPROCESS_UNCERTAIN');assert.equal(second.state.uncertain,true);late.emit('close',null,'SIGKILL');assert.equal(second.state.uncertain,true)
})
test('output overflow and systemd-like timeout cannot turn into success or safe cleanup',async()=>{
 for(const cause of ['overflow','timeout']){
  const child=new FakeChild(),runner=createDeploymentCommandRunner({profile:'control',closeGraceMs:100,spawnChild:()=>child})
  const result=runner.run('fixture',[],{timeoutMs:cause==='timeout'?10:1000,maxOutput:4}).catch(e=>e)
  if(cause==='overflow')child.stdout.write('12345');else await wait(25)
  child.emit('close',0,null);assert.equal((await result).code,'DEPLOY_SUBPROCESS_UNCERTAIN');assert.equal(runner.state.uncertain,true);assert.deepEqual(child.signals,['SIGKILL'])
 }
})
test('an exited child is never signalled again while close remains pending',async()=>{
 const child=new FakeChild(),runner=createDeploymentCommandRunner({profile:'application',closeGraceMs:20,spawnChild:()=>child})
 const result=runner.run('fixture',[],{timeoutMs:10,noDescendants:true}).catch(e=>e);child.emit('exit',0,null)
 const error=await result;assert.equal(error.code,'DEPLOY_SUBPROCESS_UNCERTAIN');assert.deepEqual(child.signals,[]);assert.equal(runner.state.uncertain,true)
})
test('materializer retains stage on uncertain extraction and removes it on ordinary failure',async()=>{
 for(const uncertain of [true,false]){const f=await fixture();try{
  const archive=join(f.root,'a.tar.gz'),destination=join(f.root,'candidate');await writeFile(archive,'fixture');await mkdir(destination);let stage
  await assert.rejects(materializeCandidate({archive,destination,environment:'production',python:'unused',requireRootOwned:false,run:async(_command,args,options)=>{stage=args[4];assert.equal(options.noDescendants,true);await writeFile(join(stage,'partial'),'preserve');throw Object.assign(Error('injected'),uncertain?{cleanupUncertain:true}:{})}}))
  assert.equal(await exists(stage),uncertain)
  if(uncertain)assert.equal(await readFile(join(stage,'partial'),'utf8'),'preserve')
 }finally{await f.close()}}
})
test('uncertain fake systemd action persists failure and does not start rollback',async()=>{
 const f=await fixture();try{
  const attempt=join(f.root,'attempt'),installed=join(f.root,'installed.jar'),jar=join(f.root,'candidate.jar');await mkdir(attempt);await writeFile(installed,'old');await writeFile(jar,'new')
  let uncertain=false;const calls=[]
  await assert.rejects(executeControlPlaneRelease({config:{jarPath:installed,backupDirectory:f.root,stateDirectory:f.root,rollbackPolicy:'additive-compatible'},release:{releaseId:'run-1-1'},jar,attemptDirectory:attempt},{service:async action=>{calls.push(action);if(action==='pid')return '42';uncertain=true;throw Error('fake systemd timeout')},ready:async()=>assert.fail(),backup:async()=>assert.fail(),syncDir:async()=>{},isUncertain:()=>uncertain,markUncertain:()=>{uncertain=true}}),/fake systemd timeout/)
  const receipt=JSON.parse(await readFile(join(attempt,'result.json'),'utf8'));assert.equal(receipt.ok,false);assert.equal(receipt.rollback,'subprocess-cleanup-unconfirmed');assert.deepEqual(calls,['pid','stop']);assert.equal(await readFile(installed,'utf8'),'old')
 }finally{await f.close()}
})
test('failure receipt sync errors latch uncertainty and prevent lock release',async()=>{
 const f=await fixture();try{
  const attempt=join(f.root,'attempt'),installed=join(f.root,'installed.jar'),jar=join(f.root,'candidate.jar'),lock=join(f.root,'lock')
  await mkdir(attempt);await mkdir(lock);await writeFile(installed,'old');await writeFile(jar,'new')
  const owner={pid:process.pid,releaseId:'run-1-1',archiveSHA:'a'.repeat(64),environment:'production',token:'owned'};await writeFile(join(lock,'owner.json'),JSON.stringify(owner))
  let uncertain=false
  await assert.rejects(executeControlPlaneRelease({config:{jarPath:installed,backupDirectory:f.root,rollbackPolicy:'additive-compatible'},release:{releaseId:'run-1-1'},jar,attemptDirectory:attempt},{service:async action=>{if(action==='pid')return '42';throw Error('fixture stop failed')},ready:async()=>assert.fail(),backup:async()=>assert.fail(),syncDir:async()=>{throw Error('fixture fsync failed')},isUncertain:()=>uncertain,markUncertain:()=>{uncertain=true}}),/fixture fsync failed/)
  assert.equal(uncertain,true);assert.equal(await exists(join(f.root,'.control-plane-result-pending.json')),true);assert.equal(await exists(join(attempt,'result.json')),false)
  await finalizeControlPlaneAttempt({lock,owner,attemptDirectory:attempt,state:{uncertain}});assert.equal(await exists(lock),true)
 }finally{await f.close()}
})
test('application receipts sync marker and receipt before clearing marker; collisions never overwrite',async()=>{
 const f=await fixture();try{
  const path=join(f.root,'release.json'),marker=join(f.root,'.application-receipt-pending.json'),value={ok:true,releaseId:'run-1-1',archiveSHA:'a'.repeat(64),environment:'production'},calls=[]
  await writeApplicationReceipt({path,marker,value},{syncDir:async p=>calls.push(p)})
  assert.equal(calls.length,3);assert.equal(await exists(marker),false);const original=await readFile(path,'utf8')
  await writeApplicationReceipt({path,marker,value,allowExistingSuccess:true},{syncDir:async()=>{}})
  assert.equal(await readFile(path,'utf8'),original)
  await assert.rejects(writeApplicationReceipt({path,marker,value:{...value,archiveSHA:'b'.repeat(64)},allowExistingSuccess:true},{syncDir:async()=>{}}),/mismatch/)
  assert.equal(await readFile(path,'utf8'),original);assert.equal(await exists(marker),true);await assert.rejects(assertApplicationReceiptReady(marker),/recovery/)
 }finally{await f.close()}
})
test('application existing failure cannot be overwritten or accepted as successful replay',async()=>{
 const f=await fixture();try{
  const path=join(f.root,'release.json'),marker=join(f.root,'.application-receipt-pending.json'),prior=JSON.stringify({ok:false,releaseId:'run-1-1',archiveSHA:'a'.repeat(64),environment:'production'})
  await writeFile(path,prior)
  await assert.rejects(writeApplicationReceipt({path,marker,value:{...JSON.parse(prior),ok:true},allowExistingSuccess:true},{syncDir:async()=>{}}),/mismatch/)
  assert.equal(await readFile(path,'utf8'),prior);assert.equal(await exists(marker),true)
 }finally{await f.close()}
})
test('application file sync and directory sync failure preserve pending marker and block cleanup',async()=>{
 for(const phase of ['marker-file','receipt-file','marker-directory','receipt-directory']){const f=await fixture();try{
  const path=join(f.root,'release.json'),marker=join(f.root,'.application-receipt-pending.json'),lock=join(f.root,'lock'),stage=join(f.root,'stage'),owner={pid:process.pid,releaseId:'run-1-1',archiveSHA:'a'.repeat(64),environment:'production',token:'owned'}
  await mkdir(lock);await writeFile(stage,'keep');await writeFile(join(lock,'owner.json'),JSON.stringify(owner));let dirs=0
  const openFile=async(name,...args)=>{const file=await open(name,...args);return {writeFile:(...v)=>file.writeFile(...v),stat:()=>file.stat(),readFile:(...v)=>file.readFile(...v),close:()=>file.close(),sync:async()=>{if(phase===(name===marker?'marker-file':'receipt-file'))throw Error('injected file sync');await file.sync()}}}
  const syncDir=async()=>{dirs++;if(phase===(dirs===1?'marker-directory':'receipt-directory'))throw Error('injected directory sync')}
  await assert.rejects(writeApplicationReceipt({path,marker,value:{ok:true,...owner}},{openFile,syncDir}),/injected/)
  assert.equal(await exists(marker),true);await assert.rejects(assertApplicationReceiptReady(marker),/recovery/)
  await finalizeApplicationAttempt({lock,owner,stagedArchive:stage,receiptPersisted:true,state:{uncertain:false},marker})
  assert.equal(await exists(lock),true);assert.equal(await exists(stage),true)
 }finally{await f.close()}}
})
test('control plane pending marker blocks replay and unlocking even with apparent success receipt',async()=>{
 for(const phase of ['marker-directory','result-file','result-directory']){const f=await fixture();try{
  const attempt=join(f.root,'attempt'),lock=join(f.root,'lock'),owner={pid:process.pid,releaseId:'run-1-1',archiveSHA:'a'.repeat(64),environment:'production',token:'owned'}
  await mkdir(attempt);await mkdir(lock);await writeFile(join(lock,'owner.json'),JSON.stringify(owner));await writeFile(join(attempt,'start-intent.json'),'{}');let dirs=0
  const syncDir=async()=>{dirs++;if(phase===(dirs===1?'marker-directory':'result-directory'))throw Error('injected directory sync')}
  const writeJSON=async(path,value)=>{await writeFile(path,JSON.stringify(value),{flag:'wx'});if(phase==='result-file'&&path.endsWith('result.json'))throw Error('injected file sync')}
  await assert.rejects(writeControlPlaneResult(attempt,{ok:true,releaseId:owner.releaseId},{syncDir,writeJSON}),/injected/)
  assert.equal(await exists(join(f.root,'.control-plane-result-pending.json')),true);await assert.rejects(assertControlPlaneResultReady(f.root),/recovery/)
  await finalizeControlPlaneAttempt({lock,owner,attemptDirectory:attempt,state:{uncertain:false}});assert.equal(await exists(lock),true)
 }finally{await f.close()}}
})
test('final marker-removal sync failure retains lock even after receipt was synced',async()=>{
 for(const type of ['application','control']){const f=await fixture();try{
  const lock=join(f.root,'lock'),attempt=join(f.root,'attempt'),stage=join(f.root,'stage'),owner={pid:process.pid,releaseId:'run-1-1',archiveSHA:'a'.repeat(64),environment:'production',token:'owned'}
  await mkdir(lock);await mkdir(attempt);await writeFile(stage,'keep');await writeFile(join(lock,'owner.json'),JSON.stringify(owner));let syncs=0
  const syncDir=async()=>{if(++syncs===3)throw Error('marker removal sync failed')}
  if(type==='application'){
   const marker=join(f.root,'.application-receipt-pending.json')
   await assert.rejects(writeApplicationReceipt({path:join(f.root,'receipt.json'),marker,value:{...owner,ok:true}},{syncDir}),/marker removal sync failed/)
   assert.equal(await exists(marker),false)
   await finalizeApplicationAttempt({lock,owner,stagedArchive:stage,receiptPersisted:false,state:{uncertain:true},marker})
  }else{
   await assert.rejects(writeControlPlaneResult(attempt,{...owner,ok:true},{syncDir}),/marker removal sync failed/)
   assert.equal(await exists(join(f.root,'.control-plane-result-pending.json')),false)
   await finalizeControlPlaneAttempt({lock,owner,attemptDirectory:attempt,state:{uncertain:true}})
  }
  assert.equal(syncs,3);assert.equal(await exists(lock),true);assert.equal(await exists(stage),true)
 }finally{await f.close()}}
})
test('legacy per-release pending markers block different releases and all finalizers',async()=>{
 for(const type of ['application','control']){const f=await fixture();try{
  const lock=join(f.root,'lock'),stage=join(f.root,'stage'),attempt=join(f.root,'run-2-1'),owner={pid:process.pid,releaseId:'run-2-1',archiveSHA:'a'.repeat(64),environment:'production',token:'owned'}
  await mkdir(lock);await mkdir(attempt);await writeFile(stage,'keep');await writeFile(join(lock,'owner.json'),JSON.stringify(owner))
  if(type==='application'){
   await writeFile(join(f.root,'run-1-1.receipt-pending.json'),'{}')
   const marker=join(f.root,'.application-receipt-pending.json');await assert.rejects(assertApplicationReceiptReady(marker),/recovery/)
   await finalizeApplicationAttempt({lock,owner,stagedArchive:stage,receiptPersisted:true,state:{uncertain:false},marker})
  }else{
   const old=join(f.root,'run-1-1');await mkdir(old);await writeFile(join(old,'.result-pending.json'),'{}');await assert.rejects(assertControlPlaneResultReady(f.root),/recovery/)
   await finalizeControlPlaneAttempt({lock,owner,attemptDirectory:attempt,state:{uncertain:false}})
  }
  assert.equal(await exists(lock),true);assert.equal(await exists(stage),true)
 }finally{await f.close()}}
})
test('actual application rollback and restart failure branches latch and retain recovery',async()=>{
 for(const mode of ['rollback','restart']){const f=await fixture();try{
  const lock=join(f.root,'lock'),stage=join(f.root,'stage'),owner={pid:process.pid,releaseId:'run-1-1',archiveSHA:'a'.repeat(64),environment:'production',token:'owned'},state={uncertain:false};let calls=0
  await mkdir(lock);await writeFile(stage,'keep');await writeFile(join(lock,'owner.json'),JSON.stringify(owner))
  const result=await recoverApplicationFailure({state,switched:mode==='rollback',stopped:true,oldTarget:'fixture',restore:async()=>{calls++;throw Error('fake rollback failed')},restart:async()=>{calls++;throw Error('fake restart failed')}})
  assert.equal(calls,1);assert.equal(state.uncertain,true);assert.match(result,mode==='rollback'?/^failed:/ :/manual-recovery-required/)
  await writeApplicationRecovery(f.root,{reason:result},{syncDir:async()=>{}});await assert.rejects(assertApplicationRecoveryReady(f.root),/recovery/)
  await finalizeApplicationAttempt({lock,owner,stagedArchive:stage,receiptPersisted:true,state,marker:join(f.root,'.application-receipt-pending.json')})
  assert.equal(await exists(lock),true);assert.equal(await exists(stage),true)
 }finally{await f.close()}}
})
test('both publisher recovery markers block entry without overwriting previous evidence',async()=>{
 for(const type of ['application','control']){const f=await fixture();try{
  const write=type==='application'?writeApplicationRecovery:writeControlPlaneRecovery,check=type==='application'?assertApplicationRecoveryReady:assertControlPlaneRecoveryReady
  const lock=join(f.root,'lock'),stage=join(f.root,'stage'),attempt=join(f.root,'attempt'),owner={pid:process.pid,releaseId:'run-1-1',archiveSHA:'a'.repeat(64),environment:'production',token:'owned'}
  await mkdir(lock);await mkdir(attempt);await writeFile(stage,'keep');await writeFile(join(lock,'owner.json'),JSON.stringify(owner))
  await write(f.root,{reason:'first'},{syncDir:async()=>{}});const marker=join(f.root,'recovery-required.json'),original=await readFile(marker,'utf8')
  await assert.rejects(write(f.root,{reason:'second'},{syncDir:async()=>{}}),{code:'EEXIST'});assert.equal(await readFile(marker,'utf8'),original);await assert.rejects(check(f.root),/recovery/)
  if(type==='application')await finalizeApplicationAttempt({lock,owner,stagedArchive:stage,receiptPersisted:true,state:{uncertain:false},marker:join(f.root,'.application-receipt-pending.json')})
  else await finalizeControlPlaneAttempt({lock,owner,attemptDirectory:attempt,state:{uncertain:false}})
  assert.equal(await exists(lock),true);assert.equal(await exists(stage),true)
 }finally{await f.close()}}
})
test('both finalizers retain unowned, uncertain, or unreceipted state',async()=>{
 for(const type of ['application','control'])for(const failure of ['uncertain','owner','receipt']){const f=await fixture();try{
  const lock=join(f.root,'lock'),stage=join(f.root,'stage'),attempt=join(f.root,'attempt'),owner={pid:process.pid,releaseId:'run-1-1',archiveSHA:'a'.repeat(64),environment:'production',token:'owned'}
  await mkdir(lock);await mkdir(attempt);await writeFile(stage,'temporary');await writeFile(join(lock,'owner.json'),JSON.stringify({...owner,...(failure==='owner'?{token:'other'}:{})}))
  const state={uncertain:failure==='uncertain'}
  if(type==='application')await finalizeApplicationAttempt({lock,owner,stagedArchive:stage,receiptPersisted:failure!=='receipt',state})
  else{await writeFile(join(attempt,'start-intent.json'),'{}');if(failure!=='receipt')await writeFile(join(attempt,'result.json'),JSON.stringify({ok:false}));await finalizeControlPlaneAttempt({lock,owner,attemptDirectory:attempt,state})}
  assert.equal(await exists(lock),true);assert.equal(await exists(stage),true)
 }finally{await f.close()}}
})
test('owned, receipted ordinary failures can release their own locks',async()=>{
 for(const type of ['application','control']){const f=await fixture();try{
  const lock=join(f.root,'lock'),stage=join(f.root,'stage'),attempt=join(f.root,'attempt'),owner={pid:process.pid,releaseId:'run-1-1',archiveSHA:'a'.repeat(64),environment:'production',token:'owned'}
  await mkdir(lock);await mkdir(attempt);await writeFile(stage,'temporary');await writeFile(join(lock,'owner.json'),JSON.stringify(owner));await writeFile(join(attempt,'start-intent.json'),'{}');await writeFile(join(attempt,'result.json'),JSON.stringify({ok:false}))
  if(type==='application')await finalizeApplicationAttempt({lock,owner,stagedArchive:stage,receiptPersisted:true,state:{uncertain:false}})
  else await finalizeControlPlaneAttempt({lock,owner,attemptDirectory:attempt,state:{uncertain:false}})
  assert.equal(await exists(lock),false);assert.equal(await exists(stage),type==='control')
 }finally{await f.close()}}
})
