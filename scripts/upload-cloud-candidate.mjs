// CI-only uploader. Remote execution is restricted to the root-owned dispatcher.
import {readFile,mkdtemp,writeFile,rm,lstat} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import {pipeline} from 'node:stream/promises'
import {Readable} from 'node:stream'
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
export async function runSSH(args,inputPath,inputData){
 const hasInput=!!inputPath||inputData!==undefined
 const child=spawn('ssh',args,{stdio:[hasInput?'pipe':'ignore','inherit','inherit'],shell:false,windowsHide:true})
 const finished=new Promise((yes,no)=>{child.once('error',no);child.once('close',code=>code===0?yes():no(Error('ssh failed with code '+code)))})
 const timer=setTimeout(()=>child.kill('SIGTERM'),20*60*1000)
 try{const results=await Promise.allSettled([finished,...(hasInput?[pipeline(inputPath?createReadStream(inputPath):Readable.from([inputData]),child.stdin)]:[])]);for(const result of results)if(result.status==='rejected')throw result.reason}
 finally{clearTimeout(timer)}
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
 const options=['-T','-i',key,'-o','RequestTTY=no','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+known,'-o','ConnectTimeout=15','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3','-p',port,user+'@'+host]
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
