#!/usr/bin/env node
// Install this file and its verifier from reviewed source, never from candidate ops.
import {readFile,writeFile,lstat,realpath,mkdir,open,rename,rm,rmdir,chmod,readdir,opendir} from 'node:fs/promises'
import {createReadStream,createWriteStream,constants} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import {Transform} from 'node:stream'
import {createHash,randomUUID} from 'node:crypto'
import {dirname,join,resolve,posix,sep} from 'node:path'
import {pathToFileURL} from 'node:url'
import {materializeCandidate,createDeploymentCommandRunner} from './materialize-candidate.mjs'

const SHA=/^[a-f0-9]{64}$/,MIGRATION=/^V[0-9][A-Za-z0-9_.-]*__[^/\\]+\.sql$/
const PATH_KEYS=['incomingDirectory','stateDirectory','backupDirectory','jarPath','environmentFile','backupHelper','readinessKeyFile','pythonExecutable']
export function validateControlPlaneArguments(argv){
 const [environment,releaseId,archiveSHA]=argv
 if(argv.length!==3||!['staging','production'].includes(environment)||!/^run-[1-9][0-9]*-[1-9][0-9]*$/.test(releaseId??'')||releaseId.length>100||!SHA.test(archiveSHA??''))throw Error('Use <staging|production> <run-ID-attempt> <archiveSHA256>')
 return {environment,releaseId,archiveSHA}
}
export function validateControlPlaneConfig(c){
 const keys=[...PATH_KEYS,'service','readinessOrigin','allowedMigrations','rollbackPolicy']
 if(!c||Object.keys(c).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(c,k)))throw Error('Control plane config fields invalid')
 for(const k of PATH_KEYS)if(typeof c[k]!=='string'||!c[k].startsWith('/')||posix.resolve(c[k])!==c[k]||c[k]==='/'||c[k].includes('\0'))throw Error('Control plane path invalid: '+k)
 for(const a of PATH_KEYS)for(const b of PATH_KEYS)if(a!==b&&(c[a]===c[b]||c[a].startsWith(c[b]+'/')))throw Error('Control plane configured paths overlap')
 if(!/^flymind-[a-zA-Z0-9-]+\.service$/.test(c.service)||!['additive-compatible','stop-on-failure'].includes(c.rollbackPolicy))throw Error('Control plane service/policy invalid')
 const url=new URL(c.readinessOrigin)
 if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)||url.origin!==c.readinessOrigin||url.username||url.password)throw Error('Readiness must use a fixed loopback origin')
 validateMigrationPolicy(c.allowedMigrations)
 return c
}
function validateMigrationPolicy(map){
 if(!map||Array.isArray(map)||typeof map!=='object'||Object.keys(map).length===0||Object.keys(map).length>1000||Object.entries(map).some(([name,sha])=>!MIGRATION.test(name)||!SHA.test(sha)))throw Error('Allowed migration inventory invalid')
}
export function verifyMigrationInventory(actual,allowed){
 validateMigrationPolicy(actual);validateMigrationPolicy(allowed)
 if(JSON.stringify(Object.entries(actual).sort())!==JSON.stringify(Object.entries(allowed).sort()))throw Error('Unapproved Java schema migration inventory')
}
export async function fileSHA(path){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex')}
async function durableJSON(path,value){const f=await open(path,'wx',0o600);try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync()}finally{await f.close()}}
async function syncDirectory(path){const f=await open(path,'r');try{await f.sync()}finally{await f.close()}}
async function existsEntry(path){try{await lstat(path);return true}catch(error){if(error.code==='ENOENT')return false;throw error}}
async function resultPending(stateDirectory){
 if(await existsEntry(join(stateDirectory,'.control-plane-result-pending.json')))return true
 const started=Date.now();let count=0,handle=await opendir(stateDirectory)
 try{for await(const entry of handle){handle=undefined;if(++count>100000||Date.now()-started>5000)throw Error('Result inventory incomplete')
  if(!/^run-[1-9][0-9]*-[1-9][0-9]*$/.test(entry.name))continue
  const dir=join(stateDirectory,entry.name),before=await lstat(dir)
  if(!before.isDirectory()||before.isSymbolicLink())throw Error('Result inventory untrusted')
  if(await existsEntry(join(dir,'.result-pending.json')))return true
  const after=await lstat(dir);if(before.dev!==after.dev||before.ino!==after.ino)throw Error('Result inventory changed')
 }return false}finally{await handle?.close().catch(()=>{})}
}
export async function assertControlPlaneResultReady(stateDirectory){if(await resultPending(stateDirectory))throw Error('Java result requires recovery')}
export async function writeControlPlaneResult(attempt,value,{syncDir=syncDirectory,writeJSON=durableJSON}={}){
 const stateDirectory=dirname(attempt),marker=join(stateDirectory,'.control-plane-result-pending.json')
 await assertControlPlaneResultReady(stateDirectory)
 await writeJSON(marker,{pending:true,releaseId:value.releaseId});await syncDir(stateDirectory)
 await writeJSON(join(attempt,'result.json'),value);await syncDir(attempt)
 await rm(marker);await syncDir(stateDirectory)
}
export async function writeControlPlaneRecovery(stateDirectory,value,{syncDir=syncDirectory}={}){
 await durableJSON(join(stateDirectory,'recovery-required.json'),value)
 await syncDir(stateDirectory)
}
export async function assertControlPlaneRecoveryReady(stateDirectory){if(await existsEntry(join(stateDirectory,'recovery-required.json')))throw Error('Java manual recovery marker must be resolved in server console')}
async function mountPoints(){
 const text=await readFile('/proc/self/mountinfo','utf8'),points=[]
 for(const line of text.trim().split('\n')){const fields=line.split(' ');if(fields.length<10||!fields.includes('-'))throw Error('Mount table invalid');const path=fields[4].replace(/\\([0-7]{3})/g,(_m,octal)=>String.fromCharCode(parseInt(octal,8)));if(!path.startsWith('/'))throw Error('Mount path invalid');points.push(path)}
 if(!points.length)throw Error('Mount table unavailable');return points
}
const atOrBelow=(path,root)=>path===root||path.startsWith(root+sep)
async function cleanupTreeCheck(path,device,rootProtected){
 let count=0
 async function walk(current,depth){
  if(++count>100000||depth>128)throw Error('Cleanup tree budget exceeded')
  const info=await lstat(current);if(info.dev!==device||rootProtected&&info.uid!==0)throw Error('Cleanup tree ownership or device changed')
  if(info.isSymbolicLink())return
  if(info.isFile()){if(rootProtected&&(info.mode&0o022))throw Error('Cleanup file writable');return}
  if(!info.isDirectory()||rootProtected&&(info.mode&0o022))throw Error('Cleanup tree is not protected')
  for(const name of await readdir(current))await walk(join(current,name),depth+1)
 }
 await walk(path,0)
}
/** Best effort only: receipts and previous JAR remain the replay/recovery authority. */
export async function cleanupSuccessfulAttempt({config,release},{rootProtected=true,syncDir=syncDirectory,readMounts=mountPoints}={}){
 try{
  validateControlPlaneArguments([release.environment,release.releaseId,release.archiveSHA])
  const state=resolve(config.stateDirectory),attempt=join(state,release.releaseId),lock=join(state,'.control-plane.lock')
  if(state!==config.stateDirectory||await realpath(state)!==state||await realpath(attempt)!==attempt||await realpath(lock)!==lock)throw Error('Cleanup directory redirected')
  if(rootProtected){if(process.platform!=='linux'||process.getuid?.()!==0)throw Error('Cleanup requires root Linux');await trustedAncestors(state);await trustedAncestors(attempt);await trustedAncestors(lock)}
  const readReceipt=async path=>{const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.size>65536||rootProtected&&(s.uid!==0||s.mode&0o077)||await realpath(path)!==path)throw Error('Cleanup receipt invalid');return JSON.parse(await readFile(path,'utf8'))}
  const owner=await readReceipt(join(lock,'owner.json')),result=await readReceipt(join(attempt,'result.json')),intent=await readReceipt(join(attempt,'start-intent.json'))
  if(await resultPending(state))throw Error('Cleanup blocked by pending result')
  if(owner.pid!==process.pid||owner.releaseId!==release.releaseId||owner.archiveSHA!==release.archiveSHA||owner.environment!==release.environment||result.ok!==true||result.releaseId!==release.releaseId||result.environment!==release.environment||result.archiveSHA!==release.archiveSHA||!SHA.test(result.jarSHA??'')||result.jarSHA!==intent.jarSHA||!Array.isArray(result.steps)||!result.steps.includes('new-java-ready')||await fileSHA(config.jarPath)!==result.jarSHA)throw Error('Cleanup success or ownership not confirmed')
  try{await lstat(join(state,'recovery-required.json'));throw Error('Cleanup blocked by recovery marker')}catch(error){if(error.code!=='ENOENT')throw error}
  const dir=await lstat(attempt),candidate=join(attempt,'candidate'),archive=join(attempt,'candidate.tar.gz'),mounts=await readMounts()
  if(!Array.isArray(mounts))throw Error('Cleanup mount inventory invalid')
  const optionalStat=async path=>{try{return await lstat(path)}catch(error){if(error.code==='ENOENT')return;throw error}}
  const candidateInfo=await optionalStat(candidate),archiveInfo=await optionalStat(archive)
  if(candidateInfo){if(!candidateInfo.isDirectory()||candidateInfo.isSymbolicLink()||candidateInfo.dev!==dir.dev||await realpath(candidate)!==candidate||mounts.some(m=>atOrBelow(m,candidate)))throw Error('Cleanup candidate redirected or mounted');await cleanupTreeCheck(candidate,dir.dev,rootProtected)}
  if(archiveInfo&&(!archiveInfo.isFile()||archiveInfo.isSymbolicLink()||archiveInfo.dev!==dir.dev||rootProtected&&(archiveInfo.uid!==0||archiveInfo.mode&0o022)||await realpath(archive)!==archive||mounts.some(m=>atOrBelow(m,archive))))throw Error('Cleanup archive redirected or mounted')
  // Persist the successful receipt before deleting recoverable temporary bytes.
  await syncDir(attempt)
  if(candidateInfo){await rm(candidate,{recursive:true});await syncDir(attempt)}
  if(archiveInfo){await rm(archive);await syncDir(attempt)}
  return {status:'cleaned'}
 }catch{return {status:'not-cleaned'}}
}
async function copyExclusive(from,to,limit,mode=0o600){
 const f=await open(from,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
 try{const s=await f.stat();if(!s.isFile()||s.size<1||s.size>limit)throw Error('Source file type or budget invalid');let size=0
  await pipeline(f.createReadStream({autoClose:false}),new Transform({transform(chunk,_enc,cb){size+=chunk.length;cb(size>limit?Error('Copy budget exceeded'):null,chunk)}}),createWriteStream(to,{flags:'wx',mode}))
 }finally{await f.close()}
 const output=await open(to,'r+');try{await output.sync()}finally{await output.close()}
}
async function trustedAncestors(path){for(let p=path;;p=dirname(p)){const s=await lstat(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))throw Error('Control plane directory is not root protected');if(p==='/')return}}
async function trustedFile(path,{privateFile=false,executable=false}={}){
 await trustedAncestors(dirname(path));const s=await lstat(path)
 if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)||await realpath(path)!==path||privateFile&&(s.mode&0o077)||executable&&!(s.mode&0o100))throw Error('Control plane file permissions invalid')
 return s
}
async function trustedExecutable(path){
 await trustedAncestors(dirname(path));const canonical=await realpath(path)
 await trustedFile(canonical,{executable:true});return canonical
}
export async function finalizeControlPlaneAttempt({lock,owner,attemptDirectory,state}){
 if(state.uncertain)return {retained:true}
 if(await resultPending(dirname(attemptDirectory))||await existsEntry(join(dirname(attemptDirectory),'recovery-required.json')))return {retained:true}
 let safe=true
 try{await lstat(join(attemptDirectory,'start-intent.json'))
  try{const result=JSON.parse(await readFile(join(attemptDirectory,'result.json'),'utf8'));if(typeof result.ok!=='boolean'||result.rollback==='subprocess-cleanup-unconfirmed')safe=false
   if(!result.ok&&(result.rollback?.includes('manual-recovery')||result.rollback?.startsWith('recovery-failed')))await lstat(join(dirname(lock),'recovery-required.json'))
  }catch{safe=false}
 }catch(error){if(error.code!=='ENOENT')safe=false}
 const current=JSON.parse(await readFile(join(lock,'owner.json'),'utf8'))
 if(!safe||state.uncertain||current.pid!==owner.pid||current.releaseId!==owner.releaseId||current.archiveSHA!==owner.archiveSHA||current.environment!==owner.environment||current.token!==owner.token)return {retained:true}
 await rm(join(lock,'owner.json'));await rmdir(lock);return {retained:false}
}
// The default is used only by independently invoked migration inspection.
const run=createDeploymentCommandRunner({profile:'control'}).run
export const MIGRATION_INSPECT_PYTHON=`import sys,zipfile,json,hashlib,re
z=zipfile.ZipFile(sys.argv[1]); entries=z.infolist(); assert len(entries)<100000
prefix='BOOT-INF/classes/db/migration/'; found={}
for e in entries:
 if not e.filename.startswith(prefix) or e.is_dir(): continue
 name=e.filename[len(prefix):]; assert re.fullmatch(r'V[0-9][A-Za-z0-9_.-]*__[^/\\\\]+\\.sql',name), 'Unexpected migration filename'
 assert name not in found and e.file_size<=8000000 and e.compress_size<=8000000
 found[name]=hashlib.sha256(z.read(e)).hexdigest()
assert 0<len(found)<=1000
print(json.dumps(found))`
export async function inspectJarMigrations(jar,runner=run,pythonExecutable='/usr/bin/python3'){return JSON.parse(await runner(pythonExecutable,['-c',MIGRATION_INSPECT_PYTHON,jar],{maxOutput:200000}))}
export async function probeJavaReadiness(origin,key,expectedSHA,{fetcher=fetch,timeoutMs=2500}={}){
 const response=await fetcher(origin+'/internal/flymind/readyz',{headers:{'X-FlyMind-Gateway-Key':key},signal:AbortSignal.timeout(timeoutMs),redirect:'error'})
 if(response.status!==200||!response.body)throw Error('Java not ready')
 const reader=response.body.getReader(),chunks=[];let size=0
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096)throw Error('Java readiness body budget exceeded');chunks.push(Buffer.from(value))}}
 catch(error){await reader.cancel().catch(()=>{});throw error}finally{reader.releaseLock()}
 const data=JSON.parse(Buffer.concat(chunks).toString('utf8'))
 if(data.ready!==true||data.jarSha256!==expectedSHA)throw Error('Java readiness JAR identity mismatch')
}
export async function verifyDatabaseBackup(receipt,{directory,startedAfter,now=Date.now()},checkFile=async()=>{}){
 const keys=['file','sha256','bytes','startedAt','completedAt','consistent']
 if(!receipt||Object.keys(receipt).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(receipt,k))||!/^database-[a-zA-Z0-9_-]+\.sql\.gz$/.test(receipt.file??'')||!SHA.test(receipt.sha256??'')||!Number.isSafeInteger(receipt.bytes)||receipt.bytes<1||receipt.bytes>100_000_000_000||receipt.consistent!==true||!Number.isSafeInteger(receipt.startedAt)||!Number.isSafeInteger(receipt.completedAt)||receipt.startedAt<startedAfter||receipt.completedAt<receipt.startedAt||receipt.completedAt>now||now-receipt.completedAt>60000)throw Error('Fresh consistent database backup receipt required')
 const file=join(directory,receipt.file);await checkFile(file)
 const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size!==receipt.bytes||await realpath(file)!==file||await fileSHA(file)!==receipt.sha256)throw Error('Database backup bytes do not match receipt')
 return file
}
// Testable orchestration; CLI always performs root/config/archive checks first.
export async function executeControlPlaneRelease({config,release,jar,attemptDirectory},{service,ready,backup,checkBackupFile=async()=>{},now=Date.now,syncDir=syncDirectory,isUncertain=()=>false,markUncertain=()=>{}}){
 const log={...release,startedAt:now(),steps:[],ok:false},target=config.jarPath,old=join(attemptDirectory,'previous.jar'),next=join(dirname(target),'.flymind-next-'+randomUUID()+'.jar')
 let stopped=false,switched=false,startedNew=false,hadOld=false,localUncertain=false,resultStarted=false
 const uncertain=()=>localUncertain||isUncertain()
 const mark=()=>{localUncertain=true;markUncertain()}
 const stop=async()=>{await service('stop');if(await service('pid')!=='0')throw Error('Java writer still alive');stopped=true}
 const saveResult=async()=>{resultStarted=true;try{await writeControlPlaneResult(attemptDirectory,{...log,finishedAt:now()},{syncDir})}catch(error){mark();throw error}}
 try{
  try{const s=await lstat(target);if(!s.isFile()||s.isSymbolicLink())throw Error('Installed JAR is redirected');hadOld=true;log.previousJarSHA=await fileSHA(target)}catch(error){if(error.code!=='ENOENT')throw error}
  const initialPID=await service('pid');if(!/^[0-9]+$/.test(initialPID))throw Error('Initial Java PID invalid');log.wasRunning=initialPID!=='0'
  await stop();log.steps.push('writer-stopped');const stoppedAt=now()
  const databaseBackup=await backup();await verifyDatabaseBackup(databaseBackup,{directory:config.backupDirectory,startedAfter:stoppedAt,now:now()},checkBackupFile);log.databaseBackup=databaseBackup;log.steps.push('database-backup-verified')
  if(hadOld){await copyExclusive(target,old,2_000_000_000);if(await fileSHA(old)!==log.previousJarSHA)throw Error('Previous JAR changed while backing up')}
  await durableJSON(join(attemptDirectory,'backup.json'),{databaseBackup,previousJarSHA:log.previousJarSHA??null})
  await copyExclusive(jar,next,2_000_000_000,0o644);log.jarSHA=await fileSHA(next)
  if(log.jarSHA!==await fileSHA(jar))throw Error('JAR copy digest mismatch')
  await rename(next,target);switched=true;await syncDir(dirname(target));log.steps.push('jar-replaced')
  // Marker survives process termination. Do not blindly retry an uncertain migration.
  await durableJSON(join(attemptDirectory,'start-intent.json'),{jarSHA:log.jarSHA,at:now()});startedNew=true
  await service('start');await ready(log.jarSHA);log.steps.push('new-java-ready');log.ok=true
  await saveResult();return log
 }catch(error){
  log.ok=false;log.error=error.message
  if(uncertain())log.rollback='subprocess-cleanup-unconfirmed'
  else try{
   if(switched){await stop()
    if(hadOld&&(!startedNew||config.rollbackPolicy==='additive-compatible')){
     const rollback=join(dirname(target),'.flymind-rollback-'+randomUUID()+'.jar');await copyExclusive(old,rollback,2_000_000_000,0o644);await rename(rollback,target);await syncDir(dirname(target));await service('start');await ready(log.previousJarSHA);log.rollback='previous-jar-current-database'
    }else log.rollback='service-stopped-manual-recovery-required'
   }else if(stopped&&hadOld&&log.wasRunning){
    if(await fileSHA(target)!==log.previousJarSHA)throw Error('Unchanged previous JAR no longer matches')
    await service('start');const pid=await service('pid')
    if(!/^[1-9][0-9]*$/.test(pid)||await fileSHA(target)!==log.previousJarSHA)throw Error('Previous service restart not confirmed')
    log.rollback='previous-service-restarted-health-unverified'
   }else if(stopped&&!log.wasRunning)log.rollback='previous-service-remained-stopped'
  }catch{if(uncertain())log.rollback='subprocess-cleanup-unconfirmed';else{log.rollback='recovery-failed-service-state-must-be-reviewed';try{await stop()}catch{if(uncertain())log.rollback='subprocess-cleanup-unconfirmed'}}}
  if(!resultStarted)await saveResult()
  if(log.rollback?.includes('manual-recovery')||log.rollback?.startsWith('recovery-failed')||log.rollback==='subprocess-cleanup-unconfirmed')try{await writeControlPlaneRecovery(config.stateDirectory,{...release,at:now(),reason:log.rollback},{syncDir})}catch(markerError){mark();throw markerError}
  throw error
 }finally{if(!uncertain())await rm(next,{force:true})}
}
export async function promoteControlPlane(argv=process.argv.slice(2)){
 const release=validateControlPlaneArguments(argv)
 if(process.platform!=='linux'||process.getuid?.()!==0)throw Error('Only the installed Linux root dispatcher may publish Java')
 const commandRunner=createDeploymentCommandRunner({profile:'control'}),run=commandRunner.run
 const configFile='/etc/flymind/'+release.environment+'/control-plane-deployment.json';await trustedFile(configFile,{privateFile:true})
 const config=validateControlPlaneConfig(JSON.parse(await readFile(configFile,'utf8')))
 const python=await trustedExecutable(config.pythonExecutable)
 for(const key of ['stateDirectory','backupDirectory'])await trustedAncestors(config[key])
 await assertControlPlaneRecoveryReady(config.stateDirectory)
 await assertControlPlaneResultReady(config.stateDirectory)
 for(const path of [dirname(config.incomingDirectory),dirname(config.jarPath)])await trustedAncestors(path)
 const incoming=await lstat(config.incomingDirectory);if(!incoming.isDirectory()||incoming.isSymbolicLink()||await realpath(config.incomingDirectory)!==config.incomingDirectory)throw Error('Incoming directory redirected')
 await trustedFile(config.environmentFile,{privateFile:true});await trustedFile(config.backupHelper,{executable:true});await trustedFile(config.readinessKeyFile,{privateFile:true})
 const readinessKey=(await readFile(config.readinessKeyFile,'utf8')).trim()
 if(Buffer.byteLength(readinessKey)<32||Buffer.byteLength(readinessKey)>512||/[\r\n]/.test(readinessKey))throw Error('Readiness credential invalid')
 try{await trustedFile(config.jarPath)}catch(error){if(error.code!=='ENOENT')throw error}
 const env=await readFile(config.environmentFile,'utf8')
 for(const line of env.split(/\r?\n/))if(/^\s*FLYMIND_BOOTSTRAP_ENABLED\s*=/.test(line)&&!/^\s*FLYMIND_BOOTSTRAP_ENABLED\s*=\s*(?:false|"false"|'false')\s*$/.test(line))throw Error('Bootstrap must remain disabled')
 const serviceEnv=await run('/usr/bin/systemctl',['show','--property=Environment','--value',config.service])
 const exec=await run('/usr/bin/systemctl',['show','--property=ExecStart','--value',config.service])
 if(/FLYMIND_BOOTSTRAP_ENABLED=(?!false(?:\s|$))/.test(serviceEnv)||/flymind\.bootstrap\.enabled=(?!false(?:\s|;|$))/.test(exec))throw Error('Service must not enable bootstrap')
 const service=async action=>run('/usr/bin/systemctl',action==='pid'?['show','--property=MainPID','--value',config.service]:[action,config.service])
 const ready=async expectedSHA=>{
  const deadline=Date.now()+90000
  while(Date.now()<deadline){try{await probeJavaReadiness(config.readinessOrigin,readinessKey,expectedSHA);if(await service('pid')!=='0')return}catch(error){if(commandRunner.state.uncertain)throw error}
   await new Promise(r=>setTimeout(r,1000))
  }throw Error('Java readiness deadline exceeded')
 }
 const lock=join(config.stateDirectory,'.control-plane.lock');await mkdir(lock,{mode:0o700})
 const owner={pid:process.pid,...release,token:randomUUID(),startedAt:Date.now()};await durableJSON(join(lock,'owner.json'),owner)
 const attemptDirectory=join(config.stateDirectory,release.releaseId),archive=join(attemptDirectory,'candidate.tar.gz'),candidate=join(attemptDirectory,'candidate')
 let createdAttempt=false
 try{
  // Exclusive directory means retries cannot rerun an uncertain migration.
  try{await mkdir(attemptDirectory,{mode:0o700});createdAttempt=true}catch(error){if(error.code!=='EEXIST')throw error
   try{await assertControlPlaneResultReady(config.stateDirectory)}catch(error){commandRunner.state.uncertain=true;throw error}
   const prior=JSON.parse(await readFile(join(attemptDirectory,'result.json'),'utf8'))
   if(prior.ok&&prior.archiveSHA===release.archiveSHA&&prior.environment===release.environment&&await fileSHA(config.jarPath)===prior.jarSHA){await ready(prior.jarSHA);const cleanup=await cleanupSuccessfulAttempt({config,release});console.log(JSON.stringify({ok:true,releaseId:release.releaseId,replayed:true,cleanup:cleanup.status}));return}
   throw Error('Java release already attempted; inspect protected receipt before recovery')
  }
  await copyExclusive(join(config.incomingDirectory,release.releaseId+'.tar.gz'),archive,4_000_000_000)
  if(await fileSHA(archive)!==release.archiveSHA)throw Error('Candidate archive digest mismatch')
  await mkdir(candidate,{mode:0o755})
  await materializeCandidate({archive,destination:candidate,environment:release.environment,python,run,requireRootOwned:true})
  const {verifyCandidate}=await import('./verify-cloud-candidate.mjs'),manifest=await verifyCandidate(candidate,{requireRootOwned:true})
  if(manifest.releaseId!==release.releaseId||manifest.release?.migrationLevel!==1)throw Error('Candidate release identity/migration level mismatch')
  release.sourceCommit=manifest.sourceCommit
  const jar=join(candidate,'control-plane/system-admin.jar');await trustedFile(jar);verifyMigrationInventory(await inspectJarMigrations(jar,run,python),config.allowedMigrations)
  await executeControlPlaneRelease({config,release,jar,attemptDirectory},{service,ready,backup:async()=>JSON.parse(await run(config.backupHelper,[],{timeoutMs:300000})),checkBackupFile:file=>trustedFile(file,{privateFile:true}),isUncertain:()=>commandRunner.state.uncertain,markUncertain:()=>{commandRunner.state.uncertain=true}})
  const cleanup=await cleanupSuccessfulAttempt({config,release});console.log(JSON.stringify({ok:true,releaseId:release.releaseId,cleanup:cleanup.status}))
 }catch(error){
  if(createdAttempt)try{if(await resultPending(config.stateDirectory)){commandRunner.state.uncertain=true;throw Error('Pending result')}await lstat(join(attemptDirectory,'result.json'))}catch(receiptError){
   if(receiptError.code==='ENOENT')try{await writeControlPlaneResult(attemptDirectory,{...release,ok:false,steps:[],error:'CONTROL_PLANE_RELEASE_FAILED',...(commandRunner.state.uncertain?{rollback:'subprocess-cleanup-unconfirmed'}:{}),finishedAt:Date.now()})}catch{commandRunner.state.uncertain=true}
   else commandRunner.state.uncertain=true
  }
  if(commandRunner.state.uncertain)try{await writeControlPlaneRecovery(config.stateDirectory,{...release,at:Date.now(),reason:'subprocess-cleanup-unconfirmed'})}catch{/* Keep the lock if the marker cannot be persisted. */}
  throw error
 }finally{await finalizeControlPlaneAttempt({lock,owner,attemptDirectory,state:commandRunner.state})}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await promoteControlPlane()
