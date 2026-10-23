import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {deploymentPromotionCommands,promoteUploadedCandidate,runSSH,SSH_LIMITS} from '../scripts/upload-cloud-candidate.mjs'
import {EventEmitter} from 'node:events'
import {PassThrough,Writable} from 'node:stream'
const config={environment:'production',id:'run-123-1'},sha='a'.repeat(64),options=['-T','fixture@no-network.invalid']
const app='sudo -n /usr/local/libexec/flymind-promote production run-123-1 '+sha
const java='sudo -n /usr/local/libexec/flymind-control-plane-promote production run-123-1 '+sha
test('legacy app-only mode never gains Java privilege; full-stack opt-in is an exact string',()=>{
 assert.deepEqual(deploymentPromotionCommands(config.environment,config.id,sha),[app])
 for(const value of ['', 'false'])assert.deepEqual(deploymentPromotionCommands(config.environment,config.id,sha,value),[app])
 assert.deepEqual(deploymentPromotionCommands(config.environment,config.id,sha,'true'),[java,app])
 for(const value of ['TRUE','yes','1','unknown',true,1])assert.throws(()=>deploymentPromotionCommands(config.environment,config.id,sha,value))
 for(const [environment,id,digest]of [['other',config.id,sha],['production','x;sh',sha],['production',config.id,'abc']])assert.throws(()=>deploymentPromotionCommands(environment,id,digest,'true'))
})
test('full-stack Java settlement precedes application; Java failure blocks app, app failure propagates',async()=>{
 const order=[];let release;const pending=new Promise(resolve=>{release=resolve})
 const finished=promoteUploadedCandidate(config,sha,options,'true',async args=>{order.push(args.at(-1));if(order.length===1)await pending})
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(order,[java]);release();await finished;assert.deepEqual(order,[java,app])
 const failed=[];await assert.rejects(promoteUploadedCandidate(config,sha,options,'true',async args=>{failed.push(args.at(-1));throw Error('Java readiness failed')}),/Java readiness/);assert.deepEqual(failed,[java])
 const appFailed=[];await assert.rejects(promoteUploadedCandidate(config,sha,options,'true',async args=>{appFailed.push(args.at(-1));if(appFailed.length===2)throw Error('Application failed')}),/Application failed/);assert.deepEqual(appFailed,[java,app])
})
test('production dispatch is boolean opt-in on main and depends on same-run source plus full platform matrix',async()=>{
 const yaml=(await readFile(new URL('../.github/workflows/cloud-candidate.yml',import.meta.url),'utf8')).replaceAll('\r\n','\n'),production=yaml.slice(yaml.indexOf('\n  production:\n'))
 assert.match(yaml,/deploy_production:\s+description:[^\n]+\s+type: boolean\s+required: false\s+default: false/)
 assert.match(production,/if: github\.ref == 'refs\/heads\/main' && \(\(github\.event_name == 'push' && vars\.CLOUD_AUTO_PRODUCTION == 'true'\) \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.deploy_production == true\)\)/)
 assert.match(production,/needs: \[source, control_plane_runtime, platform\]/);assert.ok(!production.includes('always()'))
 assert.match(production,/environment: production/);assert.match(production,/group: cloud-production/);assert.match(production,/cancel-in-progress: false/)
 assert.match(production,/if \[ "\$CONTROL_PLANE_DEPLOY" != 'true' \]; then/)
 assert.ok(production.indexOf('Production requires explicit')<production.indexOf('actions/checkout@'))
 assert.match(production,/name: flymind-linux-x64/);assert.ok(!production.includes('run-id:'))
 assert.match(production,/DEPLOY_SOURCE_RUN_ID: \$\{\{ github.run_id \}\}/);assert.match(production,/DEPLOY_SOURCE_SHA: \$\{\{ github.sha \}\}/)
 assert.match(production,/DEPLOY_CONTROL_PLANE_DEPLOY: \$\{\{ vars.CLOUD_CONTROL_PLANE_DEPLOY \|\| 'false' \}\}/)
 assert.match(production,/vars.CLOUD_ARTIFACT_HTTPS == 'true' && 'artifact-https' \|\| 'bytes'/)
 assert.match(production,/timeout-minutes: 120/)
})

