import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,realpath,lstat,rm,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createServer,request as httpRequest} from 'node:http'
import {gatewayArguments,switchGateway,trustedPath,gatewayAlreadyCurrent,releaseGatewayLock,gatewayReadinessJSON} from '../deploy/cloud/gateway-promote.mjs'
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
async function fixture(fn,tempRoot=tmpdir()){const created=await mkdtemp(join(tempRoot,'flymind-gateway-test-')),root=await realpath(created);try{const link=join(root,'application'),target=join(root,'target'),backup=join(root,'backup');await mkdir(link);await mkdir(target);await writeFile(join(link,'old'),'keep');await fn({root,link,target,backup})}finally{await rm(root,{recursive:true,force:true,maxRetries:3})}}
test('first fixed directory switches to verified target only after stop proof; original retained',()=>fixture(async f=>{
 const calls=[];const result=await switchGateway(f,{stop:async()=>calls.push('stop'),stopped:async()=>calls.push('stopped'),start:async()=>calls.push('start'),ready:async t=>{calls.push('ready');assert.equal(await realpath(f.link),await realpath(t))}})
 assert.deepEqual(calls,['stop','stopped','start','ready']);assert.equal(result.legacy,true);assert.equal(await readFile(join(f.backup,'old'),'utf8'),'keep')
}))
test('temporary parent aliases canonicalize before fixed-directory promotion without changing production checks',async()=>{
 const parent=await realpath(await mkdtemp(join(tmpdir(),'flymind-gateway-alias-')))
 try{
  const actual=join(parent,'actual-temp'),alias=join(parent,'RUNNER~1');await mkdir(actual);await symlink(actual,alias,'junction')
  await fixture(async f=>{
   assert.equal(f.root,await realpath(f.root));assert.ok(!f.root.startsWith(alias))
   const result=await switchGateway(f,{stop:async()=>{},stopped:async()=>{},start:async()=>{},ready:async expected=>assert.equal(await realpath(f.link),await realpath(expected))})
   assert.equal(result.legacy,true);assert.equal(await readFile(join(f.backup,'old'),'utf8'),'keep')
  },alias)
 }finally{await rm(parent,{recursive:true,force:true,maxRetries:3})}
})
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
test('real loopback readiness preserves public virtual Host and Origin; wrong public identity is rejected',async()=>{
 const seen=[],server=createServer((req,res)=>{
  seen.push({host:req.headers.host,origin:req.headers.origin,path:req.url})
  if(req.headers.host!=='flymind.example'||req.headers.origin!=='https://flymind.example'){res.writeHead(403);res.end('{"code":"HOST_FORBIDDEN"}');return}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ready:true,releaseId:'run-123-1'}))
 })
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port
 try{
  assert.deepEqual(await gatewayReadinessJSON(origin,'/readyz','https://flymind.example'),{ready:true,releaseId:'run-123-1'})
  assert.deepEqual(seen[0],{host:'flymind.example',origin:'https://flymind.example',path:'/readyz'})
  assert.deepEqual(await gatewayReadinessJSON(new URL(origin),'/readyz','https://flymind.example'),{ready:true,releaseId:'run-123-1'})
  await assert.rejects(gatewayReadinessJSON(origin,'/readyz','https://wrong.example'),/GATEWAY_READINESS_FAILED/)
  // Negative control: the same real server refuses its connection Host, without
  // relying on fetch's Node-version-specific forbidden-header behavior.
  const status=await new Promise((yes,no)=>{const req=httpRequest(origin+'/readyz',r=>{r.resume();yes(r.statusCode)});req.once('error',no);req.end()})
  assert.equal(status,403)
 }finally{await new Promise(r=>server.close(r))}
})
test('readiness rejects redirects, oversized/invalid JSON and truncated responses without following locations',async()=>{
 let mode='redirect',calls=0
 const server=createServer((_req,res)=>{calls++
  if(mode==='redirect'){res.writeHead(302,{Location:'http://127.0.0.1:1/not-allowed'});res.end()}
  else if(mode==='large')res.end(JSON.stringify({payload:'x'.repeat(17000)}))
  else if(mode==='truncated'){res.writeHead(200,{'Content-Length':'100'});res.end('{}')}
  else res.end('invalid JSON')
 })
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port
 try{
  for(mode of ['redirect','large','truncated','invalid'])await assert.rejects(gatewayReadinessJSON(origin,'/readyz','https://flymind.example'),/GATEWAY_READINESS_FAILED/)
  assert.equal(calls,4)
  assert.throws(()=>gatewayReadinessJSON('http://remote.invalid','/readyz','https://flymind.example'),/ORIGIN_INVALID/)
  assert.throws(()=>gatewayReadinessJSON(origin,'/other','https://flymind.example'),/ORIGIN_INVALID/)
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})
