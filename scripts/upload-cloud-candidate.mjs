// CI-only uploader. Remote execution is restricted to the root-owned dispatcher.
import {readFile,mkdtemp,writeFile,rm,lstat} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import {pipeline} from 'node:stream/promises'
import {Readable,Transform} from 'node:stream'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {pathToFileURL} from 'node:url'
import {artifactFetchMetadata,readCandidateIdentity} from './cloud-artifact-source.mjs'
export const MAX_UPLOAD_BYTES=2_000_000_000
export function deploymentUploadConfig(env=process.env){
 const environment=env.DEPLOY_ENVIRONMENT,id=env.DEPLOY_RELEASE_ID,host=env.DEPLOY_SSH_HOST,user=env.DEPLOY_SSH_USER,port=env.DEPLOY_SSH_PORT||'22'
 if(!['staging','production'].includes(environment)||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(id??'')||!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(host??'')||!/^[a-z_][a-z0-9_-]{0,31}$/.test(user??'')||user==='root'||!/^\d{1,5}$/.test(port)||+port<1||+port>65535)throw Error('Deployment identity invalid')
 if(!env.DEPLOY_SSH_KEY?.includes('PRIVATE KEY')||!env.DEPLOY_KNOWN_HOSTS?.trim())throw Error('Pinned SSH host and deployment key are required')
 return {environment,id,host,user,port}
}
export function deploymentPromotionCommands(environment,id,digest,controlPlane='false'){
 if(!['staging','production'].includes(environment)||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(id??'')||!/^[a-f0-9]{64}$/.test(digest??'')||!['','false','true'].includes(controlPlane))throw Error('Deployment promotion mode or identity invalid')
 const suffix=' '+environment+' '+id+' '+digest
 return [...(controlPlane==='true'?['sudo -n /usr/local/libexec/flymind-control-plane-promote'+suffix]:[]),'sudo -n /usr/local/libexec/flymind-promote'+suffix]
}
export async function promoteUploadedCandidate(config,digest,options,controlPlane='false',ssh=runSSH){
 // A failed Java readiness/rollback command must reject before app promotion.
 for(const command of deploymentPromotionCommands(config.environment,config.id,digest,controlPlane))await ssh([...options,command])
}
export const SSH_LIMITS=Object.freeze({uploadMs:60*60*1000,idleMs:5*60*1000,receiptMs:10*60*1000,commandMs:20*60*1000,progressMs:30000,terminateMs:5000})
export async function runSSH(args,inputPath,inputData,hooks={}){
 const hasInput=!!inputPath||inputData!==undefined
 const bytesMode=!!inputPath,now=hooks.now??Date.now,log=hooks.log??console.log
 const later=hooks.setTimeout??setTimeout,cancel=hooks.clearTimeout??clearTimeout,every=hooks.setInterval??setInterval,cancelEvery=hooks.clearInterval??clearInterval
 const totalBytes=bytesMode?(await (hooks.stat??lstat)(inputPath)).size:0,started=now()
 let inputBytesQueued=0,lastProgress=started,lastReport=started,inputFinishedAt,phase=bytesMode?'sending':'command',failure,source,termTimer,killTimer,settled=false
 const child=(hooks.spawn??spawn)('ssh',args,{stdio:[hasInput?'pipe':'ignore','inherit','inherit'],shell:false,windowsHide:true})
 let complete
 const finished=new Promise((yes,no)=>{complete=(error)=>{if(settled)return;settled=true;error?no(error):yes()}})
 // Local stream bytes queued toward SSH, never a claim of remote receipt/fsync.
 const report=event=>{if(bytesMode)log(JSON.stringify({event,phase,inputBytesQueued,totalBytes,elapsedSeconds:Math.floor((now()-started)/1000),averageBytesPerSecond:Math.floor(inputBytesQueued/Math.max(1,(now()-started)/1000))}))}
 const fail=error=>{
  if(failure)return
  failure=error;report('upload-failed')
  if(settled)return
  source?.destroy(error);if(hasInput)child.stdin?.destroy(error)
  try{child.kill('SIGTERM')}catch{}
  termTimer=later(()=>{if(settled)return;try{child.kill('SIGKILL')}catch{}
   killTimer=later(()=>complete(failure),SSH_LIMITS.terminateMs)
  },SSH_LIMITS.terminateMs)
 }
 child.once('error',()=>fail(Object.assign(Error('ssh could not start'),{code:'SSH_START_FAILED'})))
 child.once('close',(code,signal)=>{
  if(hasInput&&child.stdin?.writableFinished!==true){failure??=Object.assign(Error('SSH closed before input delivery completed; outcome is unconfirmed'),{code:'SSH_INPUT_INCOMPLETE'});source?.destroy(failure);child.stdin?.destroy(failure)}
  complete(failure??(code===0?undefined:Object.assign(Error('ssh exited unsuccessfully ('+(signal?'signal '+signal:'code '+code)+')'),{code:'SSH_EXIT_FAILED'})))
 })
 const deadline=(code,description)=>fail(Object.assign(Error(`${description}; phase=${phase}; inputBytesQueued=${inputBytesQueued}/${totalBytes}; elapsedSeconds=${Math.floor((now()-started)/1000)}`),{code}))
 const monitor=every(()=>{
  if(settled||failure)return
  if(now()-started>=(bytesMode?SSH_LIMITS.uploadMs:SSH_LIMITS.commandMs))return deadline(bytesMode?'SSH_UPLOAD_DEADLINE':'SSH_COMMAND_DEADLINE',bytesMode?'Byte upload hard deadline exceeded':'SSH command deadline exceeded')
  if(bytesMode&&phase==='sending'&&now()-lastProgress>=SSH_LIMITS.idleMs)return deadline('SSH_UPLOAD_IDLE','No new upload input bytes for five minutes')
  if(bytesMode&&phase==='awaiting-receipt'&&now()-inputFinishedAt>=SSH_LIMITS.receiptMs)return deadline('SSH_RECEIPT_DEADLINE','Upload sent; remote receipt deadline exceeded')
  if(bytesMode&&now()-lastReport>=SSH_LIMITS.progressMs){lastReport=now();report('upload-progress')}
 },1000)
 report('upload-started')
 const sending=hasInput?(async()=>{
  source=inputPath?(hooks.readStream??createReadStream)(inputPath):Readable.from([inputData])
  const meter=new Transform({transform(chunk,_encoding,callback){inputBytesQueued+=chunk.length;lastProgress=now();callback(null,chunk)}})
  try{await pipeline(source,meter,child.stdin)
   if(bytesMode&&!failure){phase='awaiting-receipt';inputFinishedAt=now();lastReport=now();report('upload-input-finished')}
  }catch{fail(Object.assign(Error('SSH input stream failed; request outcome is unconfirmed'),{code:'SSH_INPUT_FAILED'}));throw failure}
 })():Promise.resolve()
 try{
  const results=await Promise.allSettled([finished,sending])
  if(failure)throw failure
  for(const result of results)if(result.status==='rejected')throw result.reason
  if(bytesMode)report('upload-confirmed')
 }finally{cancelEvery(monitor);cancel(termTimer);cancel(killTimer)}
}
export async function uploadCloudCandidate(env=process.env){
const archive=resolve('download/flymind-linux-x64.tar.gz'),info=await lstat(archive)
if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_UPLOAD_BYTES)throw Error('Deployment archive exceeds upload budget or is not a regular file')
const sidecar=(await readFile(archive+'.sha256','utf8')).trim(),expected=sidecar.split(/\s+/)[0]
if(!/^[a-f0-9]{64}$/.test(expected))throw Error('Invalid digest sidecar')
const hash=createHash('sha256');for await(const bytes of createReadStream(archive))hash.update(bytes);if(hash.digest('hex')!==expected)throw Error('Downloaded artifact digest mismatch')
// Failed-only reruns keep the producer's manifest id, never the current attempt.
const identity=await readCandidateIdentity(archive,{runId:env.DEPLOY_SOURCE_RUN_ID,headSHA:env.DEPLOY_SOURCE_SHA})
const {environment,id,host,user,port}=deploymentUploadConfig({...env,DEPLOY_RELEASE_ID:identity.releaseId})
const controlPlane=env.DEPLOY_CONTROL_PLANE_DEPLOY??'false'
deploymentPromotionCommands(environment,id,expected,controlPlane) // reject invalid mode before upload
const transport=env.DEPLOY_TRANSPORT||'bytes'
if(!['bytes','artifact-https'].includes(transport))throw Error('Unknown deployment transport')
const root=await mkdtemp(join(tmpdir(),'flymind-deploy-')),key=join(root,'key'),known=join(root,'known_hosts')
try{
 await writeFile(key,env.DEPLOY_SSH_KEY.replaceAll('\r','')+'\n',{mode:0o600});await writeFile(known,env.DEPLOY_KNOWN_HOSTS+'\n',{mode:0o600})
 const options=['-q','-T','-i',key,'-o','RequestTTY=no','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+known,'-o','ConnectTimeout=15','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3','-p',port,user+'@'+host]
 if(transport==='bytes')await runSSH([...options,'flymind-upload '+id+' '+expected],archive)
 else{
  // A URL expires in one minute. Each bounded retry obtains a new capability;
  // neither the URL nor API token is stored, printed or placed in argv/env.
  for(let attempt=0;attempt<2;attempt++){
   const metadata=Buffer.from(JSON.stringify(await artifactFetchMetadata(env,info.size)))
   if(metadata.length>16384)throw Error('Artifact metadata budget exceeded')
   try{await runSSH([...options,'flymind-fetch '+id+' '+expected],undefined,metadata);break}
   catch{if(attempt===1)throw Error('Restricted artifact transfer failed after two attempts')}
  }
 }
 await promoteUploadedCandidate({environment,id},expected,options,controlPlane)
}finally{if(!resolve(root).startsWith(resolve(tmpdir())+sep)||!root.includes('flymind-deploy-'))throw Error('Unsafe credential cleanup path');await rm(root,{recursive:true,force:true})}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await uploadCloudCandidate()
