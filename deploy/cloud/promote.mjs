#!/usr/bin/env node
// Root-owned, fixed-command deployment dispatcher. SSH accounts must not be root
// or Docker-group members. This script never restores a live database implicitly.
import {mkdir,readFile,writeFile,lstat,realpath,symlink,rename,rm,rmdir,cp,chmod,open,opendir} from 'node:fs/promises'
import {createReadStream,createWriteStream,constants} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import {Transform} from 'node:stream'
import {createHash,randomUUID} from 'node:crypto'
import {request as httpRequest} from 'node:http'
import {request as httpsRequest} from 'node:https'
import {resolve,join,dirname,sep,posix} from 'node:path'
import {pathToFileURL} from 'node:url'
import {materializeCandidate,createDeploymentCommandRunner} from './materialize-candidate.mjs'
export function validateDeploymentConfig(config){
 const required=['releaseRoot','currentLink','incomingDirectory','dataRoot','backupDirectory','stateDirectory','applicationService','publicOrigin','applicationOrigin']
 if(!config||Object.keys(config).some(k=>!required.includes(k))||required.some(k=>typeof config[k]!=='string'||!config[k]))throw Error('Deployment config invalid')
 const paths=required.filter(k=>!['applicationService','publicOrigin','applicationOrigin'].includes(k))
 for(const key of paths)if(!config[key].startsWith('/')||posix.resolve(config[key])!==config[key]||config[key]==='/'||config[key].includes('\0'))throw Error('Deployment path invalid: '+key)
 for(const a of paths)for(const b of paths)if(a!==b&&(config[a]===config[b]||config[a].startsWith(config[b]+'/')))throw Error('Deployment paths must not overlap')
 if(!/^flymind-[a-zA-Z0-9-]+\.service$/.test(config.applicationService))throw Error('Service name invalid')
 const publicURL=new URL(config.publicOrigin),appURL=new URL(config.applicationOrigin)
 if(publicURL.username||publicURL.password||appURL.username||appURL.password||publicURL.protocol!=='https:'||publicURL.origin!==config.publicOrigin||appURL.origin!==config.applicationOrigin||appURL.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(appURL.hostname))throw Error('Expected HTTPS public origin and fixed same-host application origin')
 return {publicURL,appURL}
}
// The caller must stop the writer and validate the trusted, non-overlapping roots.
export async function backupStoppedData(source,destination){
 const sourceInfo=await lstat(source)
 if(sourceInfo.isSymbolicLink())throw Error('Data backup refuses redirected paths')
 if(!sourceInfo.isDirectory())throw Error('Data backup source must be a directory')
 await mkdir(destination,{mode:0o700})
 // Do not intentionally share COW extents for user data backups: a damaged
 // shared block can affect both copies. This is still a same-host backup, not
 // an independent failure domain; retain a separate verified backup as well.
 // Node 22.23 rejects COPYFILE_EXCL when cp's directory target already exists,
 // including this deliberately reserved root. Copy its children exclusively.
 for await(const entry of await opendir(source))await cp(join(source,entry.name),join(destination,entry.name),{recursive:true,errorOnExist:true,force:false,dereference:false,mode:constants.COPYFILE_EXCL,filter:async path=>{if((await lstat(path)).isSymbolicLink())throw Error('Data backup refuses redirected paths');return true}})
 await chmod(destination,0o700)
}
async function syncDirectory(path){const file=await open(path,'r');try{await file.sync()}finally{await file.close()}}
async function pendingReceipt(path){try{await lstat(path);return true}catch(error){if(error.code==='ENOENT')return false;throw error}}
async function anyApplicationReceiptPending(directory){
 const started=Date.now();let count=0,handle=await opendir(directory)
 try{for await(const entry of handle){handle=undefined;if(++count>100000||Date.now()-started>5000)throw Error('Receipt inventory incomplete');if(entry.name.endsWith('.receipt-pending.json')||entry.name==='.application-receipt-pending.json')return true}return false}
 finally{await handle?.close().catch(()=>{})}
}
export async function assertApplicationReceiptReady(marker){if(await anyApplicationReceiptPending(dirname(marker)))throw Error('Release receipt requires recovery')}
async function writeExclusiveSynced(path,value,openFile=open){const file=await openFile(path,'wx',0o600);try{await file.writeFile(JSON.stringify(value,null,2));await file.sync()}finally{await file.close()}}
/** Pending marker is durable before any possibly partial public receipt. */
export async function writeApplicationReceipt({path,marker,value,allowExistingSuccess=false},{openFile=open,syncDir=syncDirectory}={}){
 await assertApplicationReceiptReady(marker)
 await writeExclusiveSynced(marker,{pending:true,releaseId:value.releaseId,archiveSHA:value.archiveSHA},openFile)
 await syncDir(dirname(marker))
 try{await writeExclusiveSynced(path,value,openFile)}catch(error){
  if(error.code!=='EEXIST'||!allowExistingSuccess||value.ok!==true)throw error
  const before=await lstat(path)
  if(!before.isFile()||before.isSymbolicLink()||before.size>65536)throw Error('Existing release receipt invalid')
  const file=await openFile(path,constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK)
  try{const info=await file.stat();if(!info.isFile()||info.dev!==before.dev||info.ino!==before.ino)throw Error('Existing release receipt changed')
   const prior=JSON.parse(await file.readFile('utf8'))
   if(prior.ok!==true||prior.releaseId!==value.releaseId||prior.archiveSHA!==value.archiveSHA||prior.environment!==value.environment)throw Error('Existing release receipt mismatch')
   await file.sync()
   const after=await file.stat(),pathAfter=await lstat(path)
   if(!pathAfter.isFile()||pathAfter.isSymbolicLink()||after.dev!==info.dev||after.ino!==info.ino||pathAfter.dev!==info.dev||pathAfter.ino!==info.ino||after.size!==info.size||after.mtimeMs!==info.mtimeMs)throw Error('Existing release receipt changed')
  }finally{await file.close()}
 }
 await syncDir(dirname(path))
 await rm(marker)
 await syncDir(dirname(marker))
}
/** An uncertain operation or unowned lock must retain both lock and scratch. */
export async function finalizeApplicationAttempt({lock,owner,stagedArchive,receiptPersisted,state,marker}){
 if(state.uncertain||!receiptPersisted||marker&&(await anyApplicationReceiptPending(dirname(marker))||await pendingReceipt(join(dirname(marker),'recovery-required.json'))))return {retained:true}
 const matches=value=>value.pid===owner.pid&&value.releaseId===owner.releaseId&&value.archiveSHA===owner.archiveSHA&&value.token===owner.token
 const current=JSON.parse(await readFile(join(lock,'owner.json'),'utf8'))
 if(!matches(current))return {retained:true}
 await rm(stagedArchive,{force:true})
 if(state.uncertain||marker&&(await anyApplicationReceiptPending(dirname(marker))||await pendingReceipt(join(dirname(marker),'recovery-required.json')))||!matches(JSON.parse(await readFile(join(lock,'owner.json'),'utf8'))))return {retained:true}
 await rm(join(lock,'owner.json'));await rmdir(lock);return {retained:false}
}
export async function recoverApplicationFailure({state,switched,stopped,oldTarget,restore,restart}){
 if(state.uncertain)return 'subprocess-cleanup-unconfirmed'
 if(switched)try{return await restore()}catch(error){state.uncertain=true;return 'failed: '+error.message}
 if(stopped&&oldTarget)try{await restart();return 'previous-service-restarted'}catch{state.uncertain=true;return 'manual-recovery-required'}
}
export async function writeApplicationRecovery(stateDirectory,value,{syncDir=syncDirectory}={}){
 const marker=join(stateDirectory,'recovery-required.json')
 await writeExclusiveSynced(marker,value)
 await syncDir(stateDirectory)
}
export async function assertApplicationRecoveryReady(stateDirectory){if(await pendingReceipt(join(stateDirectory,'recovery-required.json')))throw Error('Application recovery requires console review')}
export async function promote(argv=process.argv.slice(2)){
const {verifyCandidate:verify}=await import('./verify-cloud-candidate.mjs')
const verifyCandidate=directory=>verify(directory,{requireRootOwned:true})
const [environment,releaseId,archiveSHA]=argv
if(argv.length!==3||process.platform!=='linux'||process.getuid?.()!==0||!['staging','production'].includes(environment)||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(releaseId??'')||!/^[a-f0-9]{64}$/.test(archiveSHA??''))throw Error('Use the configured Linux dispatcher: <staging|production> <releaseId> <archiveSHA256>')
async function trustedAncestors(path){for(let directory=path;;directory=dirname(directory)){const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==0||(info.mode&0o022))throw Error('Deployment ancestor must be root-owned and not writable by uploaders');if(directory==='/')return}}
const configPath='/etc/flymind/'+environment+'/deployment.json';await trustedAncestors(dirname(configPath));const configStat=await lstat(configPath)
if(!configStat.isFile()||configStat.isSymbolicLink()||configStat.uid!==0||(configStat.mode&0o022))throw Error('Deployment config must be root-owned and not group/world writable')
const config=JSON.parse(await readFile(configPath,'utf8')),{publicURL,appURL}=validateDeploymentConfig(config)
const commandRunner=createDeploymentCommandRunner({profile:'application'}),run=commandRunner.run
// Provision explicitly: never create the application's data root as root:0700.
for(const key of ['releaseRoot','incomingDirectory','dataRoot','backupDirectory','stateDirectory']){const info=await lstat(config[key]);if(!info.isDirectory()||info.isSymbolicLink()||await realpath(config[key])!==config[key])throw Error('Deployment directory redirects: '+key);if(!['dataRoot','incomingDirectory'].includes(key)&&(info.uid!==0||(info.mode&0o022)))throw Error('Deployment directory must be root-owned and immutable to uploaders: '+key)}
for(const key of ['releaseRoot','incomingDirectory','dataRoot','backupDirectory','stateDirectory'])await trustedAncestors(dirname(config[key]))
const dataInfo=await lstat(config.dataRoot);if(dataInfo.uid!==Number(await run('id',['-u','flymind']))||(dataInfo.mode&0o700)!==0o700||(dataInfo.mode&0o022))throw Error('dataRoot must be pre-provisioned owner-rwx and owned by flymind, not group/world writable')
if(((await lstat(config.releaseRoot)).mode&0o005)!==0o005)throw Error('releaseRoot must permit flymind read/traverse (normally root:0755)')
await trustedAncestors(dirname(config.currentLink));if(await realpath(dirname(config.currentLink))!==dirname(config.currentLink))throw Error('Current link parent must not redirect')
await assertApplicationRecoveryReady(config.stateDirectory)
await assertApplicationReceiptReady(join(config.stateDirectory,'.application-receipt-pending.json'))
const lock=join(config.stateDirectory,'.deploy.lock');await mkdir(lock,{mode:0o700});const owner={pid:process.pid,releaseId,archiveSHA,token:randomUUID(),startedAt:Date.now()};await writeFile(join(lock,'owner.json'),JSON.stringify(owner),{mode:0o600,flag:'wx'})
const candidate=join(config.releaseRoot,releaseId),archive=join(config.incomingDirectory,releaseId+'.tar.gz'),receipt=join(config.stateDirectory,releaseId+'.json')
const preparedReceipt=join(config.stateDirectory,releaseId+'.prepared.json')
const receiptMarker=join(config.stateDirectory,'.application-receipt-pending.json')
const stagedArchive=join(config.stateDirectory,'.archive-'+randomUUID()+'.tar.gz')
let stopped=false,switched=false,oldTarget,receiptPersisted=false
const log={releaseId,archiveSHA,environment,startedAt:Date.now(),steps:[]}
async function ready(expected){let last='not ready';for(let attempt=0;attempt<40;attempt++){try{const value=await new Promise((yes,no)=>{const url=new URL('/readyz',appURL),request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{headers:{Host:publicURL.host},timeout:2500},response=>{let data='';response.on('data',part=>{data+=part;if(data.length>16384)response.destroy()});response.on('error',no);response.once('end',()=>{try{if(response.statusCode!==200)throw Error('not ready');yes(JSON.parse(data))}catch(error){no(error)}})});request.once('error',no);request.once('timeout',()=>request.destroy(Error('readiness timeout')));request.end()});if(value.ready&&value.releaseId===expected)return;last='wrong release or not ready'}catch(error){last=error.message}await new Promise(r=>setTimeout(r,1000))}throw Error('Readiness failed: '+last)}
try{
 try{await assertApplicationReceiptReady(receiptMarker)}catch(error){commandRunner.state.uncertain=true;throw error}
 const source=await open(archive,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
 try{if(!(await source.stat()).isFile())throw Error('Archive must be a regular file');let copied=0;await pipeline(source.createReadStream({autoClose:false}),new Transform({transform(chunk,_encoding,callback){copied+=chunk.length;callback(copied>4_000_000_000?Error('Archive budget exceeded'):null,chunk)}}),createWriteStream(stagedArchive,{flags:'wx',mode:0o600}))}finally{await source.close()}
 const hash=createHash('sha256');for await(const bytes of createReadStream(stagedArchive))hash.update(bytes);if(hash.digest('hex')!==archiveSHA)throw Error('Archive digest mismatch')
 try{const prior=JSON.parse(await readFile(preparedReceipt,'utf8'));if(prior.archiveSHA!==archiveSHA)throw Error('Release id reused for another archive');await verifyCandidate(candidate)}catch(error){if(error.code!=='ENOENT')throw error;await mkdir(candidate,{mode:0o755});
  await materializeCandidate({archive:stagedArchive,destination:candidate,environment,python:'python3',run,requireRootOwned:true});await verifyCandidate(candidate)
  await writeFile(preparedReceipt,JSON.stringify({releaseId,archiveSHA}),{flag:'wx',mode:0o600})
 }
 const manifest=await verifyCandidate(candidate);if(manifest.releaseId!==releaseId||manifest.release?.migrationLevel!==1)throw Error('Release identity mismatch or unsupported migration level')
 try{const current=await lstat(config.currentLink);if(!current.isSymbolicLink())throw Error('Current installation must be a managed release symlink');oldTarget=await realpath(config.currentLink);if(!oldTarget.startsWith(config.releaseRoot+sep))throw Error('Current release leaves configured release root');const prior=await verifyCandidate(oldTarget);if(prior.release?.migrationLevel!==manifest.release.migrationLevel)throw Error('Migration requires a separate tested upgrade, not blind rollback');if(oldTarget===candidate)await ready(releaseId)}
 catch(error){if(error.code!=='ENOENT')throw error}
 if(oldTarget===candidate){log.steps.push('already-current')}
 else{
  await run('systemctl',['stop',config.applicationService]);stopped=true
  if(await run('systemctl',['show','--property=MainPID','--value',config.applicationService])!=='0')throw Error('Old writer still alive; replacement forbidden')
  log.steps.push('old-writer-stopped')
  const backup=join(config.backupDirectory,releaseId+'-'+Date.now());await backupStoppedData(config.dataRoot,backup);log.backup=backup
  const temporary=config.currentLink+'.next-'+randomUUID();await symlink(candidate,temporary,'dir');await rename(temporary,config.currentLink);switched=true;log.steps.push('symlink-switched')
  await run('systemctl',['start',config.applicationService]);await ready(releaseId);log.steps.push('new-release-ready')
 }
 log.ok=true;try{await writeApplicationReceipt({path:receipt,marker:receiptMarker,value:{...log,finishedAt:Date.now()},allowExistingSuccess:true})}catch(error){commandRunner.state.uncertain=true;throw error}receiptPersisted=true;console.log(JSON.stringify({ok:true,releaseId}))
}catch(error){
 log.ok=false;log.error=error.message
 log.rollback=await recoverApplicationFailure({state:commandRunner.state,switched,stopped,oldTarget,
  restore:async()=>{await run('systemctl',['stop',config.applicationService]);if(await run('systemctl',['show','--property=MainPID','--value',config.applicationService])!=='0')throw Error('New writer still alive');if(oldTarget){const temporary=config.currentLink+'.rollback-'+randomUUID();await symlink(oldTarget,temporary,'dir');await rename(temporary,config.currentLink);await run('systemctl',['start',config.applicationService]);const oldManifest=await verifyCandidate(oldTarget);await ready(oldManifest.releaseId);return 'previous-code-restored-with-current-data'}return 'new-service-stopped; no-previous-release'},
  restart:()=>run('systemctl',['start',config.applicationService])})
 if(commandRunner.state.uncertain)try{await writeApplicationRecovery(config.stateDirectory,{releaseId,archiveSHA,environment,reason:log.rollback,at:Date.now()})}catch{/* Keep the lock even if the marker cannot be written. */}
 try{await assertApplicationReceiptReady(receiptMarker);await writeApplicationReceipt({path:join(config.stateDirectory,releaseId+'.failed-'+Date.now()+'.json'),marker:receiptMarker,value:log});receiptPersisted=true}catch(receiptError){commandRunner.state.uncertain=true;throw receiptError}
 throw error
}finally{await finalizeApplicationAttempt({lock,owner,stagedArchive,receiptPersisted,state:commandRunner.state,marker:receiptMarker})}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await promote()
