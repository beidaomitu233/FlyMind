#!/usr/bin/env node
// Install this file and its verifier from reviewed source, never from candidate ops.
import {readFile,writeFile,lstat,realpath,mkdir,open,rename,rm,rmdir,chmod} from 'node:fs/promises'
import {createReadStream,createWriteStream,constants} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import {Transform} from 'node:stream'
import {createHash,randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {dirname,join,resolve,posix,sep} from 'node:path'
import {pathToFileURL} from 'node:url'

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
// Bounded privileged subprocess. Never include child stdout/stderr in public errors.
async function run(command,args,{timeoutMs=300000,maxOutput=32768}={}){
 return new Promise((yes,no)=>{
  const child=spawn(command,args,{shell:false,windowsHide:true,detached:true,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C.UTF-8'}})
  let output='',settled=false
  const kill=()=>{try{process.kill(-child.pid,'SIGKILL')}catch{child.kill('SIGKILL')}}
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?no(error):yes(value)}
  const timer=setTimeout(()=>{kill();finish(Error('Control plane subprocess deadline exceeded'))},timeoutMs)
  child.stdout.on('data',chunk=>{output+=chunk;if(Buffer.byteLength(output)>maxOutput){kill();finish(Error('Control plane subprocess output budget exceeded'))}})
  child.stderr.resume();child.once('error',()=>finish(Error('Control plane subprocess could not start')));child.once('close',code=>finish(code===0?null:Error('Control plane subprocess failed'),output.trim()))
 })
}
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
export async function executeControlPlaneRelease({config,release,jar,attemptDirectory},{service,ready,backup,checkBackupFile=async()=>{},now=Date.now,syncDir=syncDirectory}){
 const log={...release,startedAt:now(),steps:[],ok:false},target=config.jarPath,old=join(attemptDirectory,'previous.jar'),next=join(dirname(target),'.flymind-next-'+randomUUID()+'.jar')
 let stopped=false,switched=false,startedNew=false,hadOld=false
 const stop=async()=>{await service('stop');if(await service('pid')!=='0')throw Error('Java writer still alive');stopped=true}
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
  await durableJSON(join(attemptDirectory,'result.json'),{...log,finishedAt:now()});return log
 }catch(error){
  log.error=error.message
  try{
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
  }catch{log.rollback='recovery-failed-service-state-must-be-reviewed';try{await stop()}catch{}}
  await durableJSON(join(attemptDirectory,'result.json'),{...log,finishedAt:now()})
  if(log.rollback?.includes('manual-recovery')||log.rollback?.startsWith('recovery-failed'))await durableJSON(join(config.stateDirectory,'recovery-required.json'),{...release,at:now(),reason:log.rollback})
  throw error
 }finally{await rm(next,{force:true})}
}
export async function promoteControlPlane(argv=process.argv.slice(2)){
 const release=validateControlPlaneArguments(argv)
 if(process.platform!=='linux'||process.getuid?.()!==0)throw Error('Only the installed Linux root dispatcher may publish Java')
 const configFile='/etc/flymind/'+release.environment+'/control-plane-deployment.json';await trustedFile(configFile,{privateFile:true})
 const config=validateControlPlaneConfig(JSON.parse(await readFile(configFile,'utf8')))
 const python=await trustedExecutable(config.pythonExecutable)
 for(const key of ['stateDirectory','backupDirectory'])await trustedAncestors(config[key])
 try{await lstat(join(config.stateDirectory,'recovery-required.json'));throw Error('Java manual recovery marker must be resolved in server console')}catch(error){if(error.code!=='ENOENT')throw error}
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
  while(Date.now()<deadline){try{await probeJavaReadiness(config.readinessOrigin,readinessKey,expectedSHA);if(await service('pid')!=='0')return}catch{}
   await new Promise(r=>setTimeout(r,1000))
  }throw Error('Java readiness deadline exceeded')
 }
 const lock=join(config.stateDirectory,'.control-plane.lock');await mkdir(lock,{mode:0o700})
 await durableJSON(join(lock,'owner.json'),{pid:process.pid,...release,startedAt:Date.now()})
 const attemptDirectory=join(config.stateDirectory,release.releaseId),archive=join(attemptDirectory,'candidate.tar.gz'),candidate=join(attemptDirectory,'candidate')
 try{
  // Exclusive directory means retries cannot rerun an uncertain migration.
  try{await mkdir(attemptDirectory,{mode:0o700})}catch(error){if(error.code!=='EEXIST')throw error
   const prior=JSON.parse(await readFile(join(attemptDirectory,'result.json'),'utf8'))
   if(prior.ok&&prior.archiveSHA===release.archiveSHA&&prior.environment===release.environment&&await fileSHA(config.jarPath)===prior.jarSHA){await ready(prior.jarSHA);console.log(JSON.stringify({ok:true,releaseId:release.releaseId,replayed:true}));return}
   throw Error('Java release already attempted; inspect protected receipt before recovery')
  }
  await copyExclusive(join(config.incomingDirectory,release.releaseId+'.tar.gz'),archive,4_000_000_000)
  if(await fileSHA(archive)!==release.archiveSHA)throw Error('Candidate archive digest mismatch')
  await mkdir(candidate,{mode:0o755})
  const extract="import sys,tarfile,pathlib; assert hasattr(tarfile,'data_filter'); t=tarfile.open(sys.argv[1]); m=t.getmembers(); assert len(m)<100000 and sum(x.size for x in m)<4000000000; assert all(not x.name.startswith('/') and not any(p=='..' for p in pathlib.PurePosixPath(x.name).parts) and chr(92) not in x.name and ':' not in x.name for x in m); t.extractall(sys.argv[2],filter='data')"
  await run(python,['-c',extract,archive,candidate])
  const {verifyCandidate}=await import('./verify-cloud-candidate.mjs'),manifest=await verifyCandidate(candidate,{requireRootOwned:true})
  if(manifest.releaseId!==release.releaseId||manifest.release?.migrationLevel!==1)throw Error('Candidate release identity/migration level mismatch')
  release.sourceCommit=manifest.sourceCommit
  const jar=join(candidate,'control-plane/system-admin.jar');await trustedFile(jar);verifyMigrationInventory(await inspectJarMigrations(jar,run,python),config.allowedMigrations)
  await executeControlPlaneRelease({config,release,jar,attemptDirectory},{service,ready,backup:async()=>JSON.parse(await run(config.backupHelper,[],{timeoutMs:300000})),checkBackupFile:file=>trustedFile(file,{privateFile:true})})
  console.log(JSON.stringify({ok:true,releaseId:release.releaseId}))
 }finally{
  let safe=true
  try{await lstat(join(attemptDirectory,'start-intent.json'))
   try{const result=JSON.parse(await readFile(join(attemptDirectory,'result.json'),'utf8'));if(typeof result.ok!=='boolean')safe=false
    if(!result.ok&&(result.rollback?.includes('manual-recovery')||result.rollback?.startsWith('recovery-failed')))await lstat(join(config.stateDirectory,'recovery-required.json'))
   }catch{safe=false}
  }catch(error){if(error.code!=='ENOENT')safe=false}
  const owner=JSON.parse(await readFile(join(lock,'owner.json'),'utf8'));if(safe&&owner.pid===process.pid&&owner.releaseId===release.releaseId){await rm(join(lock,'owner.json'));await rmdir(lock)}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await promoteControlPlane()
