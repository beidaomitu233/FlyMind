#!/usr/bin/env node
// Root-owned, fixed-command deployment dispatcher. SSH accounts must not be root
// or Docker-group members. This script never restores a live database implicitly.
import {mkdir,readFile,writeFile,lstat,realpath,symlink,rename,rm,rmdir,cp,chmod,open} from 'node:fs/promises'
import {createReadStream,createWriteStream,constants} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import {Transform} from 'node:stream'
import {createHash,randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {request as httpRequest} from 'node:http'
import {request as httpsRequest} from 'node:https'
import {resolve,join,dirname,sep,posix} from 'node:path'
import {pathToFileURL} from 'node:url'
import {materializeCandidate} from './materialize-candidate.mjs'
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
export async function promote(argv=process.argv.slice(2)){
const {verifyCandidate:verify}=await import('./verify-cloud-candidate.mjs')
const verifyCandidate=directory=>verify(directory,{requireRootOwned:true})
const [environment,releaseId,archiveSHA]=argv
if(argv.length!==3||process.platform!=='linux'||process.getuid?.()!==0||!['staging','production'].includes(environment)||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(releaseId??'')||!/^[a-f0-9]{64}$/.test(archiveSHA??''))throw Error('Use the configured Linux dispatcher: <staging|production> <releaseId> <archiveSHA256>')
async function trustedAncestors(path){for(let directory=path;;directory=dirname(directory)){const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==0||(info.mode&0o022))throw Error('Deployment ancestor must be root-owned and not writable by uploaders');if(directory==='/')return}}
const configPath='/etc/flymind/'+environment+'/deployment.json';await trustedAncestors(dirname(configPath));const configStat=await lstat(configPath)
if(!configStat.isFile()||configStat.isSymbolicLink()||configStat.uid!==0||(configStat.mode&0o022))throw Error('Deployment config must be root-owned and not group/world writable')
const config=JSON.parse(await readFile(configPath,'utf8')),{publicURL,appURL}=validateDeploymentConfig(config)
// Provision explicitly: never create the application's data root as root:0700.
for(const key of ['releaseRoot','incomingDirectory','dataRoot','backupDirectory','stateDirectory']){const info=await lstat(config[key]);if(!info.isDirectory()||info.isSymbolicLink()||await realpath(config[key])!==config[key])throw Error('Deployment directory redirects: '+key);if(!['dataRoot','incomingDirectory'].includes(key)&&(info.uid!==0||(info.mode&0o022)))throw Error('Deployment directory must be root-owned and immutable to uploaders: '+key)}
for(const key of ['releaseRoot','incomingDirectory','dataRoot','backupDirectory','stateDirectory'])await trustedAncestors(dirname(config[key]))
const dataInfo=await lstat(config.dataRoot);if(dataInfo.uid!==Number(await run('id',['-u','flymind']))||(dataInfo.mode&0o700)!==0o700||(dataInfo.mode&0o022))throw Error('dataRoot must be pre-provisioned owner-rwx and owned by flymind, not group/world writable')
if(((await lstat(config.releaseRoot)).mode&0o005)!==0o005)throw Error('releaseRoot must permit flymind read/traverse (normally root:0755)')
await trustedAncestors(dirname(config.currentLink));if(await realpath(dirname(config.currentLink))!==dirname(config.currentLink))throw Error('Current link parent must not redirect')
const lock=join(config.stateDirectory,'.deploy.lock');await mkdir(lock,{mode:0o700});await writeFile(join(lock,'owner.json'),JSON.stringify({pid:process.pid,releaseId,startedAt:Date.now()}),{mode:0o600})
const candidate=join(config.releaseRoot,releaseId),archive=join(config.incomingDirectory,releaseId+'.tar.gz'),receipt=join(config.stateDirectory,releaseId+'.json')
const preparedReceipt=join(config.stateDirectory,releaseId+'.prepared.json')
const stagedArchive=join(config.stateDirectory,'.archive-'+randomUUID()+'.tar.gz')
let stopped=false,switched=false,oldTarget
const log={releaseId,archiveSHA,environment,startedAt:Date.now(),steps:[]}
function run(command,args){return new Promise((yes,no)=>{const child=spawn(command,args,{stdio:['ignore','pipe','pipe'],shell:false,windowsHide:true,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C.UTF-8'}});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout=(stdout+chunk).slice(-16000));child.stderr.on('data',chunk=>stderr=(stderr+chunk).slice(-16000));const timer=setTimeout(()=>{child.kill('SIGTERM');no(Error(command+' timed out; deployment stopped'))},300000);child.once('error',error=>{clearTimeout(timer);no(error)});child.once('exit',code=>{clearTimeout(timer);code===0?yes(stdout.trim()):no(Error(command+' failed ('+code+'): '+stderr.slice(-1000)))})})}
async function ready(expected){let last='not ready';for(let attempt=0;attempt<40;attempt++){try{const value=await new Promise((yes,no)=>{const url=new URL('/readyz',appURL),request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{headers:{Host:publicURL.host},timeout:2500},response=>{let data='';response.on('data',part=>{data+=part;if(data.length>16384)response.destroy()});response.on('error',no);response.once('end',()=>{try{if(response.statusCode!==200)throw Error('not ready');yes(JSON.parse(data))}catch(error){no(error)}})});request.once('error',no);request.once('timeout',()=>request.destroy(Error('readiness timeout')));request.end()});if(value.ready&&value.releaseId===expected)return;last='wrong release or not ready'}catch(error){last=error.message}await new Promise(r=>setTimeout(r,1000))}throw Error('Readiness failed: '+last)}
try{
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
  const backup=join(config.backupDirectory,releaseId+'-'+Date.now());await cp(config.dataRoot,backup,{recursive:true,errorOnExist:true,force:false,dereference:false,filter:async path=>{if((await lstat(path)).isSymbolicLink())throw Error('Data backup refuses redirected paths');return true}});await chmod(backup,0o700);log.backup=backup
  const temporary=config.currentLink+'.next-'+randomUUID();await symlink(candidate,temporary,'dir');await rename(temporary,config.currentLink);switched=true;log.steps.push('symlink-switched')
  await run('systemctl',['start',config.applicationService]);await ready(releaseId);log.steps.push('new-release-ready')
 }
 log.ok=true;await writeFile(receipt,JSON.stringify({...log,finishedAt:Date.now()},null,2),{mode:0o600});console.log(JSON.stringify({ok:true,releaseId}))
}catch(error){
 log.error=error.message
 if(switched){try{await run('systemctl',['stop',config.applicationService]);if(await run('systemctl',['show','--property=MainPID','--value',config.applicationService])!=='0')throw Error('New writer still alive');if(oldTarget){const temporary=config.currentLink+'.rollback-'+randomUUID();await symlink(oldTarget,temporary,'dir');await rename(temporary,config.currentLink);await run('systemctl',['start',config.applicationService]);const oldManifest=await verifyCandidate(oldTarget);await ready(oldManifest.releaseId);log.rollback='previous-code-restored-with-current-data'}else log.rollback='new-service-stopped; no-previous-release'}catch(rollback){log.rollback='failed: '+rollback.message}}
 else if(stopped&&oldTarget){try{await run('systemctl',['start',config.applicationService]);log.rollback='previous-service-restarted'}catch{log.rollback='manual-recovery-required'}}
 await writeFile(join(config.stateDirectory,releaseId+'.failed-'+Date.now()+'.json'),JSON.stringify(log,null,2),{mode:0o600});throw error
}finally{await rm(stagedArchive,{force:true});const owner=JSON.parse(await readFile(join(lock,'owner.json'),'utf8'));if(owner.pid===process.pid&&owner.releaseId===releaseId){await rm(join(lock,'owner.json'));await rmdir(lock)}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await promote()
