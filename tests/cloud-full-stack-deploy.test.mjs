import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {deploymentPromotionCommands,promoteUploadedCandidate} from '../scripts/upload-cloud-candidate.mjs'
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
})
