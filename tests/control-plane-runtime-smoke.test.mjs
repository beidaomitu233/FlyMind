import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {smokeConfig,verifyReady,envelope,adminToken,appToken,runtimeEvidence,verifyAccountTeamOverview,verifyRegistration} from '../scripts/control-plane-runtime-smoke.mjs'
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
function accountTeamFixture({pending=true,total=2}={}){
 let accepted=false;const calls=[]
 const request=async(path,options={})=>{calls.push({path,...options});let data
  if(path==='/app/flymind/auth/me')data={user:{userCode:'ABC123'}}
  else if(path==='/admin/flymind/users')data={userCode:'DEF456'}
  else if(path==='/app/flymind/auth/login')data={sessionToken:'b'.repeat(43)}
  else if(path==='/app/flymind/teams')data={id:'team-1'}
  else if(path==='/app/flymind/teams/team-1/invites'){assert.deepEqual(options.body,{userCode:'DEF456',role:'editor'});data={id:'invite-1',expiresAt:999}}
  else if(path==='/app/flymind/invites')data=pending?[{id:'invite-1',teamId:'team-1',status:accepted?'accepted':'pending'}]:[]
  else if(path==='/app/flymind/invites/invite-1/accept'){assert.equal(options.token,'Bearer '+'b'.repeat(43));assert.equal(options.body,undefined);accepted=true;data={id:'team-1',role:'editor'}}
  else if(path==='/app/flymind/teams/team-1/members')data=[{userCode:'ABC123',role:'owner'},{userCode:'DEF456',role:'editor'}]
  else if(path==='/admin/flymind/overview?days=7')data={timezone:'UTC',days:7,users:{total:String(total)},invites:{accepted:'1'},activitySince:1,trend:Array(7).fill({}),definitions:{activeUsers:'actual session users'}}
  else assert.fail('Unexpected API '+path)
  return {code:200,data}
 };return {request,calls}
}
test('U30 smoke uses user ID invite and recipient inbox acceptance before checking actual overview',async()=>{
 const fixture=accountTeamFixture();await verifyAccountTeamOverview(fixture.request,{admin:'admin-jwt',session:'alice'})
 assert.equal(fixture.calls.filter(c=>c.path==='/app/flymind/invites').length,2)
 assert.equal(fixture.calls.at(-1).token,'admin-jwt')
 const source=await readFile(new URL('../scripts/control-plane-runtime-smoke.mjs',import.meta.url),'utf8')
 assert.match(source,/body:\{newPassword:nextPassword\}/);assert.ok(!source.includes('currentPassword:'))
})
test('U30 smoke fails if invite is not delivered or overview counts are fabricated',async()=>{
 await assert.rejects(verifyAccountTeamOverview(accountTeamFixture({pending:false}).request,{admin:'admin',session:'alice'}),/INVITATION_NOT_PENDING/)
 await assert.rejects(verifyAccountTeamOverview(accountTeamFixture({total:120000}).request,{admin:'admin',session:'alice'}),/OVERVIEW_FACTS_MISMATCH/)
})
function registrationFixture({raceFailure,role='owner',limit=true,revoke=true}={}){
 const accounts=new Map(),sessions=new Map(),attempts=new Map(),calls=[];let serial=0
 const issue=user=>{const sessionToken=String(++serial).padStart(43,'s');sessions.set(sessionToken,user);return {sessionToken,user}}
 const request=async(path,options={})=>{
  calls.push({path,...options});let response
  if(path.endsWith('/register')){
   assert.equal(options.method,'POST');assert.equal(options.token,undefined);assert.deepEqual(Object.keys(options.body).sort(),['password','phone'])
   const {phone}=options.body,count=(attempts.get(phone)??0)+1;attempts.set(phone,count)
   // Yield so the helper really starts both requests before observing either result.
   await Promise.resolve()
   if(raceFailure&&phone==='13800000102')response={code:503,errorCode:'IDENTITY_UNAVAILABLE'}
   else if(limit&&count>5)response={code:429,errorCode:'RATE_LIMITED'}
   else if(phone==='13800000099'||accounts.has(phone))response={code:409,errorCode:'ACCOUNT_EXISTS'}
   else {const n=accounts.size+1,user={id:'user-'+n,name:'FlyMind用户',userCode:'ABC12'+n};accounts.set(phone,user);response={code:200,data:issue(user)}}
  }else if(path.endsWith('/login')){
   const user=accounts.get(options.body.phone);assert.ok(user);response={code:200,data:issue(user)}
  }else if(path.endsWith('/logout')){
   if(revoke)sessions.delete(options.token.slice(7));response={code:200,data:{success:true}}
  }else if(path.endsWith('/me')){
   const user=sessions.get(options.token.slice(7));response=user?{code:200,data:{user,teams:[{id:'personal-'+user.id,name:'个人空间',role}]}}:{code:401,errorCode:'UNAUTHORIZED'}
  }else assert.fail('Unexpected registration fixture route')
  if(!(Array.isArray(options.expected)?options.expected:[options.expected??200]).includes(response.code))throw new Error('HTTP_STATUS_'+response.code)
  return response
 };return {request,accounts,attempts,calls}
}
test('U33 packaged smoke verifies anonymous lifecycle, three parallel duplicate pairs and sixth-attempt limit',async()=>{
 const fixture=registrationFixture(),result=await verifyRegistration(fixture.request,{password:'fixture-only-password'})
 assert.deepEqual(result,{successfulRegistrations:4,concurrentPairs:3,phoneLimitAttempt:6,snapshotCoordination:'parallel-http-not-forced'})
 assert.equal(fixture.accounts.size,4);assert.equal(fixture.attempts.get('13800000101'),6)
 for(const phone of ['13800000102','13800000103','13800000104'])assert.equal(fixture.attempts.get(phone),3)
 assert.equal(fixture.attempts.get('13800000099'),1)
 assert.doesNotMatch(JSON.stringify(result),/fixture-only-password|13800000|sessionToken|user-1/)
})
test('U33 packaged smoke rejects unavailable authority, missing owner, stale session and missing rate limit',async()=>{
 for(const [options,code] of [[{raceFailure:true},'HTTP_STATUS_503'],[{role:'editor'},'REGISTRATION_PERSONAL_SPACE_INVALID'],[{revoke:false},'HTTP_STATUS_200'],[{limit:false},'HTTP_STATUS_409']]){
  await assert.rejects(verifyRegistration(registrationFixture(options).request,{password:'fixture-only-password'}),new RegExp(code))
 }
})
test('U33 smoke runs after the two-account overview and before verified evidence creation',async()=>{
 const source=await readFile(new URL('../scripts/control-plane-runtime-smoke.mjs',import.meta.url),'utf8')
 assert.ok(source.indexOf("stage='anonymous-registration'")>source.indexOf("stage='user-id-invitation-overview'"))
 assert.ok(source.indexOf('const result=await runSmoke()')<source.indexOf('const report=runtimeEvidence('))
 assert.match(source,/SPRING_FLYWAY_URL=childEnv.ADMIN_DB_JDBC_URL/)
})
