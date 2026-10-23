import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {smokeConfig,verifyReady,envelope,adminToken,appToken,runtimeEvidence} from '../scripts/control-plane-runtime-smoke.mjs'
const env={CI:'true',FLYMIND_CI_CONTROL_PLANE_SMOKE:'1',MYSQL_DATABASE:'flymind_ci',MYSQL_USER:'flymind_ci',MYSQL_PASSWORD:'fixture',MYSQL_PORT:'33060',REDIS_PORT:'63790'}
test('runtime smoke only permits explicit disposable CI database and bounded service ports',()=>{
 assert.equal(smokeConfig(env).mysqlPort,33060)
 for(const changes of [{CI:'false'},{FLYMIND_CI_CONTROL_PLANE_SMOKE:''},{MYSQL_DATABASE:'production'},{MYSQL_USER:'root'},{MYSQL_PASSWORD:''},{MYSQL_PORT:'0'},{REDIS_PORT:'65536'},{MYSQL_PORT:'1e3'}])assert.throws(()=>smokeConfig({...env,...changes}))
})
test('packaged readiness requires exact actual JAR hash, not classes or wrong release',()=>{
 const hash='a'.repeat(64);verifyReady({ready:true,jarSha256:hash},hash)
 for(const body of [{ready:true,jarSha256:''},{ready:true,jarSha256:'b'.repeat(64)},{ready:false,jarSha256:hash},{ready:'true',jarSha256:hash}])assert.throws(()=>verifyReady(body,hash),/PACKAGED_JAR_IDENTITY_MISMATCH/)
})
test('real raw admin JWT and distinct app session response contracts are strict without logging payloads',()=>{
 assert.equal(adminToken({code:200,data:'aaa.bbb.ccc'}),'aaa.bbb.ccc')
 assert.equal(appToken({code:200,data:{sessionToken:'a'.repeat(43)}}),'a'.repeat(43))
 assert.throws(()=>adminToken({code:200,data:{token:'aaa.bbb.ccc'}}),/INVALID_ADMIN_JWT/)
 assert.throws(()=>appToken({code:200,data:'aaa.bbb.ccc'}),/INVALID_APP_SESSION/)
 assert.throws(()=>envelope({code:401,message:'private fixture'}),/INVALID_API_ENVELOPE/)
})
test('same-run MySQL Redis packaged runtime gate precedes prepared candidates and production',async()=>{
 const yaml=(await readFile(new URL('../.github/workflows/cloud-candidate.yml',import.meta.url),'utf8')).replaceAll('\r\n','\n')
 const runtime=yaml.slice(yaml.indexOf('\n  control_plane_runtime:\n'),yaml.indexOf('\n  platform:\n'))
 assert.match(runtime,/needs: source/);assert.match(runtime,/image: mysql:8\.0/);assert.match(runtime,/image: redis:7/)
 assert.match(runtime,/name: cloud-source\s+path: cloud-source/);assert.ok(!runtime.includes('run-id:'))
 assert.match(yaml,/platform:\s+needs: \[source, control_plane_runtime\]/)
 assert.match(yaml,/production:[\s\S]*needs: \[source, control_plane_runtime, platform\]/)
 assert.match(runtime,/run: node scripts\/control-plane-runtime-smoke.mjs/)
 assert.match(runtime,/name: control-plane-runtime-evidence\s+path: control-plane-runtime-evidence.json/)
})
test('public runtime evidence binds exact source, JAR and SQL bytes with no credentials',()=>{
 const migrations={'V1__baseline.sql':'b'.repeat(64)},evidence=runtimeEvidence('a'.repeat(40),'c'.repeat(64),migrations)
 assert.deepEqual(Object.keys(evidence),['schemaVersion','sourceCommit','jarSha256','allowedMigrations','verified'])
 assert.equal(evidence.verified,true);assert.deepEqual(evidence.allowedMigrations,migrations)
 assert.throws(()=>runtimeEvidence('unknown','c'.repeat(64),migrations))
 assert.throws(()=>runtimeEvidence('a'.repeat(40),'c'.repeat(64),{}))
 assert.throws(()=>runtimeEvidence('a'.repeat(40),'c'.repeat(64),{'../file.sql':'b'.repeat(64)}))
})
