import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,realpath,writeFile,readFile,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {validateControlPlaneArguments,validateControlPlaneConfig,verifyMigrationInventory,verifyDatabaseBackup,executeControlPlaneRelease,fileSHA,promoteControlPlane,inspectJarMigrations,MIGRATION_INSPECT_PYTHON,probeJavaReadiness} from '../deploy/cloud/control-plane-promote.mjs'

const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const config={incomingDirectory:'/var/lib/flymind/incoming',stateDirectory:'/var/lib/flymind/cp-state',backupDirectory:'/var/backups/flymind/mysql',jarPath:'/opt/flymind/control-plane/system-admin.jar',environmentFile:'/etc/flymind/control-plane.env',readinessKeyFile:'/etc/flymind/readiness.key',backupHelper:'/usr/local/libexec/flymind-mysql-backup',pythonExecutable:'/opt/python311/bin/python3',service:'flymind-control-plane.service',readinessOrigin:'http://127.0.0.1:18080',rollbackPolicy:'additive-compatible',allowedMigrations:{'V1__baseline_schema.sql':hash('schema')}}
const release={environment:'production',releaseId:'run-123-1',archiveSHA:'a'.repeat(64),sourceCommit:'b'.repeat(40)}
test('fixed dispatcher accepts only environment and same-run release identifiers, not paths or shell words',()=>{
 assert.deepEqual(validateControlPlaneArguments(['production','run-123-1','a'.repeat(64)]),{environment:'production',releaseId:'run-123-1',archiveSHA:'a'.repeat(64)})
 for(const args of [['prod','run-123-1','a'.repeat(64)],['production','../x','a'.repeat(64)],['production','run-123-1;sh','a'.repeat(64)],['production','run-123-1','../jar'],['production','run-123-1','a'.repeat(64),'extra']])assert.throws(()=>validateControlPlaneArguments(args))
 assert.equal(validateControlPlaneConfig(config),config)
 for(const c of [{...config,jarPath:'/tmp/../app.jar'},{...config,backupHelper:'/opt/flymind/control-plane/system-admin.jar'},{...config,readinessOrigin:'http://elsewhere:18080'},{...config,service:'mysql.service'},{...config,rollbackPolicy:'restore-database'},{...config,run:'anything'},{...config,allowedMigrations:{}}])assert.throws(()=>validateControlPlaneConfig(c))
})
test('schema policy rejects new, changed, removed and unknown migration files before promotion',()=>{
 const allowed=config.allowedMigrations;assert.doesNotThrow(()=>verifyMigrationInventory({...allowed},allowed))
 for(const actual of [{...allowed,'V2__new.sql':hash('new')},{'V1__baseline_schema.sql':hash('modified')},{'R__repeat.sql':hash('repeat')},{}])assert.throws(()=>verifyMigrationInventory(actual,allowed))
})
test('migration inspection uses zip contents and no candidate execution',async()=>{
 let call
 const found=await inspectJarMigrations('/fixed/candidate.jar',async(command,args)=>{call={command,args};return JSON.stringify(config.allowedMigrations)})
 assert.deepEqual(found,config.allowedMigrations);assert.equal(call.command,'/usr/bin/python3');assert.equal(call.args.at(-1),'/fixed/candidate.jar');assert.equal(call.args[1],MIGRATION_INSPECT_PYTHON);assert.match(call.args[1],/zipfile/);assert.doesNotMatch(call.args[1],/extractall|subprocess/)
})
test('actual Python ZIP inspector hashes exact CRLF bytes and rejects repeated migration entries',async()=>{
 const f=await fixture(),python=process.platform==='win32'?'python':'/usr/bin/python3',execute=promisify(execFile)
 try{
  await execute(python,['-c',"import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('BOOT-INF/classes/db/migration/V1__baseline.sql',b'line\\r\\n'); z.close()",f.jar])
  const runner=async(_command,args)=>(await execute(python,args)).stdout
  assert.deepEqual(await inspectJarMigrations(f.jar,runner),{'V1__baseline.sql':hash('line\r\n')})
  await execute(python,['-c',"import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'a'); z.writestr('BOOT-INF/classes/db/migration/V1__baseline.sql',b'duplicate'); z.close()",f.jar])
  await assert.rejects(inspectJarMigrations(f.jar,runner))
 }finally{await f.close()}
})
test('readiness requires exact current JAR, no redirect, credential header and bounded body',async()=>{
 const key='test-only-credential-at-least-32-bytes',sha=hash('jar');let request
 const good=async(url,options)=>{request={url,options};return new Response(JSON.stringify({ready:true,jarSha256:sha}))}
 await probeJavaReadiness('http://127.0.0.1:18080',key,sha,{fetcher:good})
 assert.equal(request.url,'http://127.0.0.1:18080/internal/flymind/readyz');assert.equal(request.options.redirect,'error');assert.equal(request.options.headers['X-FlyMind-Gateway-Key'],key);assert.ok(request.options.signal)
 for(const value of [{ready:false,jarSha256:sha},{ready:true,jarSha256:hash('old-jar')},{ready:true}])await assert.rejects(probeJavaReadiness('http://127.0.0.1:18080',key,sha,{fetcher:async()=>new Response(JSON.stringify(value))}),/identity/)
 await assert.rejects(probeJavaReadiness('http://127.0.0.1:18080',key,sha,{fetcher:async()=>new Response('x'.repeat(4097))}),/budget/)
})
async function fixture({running=true}={}){
 const canonicalTmp=await realpath(tmpdir()),root=await realpath(await mkdtemp(join(canonicalTmp,'flymind-cp-test-')))
 for(const dir of ['backup','attempt','installed'])await mkdir(join(root,dir))
 const c={...config,stateDirectory:root,backupDirectory:join(root,'backup'),jarPath:join(root,'installed','system-admin.jar')},jar=join(root,'candidate.jar'),attemptDirectory=join(root,'attempt'),events=[]
 await writeFile(c.jarPath,'old-jar');await writeFile(jar,'new-jar')
 let pid=running?'42':'0'
 const service=async action=>{events.push(action);if(action==='stop')pid='0';if(action==='start')pid='42';return action==='pid'?pid:''}
 const backup=async()=>{events.push('backup');const path=join(c.backupDirectory,'database-fixture.sql.gz');await writeFile(path,'consistent-database-backup');return {file:'database-fixture.sql.gz',sha256:await fileSHA(path),bytes:26,startedAt:Date.now(),completedAt:Date.now(),consistent:true}}
 const ready=async expected=>{events.push('ready');assert.equal(expected,await fileSHA(c.jarPath))}
 return {root,c,jar,attemptDirectory,events,service,backup,ready,async close(){assert.ok(root.startsWith(canonicalTmp+sep)&&root.split(sep).at(-1).startsWith('flymind-cp-test-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}}
}
test('consistent backup receipt is bound to real bytes, fixed directory and stop time',async()=>{
 const f=await fixture();try{
  const r=await f.backup();await verifyDatabaseBackup(r,{directory:f.c.backupDirectory,startedAfter:r.startedAt})
  for(const bad of [{...r,file:'../database-fixture.sql.gz'},{...r,sha256:'0'.repeat(64)},{...r,bytes:1},{...r,startedAt:r.startedAt-1},{...r,consistent:false},{...r,completedAt:Date.now()+10000}])await assert.rejects(verifyDatabaseBackup(bad,{directory:f.c.backupDirectory,startedAfter:r.startedAt}))
 }finally{await f.close()}
})
test('stopped writer and fresh verified DB/JAR backups precede atomic JAR replacement and exact readiness',async()=>{
 const f=await fixture();try{
  const result=await executeControlPlaneRelease({config:f.c,release,jar:f.jar,attemptDirectory:f.attemptDirectory},{service:f.service,ready:f.ready,backup:f.backup,syncDir:async()=>{}})
  assert.equal(result.ok,true);assert.equal(await readFile(f.c.jarPath,'utf8'),'new-jar');assert.equal(await readFile(join(f.attemptDirectory,'previous.jar'),'utf8'),'old-jar')
  assert.deepEqual(f.events,['pid','stop','pid','backup','start','ready']);assert.equal(JSON.parse(await readFile(join(f.attemptDirectory,'result.json'),'utf8')).jarSHA,hash('new-jar'))
 }finally{await f.close()}
})
test('backup failure never replaces JAR and restarts the unchanged previous service',async()=>{
 const f=await fixture();try{
  await assert.rejects(executeControlPlaneRelease({config:f.c,release,jar:f.jar,attemptDirectory:f.attemptDirectory},{service:f.service,ready:async()=>{assert.fail('Initial old JAR has no readyz; this must not be called')},backup:async()=>{throw Error('backup failed')},syncDir:async()=>{}}),/backup failed/)
  assert.equal(await readFile(f.c.jarPath,'utf8'),'old-jar');assert.deepEqual(f.events,['pid','stop','pid','start','pid']);const result=JSON.parse(await readFile(join(f.attemptDirectory,'result.json'),'utf8'));assert.equal(result.ok,false);assert.equal(result.wasRunning,true);assert.equal(result.rollback,'previous-service-restarted-health-unverified')
 }finally{await f.close()}
})
test('backup failure preserves an initially stopped service without starting old or new Java',async()=>{
 const f=await fixture({running:false});try{
  await assert.rejects(executeControlPlaneRelease({config:f.c,release,jar:f.jar,attemptDirectory:f.attemptDirectory},{service:f.service,ready:async()=>assert.fail('Must not health-check a stopped service'),backup:async()=>{throw Error('backup denied')},syncDir:async()=>{}}),/backup denied/)
  assert.equal(await readFile(f.c.jarPath,'utf8'),'old-jar');assert.deepEqual(f.events,['pid','stop','pid']);const result=JSON.parse(await readFile(join(f.attemptDirectory,'result.json'),'utf8'));assert.equal(result.wasRunning,false);assert.equal(result.rollback,'previous-service-remained-stopped')
 }finally{await f.close()}
})
test('readiness failure can restore old code only under explicit additive policy, never database bytes',async()=>{
 const f=await fixture();let checks=0;try{
  await assert.rejects(executeControlPlaneRelease({config:f.c,release,jar:f.jar,attemptDirectory:f.attemptDirectory},{service:f.service,backup:f.backup,ready:async sha=>{if(++checks===1)throw Error('new health failed');await f.ready(sha)},syncDir:async()=>{}}),/new health failed/)
  assert.equal(await readFile(f.c.jarPath,'utf8'),'old-jar');assert.equal(await readFile(join(f.c.backupDirectory,'database-fixture.sql.gz'),'utf8'),'consistent-database-backup');assert.equal(checks,2)
  assert.equal(JSON.parse(await readFile(join(f.attemptDirectory,'result.json'),'utf8')).rollback,'previous-jar-current-database')
 }finally{await f.close()}
})
test('unknown backward compatibility leaves Java stopped after attempted migration instead of restoring DB',async()=>{
 const f=await fixture();try{
  await assert.rejects(executeControlPlaneRelease({config:{...f.c,rollbackPolicy:'stop-on-failure'},release,jar:f.jar,attemptDirectory:f.attemptDirectory},{service:f.service,backup:f.backup,ready:async()=>{throw Error('unhealthy')},syncDir:async()=>{}}),/unhealthy/)
  assert.equal(await readFile(f.c.jarPath,'utf8'),'new-jar');assert.deepEqual(f.events,['pid','stop','pid','backup','start','stop','pid']);assert.equal(JSON.parse(await readFile(join(f.attemptDirectory,'result.json'),'utf8')).rollback,'service-stopped-manual-recovery-required')
  assert.equal(JSON.parse(await readFile(join(f.root,'recovery-required.json'),'utf8')).releaseId,release.releaseId)
 }finally{await f.close()}
})
test('writer still alive forbids DB backup and replacement',async()=>{
 const f=await fixture();try{
  await assert.rejects(executeControlPlaneRelease({config:f.c,release,jar:f.jar,attemptDirectory:f.attemptDirectory},{service:async action=>{f.events.push(action);return '17'},ready:f.ready,backup:f.backup,syncDir:async()=>{}}),/writer still alive/)
  assert.equal(await readFile(f.c.jarPath,'utf8'),'old-jar');assert.deepEqual(f.events,['pid','stop','pid'])
 }finally{await f.close()}
})
test('privileged entry cannot be enabled by caller config on non-root/non-Linux hosts',async t=>{
 if(process.platform==='linux'&&process.getuid?.()===0){t.skip('Privileged config is intentionally not provisioned in unit environment');return}
 await assert.rejects(promoteControlPlane(['production','run-123-1','a'.repeat(64)]),/installed Linux root dispatcher/)
})
