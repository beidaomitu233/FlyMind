import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,realpath,lstat,rm,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {gatewayArguments,switchGateway,trustedPath,gatewayAlreadyCurrent,releaseGatewayLock} from '../deploy/cloud/gateway-promote.mjs'
import {deploymentPromotionCommands,promoteUploadedCandidate} from '../scripts/upload-cloud-candidate.mjs'

test('gateway fixed production command rejects arbitrary arguments; opt-in only after Java and app',async()=>{
 assert.equal(gatewayArguments(['production','run-123-1','a'.repeat(64)]).releaseId,'run-123-1')
 for(const args of [['staging','run-123-1','a'.repeat(64)],['production','../x','a'.repeat(64)],['production','run-123-1','x'],['production','run-123-1','a'.repeat(64),'extra']])assert.throws(()=>gatewayArguments(args))
 const commands=deploymentPromotionCommands('production','run-123-1','a'.repeat(64),'true','true')
 assert.equal(commands.length,3);assert.match(commands[0],/control-plane-promote/);assert.match(commands[1],/flymind-promote /);assert.match(commands[2],/gateway-promote/)
 assert.equal(deploymentPromotionCommands('production','run-123-1','a'.repeat(64)).length,1)
 assert.throws(()=>deploymentPromotionCommands('production','run-123-1','a'.repeat(64),'false','TRUE'))
 assert.throws(()=>deploymentPromotionCommands('staging','run-123-1','a'.repeat(64),'false','true'))
 for(const failAt of [0,1]){
  const seen=[];await assert.rejects(promoteUploadedCandidate({environment:'production',id:'run-123-1'},'a'.repeat(64),[],'true',async a=>{seen.push(a[0]);if(seen.length===failAt+1)throw Error('failed')},'true'))
  assert.equal(seen.length,failAt+1);assert.ok(!seen.some(x=>x.includes('gateway-promote')))
 }
})
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'flymind-gateway-test-'));try{const link=join(root,'application'),target=join(root,'target'),backup=join(root,'backup');await mkdir(link);await mkdir(target);await writeFile(join(link,'old'),'keep');await fn({root,link,target,backup})}finally{await rm(root,{recursive:true,force:true,maxRetries:3})}}
test('first fixed directory switches to verified target only after stop proof; original retained',()=>fixture(async f=>{
 const calls=[];const result=await switchGateway(f,{stop:async()=>calls.push('stop'),stopped:async()=>calls.push('stopped'),start:async()=>calls.push('start'),ready:async t=>{calls.push('ready');assert.equal(await realpath(f.link),t)}})
 assert.deepEqual(calls,['stop','stopped','start','ready']);assert.equal(result.legacy,true);assert.equal(await readFile(join(f.backup,'old'),'utf8'),'keep')
}))
test('readiness failure restores old actual directory and verifies restarted original',()=>fixture(async f=>{
 let starts=0,reads=0;await assert.rejects(switchGateway(f,{stop:async()=>{},stopped:async()=>{},start:async()=>{starts++},ready:async expected=>{if(++reads===1)throw Error('new failed');assert.equal(expected,f.link);assert.equal(await realpath(f.link),await realpath(expected))}}),e=>{assert.match(e.message,/new failed/);assert.equal(e.safeToUnlock,true);return true})
 assert.equal(starts,2);assert.equal((await lstat(f.link)).isDirectory(),true);assert.equal(await readFile(join(f.link,'old'),'utf8'),'keep')
}))
test('drain failure leaves existing directory untouched, no start or switch',()=>fixture(async f=>{
 await assert.rejects(switchGateway(f,{stop:async()=>{},stopped:async()=>{throw Error('live old pid')},start:async()=>assert.fail('must not start'),ready:async()=>assert.fail()}),/live old/)
 assert.equal(await readFile(join(f.link,'old'),'utf8'),'keep');await assert.rejects(lstat(f.backup),{code:'ENOENT'})
}))
test('failed symlink replacement rolls back to exact previous application',{skip:process.platform!=='linux'?'Production requires Linux atomic symlink replacement; Windows cannot rename over a directory junction':false},()=>fixture(async f=>{
 await rm(f.link,{recursive:true});const old=join(f.root,'old');await mkdir(old);await symlink(old,f.link,'junction');let reads=0
 await assert.rejects(switchGateway(f,{stop:async()=>{},stopped:async()=>{},start:async()=>{},ready:async()=>{if(++reads===1)throw Error('unready')}}),/unready/)
 assert.equal(await realpath(f.link),await realpath(old))
}))
test('unprivileged test source is not accepted as trusted root production path',()=>fixture(async f=>{
 // This is a permission rejection check, not simulated Linux root validation.
 await assert.rejects(trustedPath(join(f.link,'old')))
}))
test('already-current gateway verifies readiness and does not restart or invalidate sessions',()=>fixture(async f=>{
 await rm(f.link,{recursive:true});await symlink(f.target,f.link,'junction');let ready=0
 assert.equal(await gatewayAlreadyCurrent(f.link,f.target,async target=>{ready++;assert.equal(target,f.target)}),true)
 assert.equal(ready,1)
 await assert.rejects(gatewayAlreadyCurrent(f.link,f.target,async()=>{throw Error('not ready')}),/not ready/)
 assert.equal(await realpath(f.link),await realpath(f.target))
}))
test('lock release checks token and pid and never removes another owner',()=>fixture(async f=>{
 const lock=join(f.root,'lock');await mkdir(lock);const owner={token:'own-token',pid:123,releaseId:'run-123-1'}
 await writeFile(join(lock,'owner.json'),JSON.stringify(owner))
 await assert.rejects(releaseGatewayLock(lock,{...owner,token:'other-token'}),/OWNER_CHANGED/)
 assert.equal((await lstat(lock)).isDirectory(),true)
 await releaseGatewayLock(lock,owner);await assert.rejects(lstat(lock),{code:'ENOENT'})
}))