// Controlled stream and clock; no SSH, network, sleeps, or real hour-long wait.
function sshFixture({closeOn='SIGTERM'}={}){
 const source=new PassThrough(),child=new EventEmitter(),logs=[],kills=[],received=[];let clock=0,monitor
 const timers=new Set()
 child.stdin=new Writable({write(chunk,_encoding,callback){received.push(Buffer.from(chunk));callback()}})
 child.kill=signal=>{kills.push(signal);if(signal===closeOn)child.emit('close',null,signal);return true}
 const hooks={spawn:()=>child,stat:async()=>({size:3}),readStream:()=>source,now:()=>clock,log:value=>logs.push(JSON.parse(value)),setInterval:fn=>{monitor=fn;return 1},clearInterval:()=>{monitor=undefined},setTimeout:(fn,delay)=>{const timer={fn,due:clock+delay};timers.add(timer);return timer},clearTimeout:timer=>timers.delete(timer)}
 return {source,child,logs,kills,received,hooks,advance(ms){clock+=ms;monitor?.();for(const timer of [...timers])if(timer.due<=clock){timers.delete(timer);timer.fn()}}}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve))
test('byte upload reports safe single-pass progress and waits for remote close after input completion',async()=>{
 const f=sshFixture(),done=runSSH(['DO_NOT_LOG_PRIVATE_ARGUMENT'],'fixture.tar.gz',undefined,f.hooks)
 await flush();f.source.write('abc');await flush();f.advance(SSH_LIMITS.progressMs)
 assert.equal(f.logs.at(-1).inputBytesQueued,3);assert.equal(f.logs.at(-1).phase,'sending')
 f.source.end();await flush();assert.equal(f.logs.at(-1).phase,'awaiting-receipt')
 f.advance(SSH_LIMITS.idleMs+1);assert.deepEqual(f.kills,[],'Sending-idle timer must not interrupt remote digest/fsync receipt')
 f.child.emit('close',0);await done
 assert.equal(Buffer.concat(f.received).toString(),'abc');assert.equal(f.logs.at(-1).event,'upload-confirmed');assert.ok(!JSON.stringify(f.logs).includes('DO_NOT_LOG_PRIVATE_ARGUMENT'))
})
test('no byte progress fails with a distinct timeout and does not retry an unconfirmed upload',async()=>{
 const f=sshFixture();let starts=0;f.hooks.spawn=()=>{starts++;return f.child}
 const done=runSSH([],'fixture.tar.gz',undefined,f.hooks),rejected=assert.rejects(done,{code:'SSH_UPLOAD_IDLE'})
 await flush();f.advance(SSH_LIMITS.idleMs);await rejected
 assert.equal(starts,1);assert.deepEqual(f.kills,['SIGTERM'])
})
test('receipt timeout is independent of send idle and bounded by the byte upload hard limit',async()=>{
 const f=sshFixture(),done=runSSH([],'fixture.tar.gz',undefined,f.hooks),rejected=assert.rejects(done,{code:'SSH_RECEIPT_DEADLINE'})
 await flush();f.source.end('abc');await flush();f.advance(SSH_LIMITS.receiptMs);await rejected
 assert.equal(f.logs.at(-1).phase,'awaiting-receipt')
})
test('byte upload hard deadline remains sixty minutes',async()=>{
 const f=sshFixture(),done=runSSH([],'fixture.tar.gz',undefined,f.hooks),rejected=assert.rejects(done,{code:'SSH_UPLOAD_DEADLINE'})
 await flush();f.advance(SSH_LIMITS.uploadMs);await rejected;assert.equal(SSH_LIMITS.uploadMs,3600000)
})
test('promotion keeps twenty-minute budget and escalates ignored TERM to bounded KILL',async()=>{
 const f=sshFixture({closeOn:'SIGKILL'}),done=runSSH(['DO_NOT_LOG_TOKEN'],undefined,undefined,f.hooks),rejected=assert.rejects(done,{code:'SSH_COMMAND_DEADLINE'})
 await flush();f.advance(SSH_LIMITS.commandMs);assert.deepEqual(f.kills,['SIGTERM']);f.advance(SSH_LIMITS.terminateMs);await rejected
 assert.deepEqual(f.kills,['SIGTERM','SIGKILL']);assert.deepEqual(f.logs,[]);assert.equal(SSH_LIMITS.commandMs,1200000)
})
test('missing close after KILL cannot leave the uploader awaiting the SSH promise forever',async()=>{
 const f=sshFixture({closeOn:'never'}),done=runSSH([],undefined,undefined,f.hooks),rejected=assert.rejects(done,{code:'SSH_COMMAND_DEADLINE'})
 await flush();f.advance(SSH_LIMITS.commandMs);f.advance(SSH_LIMITS.terminateMs);f.advance(SSH_LIMITS.terminateMs);await rejected
 assert.deepEqual(f.kills,['SIGTERM','SIGKILL'])
})
test('opaque HTTPS metadata is passed once without any upload payload logging',async()=>{
 const f=sshFixture(),payload=Buffer.from('PRIVATE_SIGNED_URL'),done=runSSH([],undefined,payload,f.hooks)
 await flush();f.child.emit('close',0);await done;assert.equal(Buffer.concat(f.received).toString(),payload.toString());assert.deepEqual(f.logs,[])
})
