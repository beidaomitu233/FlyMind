import {createHash,randomBytes} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {mkdtemp,open,rm,stat,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createServer} from 'node:net'
import {spawn} from 'node:child_process'
import {setTimeout as delay} from 'node:timers/promises'
import {inspectJarMigrations,verifyMigrationInventory} from '../deploy/cloud/control-plane-promote.mjs'

const fail=code=>{throw new Error(code)}
export function smokeConfig(env){
 if(env.CI!=='true'||env.FLYMIND_CI_CONTROL_PLANE_SMOKE!=='1'||env.MYSQL_DATABASE!=='flymind_ci')fail('CI_ISOLATION_REQUIRED')
 for(const key of ['MYSQL_PORT','REDIS_PORT'])if(!/^[0-9]+$/.test(env[key]??'')||Number(env[key])<1||Number(env[key])>65535)fail('INVALID_SERVICE_PORT')
 if(env.MYSQL_USER!=='flymind_ci'||!env.MYSQL_PASSWORD)fail('CI_DATABASE_REQUIRED')
 return {mysqlPort:Number(env.MYSQL_PORT),redisPort:Number(env.REDIS_PORT),password:env.MYSQL_PASSWORD}
}
export function verifyReady(body,sha){if(body?.ready!==true||body.jarSha256!==sha)fail('PACKAGED_JAR_IDENTITY_MISMATCH')}
export function envelope(body){if(body?.code!==200||body.data===undefined)fail('INVALID_API_ENVELOPE');return body.data}
export function adminToken(body){const token=envelope(body);if(typeof token!=='string'||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(token))fail('INVALID_ADMIN_JWT');return token}
export function appToken(body){const token=envelope(body)?.sessionToken;if(typeof token!=='string'||!/^[-\w]{43}$/.test(token))fail('INVALID_APP_SESSION');return token}
export function runtimeEvidence(sourceCommit,jarSha256,allowedMigrations){
 if(!/^[a-f0-9]{40}$/.test(sourceCommit??'')||!/^[a-f0-9]{64}$/.test(jarSha256??''))fail('INVALID_EVIDENCE_IDENTITY')
 verifyMigrationInventory(allowedMigrations,allowedMigrations)
 return {schemaVersion:1,sourceCommit,jarSha256,allowedMigrations,verified:true}
}
export async function verifyAccountTeamOverview(request,{admin,session}){
 const app=token=>({token:'Bearer '+token}),me=envelope(await request('/app/flymind/auth/me',app(session)))
 const code=me.user?.userCode;if(!/^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{6}$/.test(code??''))fail('USER_CODE_REQUIRED')
 const bob=envelope(await request('/admin/flymind/users',{method:'POST',token:admin,body:{phone:'13800000002',name:'CI受邀账号',password:'easy34'}}))
 if(!/^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{6}$/.test(bob.userCode??'')||bob.userCode===code)fail('INVITEE_CODE_INVALID')
 const bobSession=appToken(await request('/app/flymind/auth/login',{method:'POST',body:{phone:'13800000002',password:'easy34'}}))
 const team=envelope(await request('/app/flymind/teams',{method:'POST',...app(session),body:{name:'CI用户ID邀请'}}))
 const invitation=envelope(await request(`/app/flymind/teams/${team.id}/invites`,{method:'POST',...app(session),body:{userCode:bob.userCode,role:'editor'}}))
 if(!invitation.id||Object.hasOwn(invitation,'inviteToken')||Object.hasOwn(invitation,'token'))fail('INVITATION_ID_REQUIRED')
 const inbox=envelope(await request('/app/flymind/invites',app(bobSession)))
 if(!Array.isArray(inbox)||!inbox.some(i=>String(i.id)===String(invitation.id)&&i.status==='pending'&&String(i.teamId)===String(team.id)))fail('INVITATION_NOT_PENDING')
 const accepted=envelope(await request(`/app/flymind/invites/${invitation.id}/accept`,{method:'POST',...app(bobSession)}))
 if(String(accepted.id)!==String(team.id)||accepted.role!=='editor')fail('INVITATION_NOT_ACCEPTED')
 const finalInbox=envelope(await request('/app/flymind/invites',app(bobSession)))
 if(!finalInbox.some(i=>String(i.id)===String(invitation.id)&&i.status==='accepted'))fail('INVITATION_STATUS_NOT_PERSISTED')
 const members=envelope(await request(`/app/flymind/teams/${team.id}/members`,app(session)))
 if(!Array.isArray(members)||members.length!==2||!members.some(m=>m.userCode===bob.userCode&&m.role==='editor'))fail('TEAM_MEMBERS_MISMATCH')
 const overview=envelope(await request('/admin/flymind/overview?days=7',{token:admin}))
 if(overview.timezone!=='UTC'||Number(overview.days)!==7||Number(overview.users?.total)!==2||Number(overview.invites?.accepted)!==1||overview.activitySince==null||!Array.isArray(overview.trend)||overview.trend.length!==7||!overview.definitions?.activeUsers)fail('OVERVIEW_FACTS_MISMATCH')
}
async function freePort(){const server=createServer();await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes)});const port=server.address().port;await new Promise(yes=>server.close(yes));return port}
async function hashFile(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex')}
async function waitExit(exited,ms){return Promise.race([exited.then(()=>true),delay(ms, false,{ref:false})])}
export async function runSmoke(env=process.env){
 const cfg=smokeConfig(env),jar=resolve(env.CONTROL_PLANE_CANDIDATE_ROOT??'cloud-source','control-plane/system-admin.jar');if(!(await stat(jar)).isFile())fail('JAR_REQUIRED')
 const sha=await hashFile(jar),port=await freePort(),root=await mkdtemp(join(tmpdir(),'flymind-control-plane-ci-')),log=await open(join(root,'java.log'),'wx',0o600)
 const gateway=randomBytes(48).toString('base64url'),password=randomBytes(24).toString('base64url'),nextPassword=randomBytes(18).toString('base64url')
 let child,exited,stage='spawn',closed=false
 try{
  // Inherit only runtime discovery/system keys, never an ambient production datasource/profile.
  const childEnv=Object.fromEntries(['PATH','JAVA_HOME','HOME','TMPDIR','TEMP','TMP','SystemRoot'].filter(k=>env[k]!==undefined).map(k=>[k,env[k]]))
  Object.assign(childEnv,{ADMIN_BIND_ADDRESS:'127.0.0.1',ADMIN_PORT:String(port),ADMIN_DB_JDBC_URL:`jdbc:mysql://127.0.0.1:${cfg.mysqlPort}/flymind_ci?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC`,ADMIN_DB_USER:'flymind_ci',ADMIN_DB_PASSWORD:cfg.password,ADMIN_REDIS_HOST:'127.0.0.1',ADMIN_REDIS_PORT:String(cfg.redisPort),ADMIN_REDIS_PASSWORD:'',ADMIN_REDIS_DATABASE:'0',JWT_SECRET:randomBytes(48).toString('base64url'),FLYMIND_GATEWAY_KEY:gateway,FLYMIND_CLOUD_PUBLIC_ORIGIN:'http://127.0.0.1:'+port,FLYMIND_APP_TENANT_ID:'flymind-ci',FLYMIND_BOOTSTRAP_PHONE:'13800000099',FLYMIND_BOOTSTRAP_PASSWORD:password})
  // Flyway uses a dedicated connection with the same restricted account, not Druid's pooled connection.
  childEnv.SPRING_FLYWAY_URL=childEnv.ADMIN_DB_JDBC_URL
  childEnv.SPRING_FLYWAY_USER=childEnv.ADMIN_DB_USER
  childEnv.SPRING_FLYWAY_PASSWORD=childEnv.ADMIN_DB_PASSWORD
  child=spawn('java',['-Xms64m','-Xmx384m','-jar',jar,'--captcha.enabled=false','--flymind.bootstrap.enabled=true'],{cwd:root,env:childEnv,stdio:['ignore',log.fd,log.fd],windowsHide:true,shell:false})
  let spawnError=false;child.once('error',()=>{spawnError=true});exited=new Promise(yes=>child.once('close',()=>{closed=true;yes()}))
  const request=async(path,{method='GET',body,token,gatewayKey,expected=200}={})=>{
   let response;try{response=await fetch(`http://127.0.0.1:${port}${path}`,{method,redirect:'error',signal:AbortSignal.timeout(5000),headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:token}:{}),...(gatewayKey?{'X-FlyMind-Gateway-Key':gatewayKey}:{})},body:body?JSON.stringify(body):undefined})}catch{fail('HTTP_UNAVAILABLE')}
   if(response.status!==expected)fail('HTTP_STATUS_'+response.status)
   const text=await response.text();if(text.length>1024*1024)fail('RESPONSE_BUDGET');try{return JSON.parse(text)}catch{fail('INVALID_JSON')}
  }
  stage='packaged-readiness';let ready=false;const deadline=Date.now()+180000
  while(Date.now()<deadline){if(closed||spawnError)fail('JAVA_EXIT_BEFORE_READY');try{const body=await request('/internal/flymind/readyz',{gatewayKey:gateway});verifyReady(body,sha);ready=true;break}catch(error){if(error.message==='PACKAGED_JAR_IDENTITY_MISMATCH')throw error}await delay(500)}
  if(!ready)fail('JAVA_READINESS_TIMEOUT')
  stage='admin-login';const admin=adminToken(await request('/user/login',{method:'POST',body:{phone:'13800000099',password}}))
  envelope(await request('/user/info',{token:admin}));if(!Array.isArray(envelope(await request('/user/router',{token:admin}))))fail('INVALID_ADMIN_ROUTER')
  stage='create-independent-app-account';const account=envelope(await request('/admin/flymind/users',{method:'POST',token:admin,body:{phone:'13800000001',name:'CI前台账号',password:'easy12'}}));if(account.phone!=='13800000001')fail('ACCOUNT_IDENTITY_MISMATCH')
  stage='app-login';const session=appToken(await request('/app/flymind/auth/login',{method:'POST',body:{phone:'13800000001',password:'easy12'}}))
  stage='user-id-invitation-overview';await verifyAccountTeamOverview(request,{admin,session})
  stage='app-change-password';const changed=envelope(await request('/app/flymind/auth/password',{method:'POST',token:'Bearer '+session,body:{newPassword:nextPassword}}));if(changed.success!==true||changed.reauthenticate!==true)fail('PASSWORD_CHANGE_NOT_ACKNOWLEDGED')
  await request('/app/flymind/auth/me',{token:'Bearer '+session,expected:401})
  stage='app-new-password';const renewed=appToken(await request('/app/flymind/auth/login',{method:'POST',body:{phone:'13800000001',password:nextPassword}}));envelope(await request('/app/flymind/auth/me',{token:'Bearer '+renewed}))
  stage='admin-still-valid';envelope(await request('/user/info',{token:admin}));envelope(await request('/user/router',{token:admin}))
  return {ok:true,jarSha256:sha,checks:['packaged-ready-mysql-redis','admin-login-info-router','independent-app-account','user-id-invitation-acceptance','overview-real-facts','app-password-session-revocation','admin-session-preserved']}
 }catch(error){const code=/^[A-Z][A-Z0-9_]+$/.test(error.message??'')?error.message:'SMOKE_FAILED';throw new Error(`${stage}:${code}`)}
 finally{
  try{if(child&&!closed){child.kill('SIGTERM');if(!await waitExit(exited,25000)){child.kill('SIGKILL');if(!await waitExit(exited,5000))fail('OWNED_JAVA_DID_NOT_EXIT')}}}finally{await log.close();if(!child||closed)await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const main=async()=>{
  const result=await runSmoke()
  if(process.env.SMOKE_REPORT_PATH){
   const jar=resolve(process.env.CONTROL_PLANE_CANDIDATE_ROOT??'cloud-source','control-plane/system-admin.jar')
   if(await hashFile(jar)!==result.jarSha256)fail('JAR_CHANGED_AFTER_SMOKE')
   const migrations=await inspectJarMigrations(jar)
   if(await hashFile(jar)!==result.jarSha256)fail('JAR_CHANGED_DURING_INSPECTION')
   const report=runtimeEvidence(process.env.GITHUB_SHA,result.jarSha256,migrations)
   await writeFile(resolve(process.env.SMOKE_REPORT_PATH),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o644})
  }
  console.log(JSON.stringify(result))
 }
 main().catch(error=>{console.error(JSON.stringify({ok:false,error:/^(?:[a-z-]+:)?[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'CONTROL_PLANE_SMOKE_FAILED'}));process.exitCode=1})
}
