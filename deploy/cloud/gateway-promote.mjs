#!/usr/bin/env node
// Reviewed root tool, never executed from a candidate. No store or env changes.
import {lstat,readFile,writeFile,mkdir,rmdir,rename,symlink,realpath,unlink} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {pathToFileURL} from 'node:url'

export function gatewayArguments(args){
 const [environment,releaseId,archiveSHA]=args
 if(args.length!==3||environment!=='production'||!/^run-[1-9][0-9]*-[1-9][0-9]*$/.test(releaseId??'')||!/^[a-f0-9]{64}$/.test(archiveSHA??''))throw Error('GATEWAY_ARGUMENTS_INVALID')
 return {environment,releaseId,archiveSHA}
}
export async function trustedPath(path,directory=false){
 for(let p=path;;p=dirname(p)){
  const s=await lstat(p)
  if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)||(p===path&&!directory?!s.isFile():!s.isDirectory()))throw Error('GATEWAY_PATH_UNTRUSTED')
  if(p==='/')break
 }
}
export async function switchGateway({link,target,backup},ops){
 // Stop must settle and prove the old process gone before touching its path.
 await ops.stop();await ops.stopped()
 let previous,legacy=false,changed=false
 try{
  const info=await lstat(link)
  if(info.isSymbolicLink())previous=await realpath(link)
  else if(info.isDirectory()){await rename(link,backup);previous=backup;legacy=true}
  else throw Error('GATEWAY_CURRENT_INVALID')
  const next=link+'.next-'+randomUUID()
  try{await symlink(target,next,process.platform==='win32'?'junction':'dir');await rename(next,link);changed=true}finally{await unlink(next).catch(e=>{if(e.code!=='ENOENT')throw e})}
  await ops.start();await ops.ready(target)
  return {previous,legacy}
 }catch(error){
  try{
   await ops.stop();await ops.stopped()
   if(previous){
    if(changed)await unlink(link)
    if(legacy)await rename(backup,link)
    else {const rollback=link+'.rollback-'+randomUUID();await symlink(previous,rollback,process.platform==='win32'?'junction':'dir');await rename(rollback,link)}
    await ops.start();await ops.ready(legacy?link:previous)
   }
  }catch{throw Error('GATEWAY_ROLLBACK_FAILED; lock retained; stopped replacement required before manual recovery')}
  if(previous)error.safeToUnlock=true
  throw error
 }
}
export async function gatewayAlreadyCurrent(link,target,ready){
 const info=await lstat(link)
 if(!info.isSymbolicLink()||await realpath(link)!==await realpath(target))return false
 await ready(target);return true
}
export async function releaseGatewayLock(lock,owner){
 const current=JSON.parse(await readFile(join(lock,'owner.json'),'utf8'))
 if(current.token!==owner.token||current.pid!==owner.pid||current.releaseId!==owner.releaseId)throw Error('GATEWAY_LOCK_OWNER_CHANGED')
 await unlink(join(lock,'owner.json'));await rmdir(lock)
}
export async function promoteGateway(args=process.argv.slice(2)){
 const {environment,releaseId,archiveSHA}=gatewayArguments(args)
 if(process.platform!=='linux'||process.getuid?.()!==0)throw Error('GATEWAY_LINUX_ROOT_REQUIRED')
 const configFile='/etc/flymind/'+environment+'/deployment.json'
 await trustedPath(configFile)
 await trustedPath('/usr/local/libexec/flymind-promote.mjs')
 const {validateDeploymentConfig}=await import('./flymind-promote.mjs')
 const config=JSON.parse(await readFile(configFile,'utf8')),{publicURL,appURL}=validateDeploymentConfig(config)
 for(const path of [config.releaseRoot,config.stateDirectory,'/opt/flymind/gateway'])await trustedPath(path,true)
 // This shares app's deployment lock; no concurrent app switch or stale-lock stealing.
 const lock=join(config.stateDirectory,'.deploy.lock');await mkdir(lock,{mode:0o700})
 const owner={pid:process.pid,releaseId,token:randomUUID()}
 await writeFile(join(lock,'owner.json'),JSON.stringify(owner),{flag:'wx',mode:0o600})
 let clean=true
 try{
  const candidate=join(config.releaseRoot,releaseId),target=join(candidate,'application')
  await trustedPath('/usr/local/libexec/verify-cloud-candidate.mjs')
  const {verifyCandidate}=await import('./verify-cloud-candidate.mjs')
  const manifest=await verifyCandidate(candidate,{requireRootOwned:true})
  const receiptFile=join(config.stateDirectory,releaseId+'.prepared.json');await trustedPath(receiptFile)
  const receipt=JSON.parse(await readFile(receiptFile,'utf8'))
  if(manifest.releaseId!==releaseId||receipt.archiveSHA!==archiveSHA||await realpath(config.currentLink)!==candidate)throw Error('GATEWAY_CANDIDATE_NOT_CURRENT')
  await trustedPath(target,true);await trustedPath(join(target,'lib/server/cloud/mcp-gateway-start.js'))
  const service='flymind-gateway.service',nodeService=async(action)=>run('/usr/bin/systemctl',[action,service])
  const stopped=async()=>{if(await run('/usr/bin/systemctl',['show','--property=MainPID','--value',service])!=='0')throw Error('GATEWAY_DRAIN_INCOMPLETE')}
  const request=async(origin,path)=>{
   const r=await fetch(new URL(path,origin),{headers:{Host:publicURL.host,Origin:publicURL.origin},redirect:'error',signal:AbortSignal.timeout(2500)})
   if(!r.ok)throw Error('GATEWAY_READINESS_FAILED');return r.json()
  }
  const app=await request(appURL,'/readyz');if(app.ready!==true||app.releaseId!==releaseId)throw Error('GATEWAY_APP_NOT_READY')
  const ready=async(expected)=>{
   for(let i=0;i<30;i++){
    try{
     const pid=await run('/usr/bin/systemctl',['show','--property=MainPID','--value',service])
     if(!/^[1-9][0-9]*$/.test(pid)||await realpath('/proc/'+pid+'/cwd')!==await realpath(expected))throw Error('wrong gateway process')
     const metadata=await request('http://127.0.0.1:5193','/.well-known/oauth-authorization-server')
     if(new URL(metadata.issuer).origin!==publicURL.origin||metadata.token_endpoint!==publicURL.origin+'/token')throw Error('wrong metadata')
     return
    }catch{await new Promise(r=>setTimeout(r,1000))}
   }
   throw Error('GATEWAY_READINESS_FAILED')
  }
  const link='/opt/flymind/gateway/application',info=await lstat(link)
  if(info.isSymbolicLink()){
   const old=await realpath(link)
   if(!old.startsWith(config.releaseRoot+'/')||!old.endsWith('/application'))throw Error('GATEWAY_OLD_TARGET_UNTRUSTED')
   await verifyCandidate(dirname(old),{requireRootOwned:true})
  }else await trustedPath(link,true)
  const backup='/opt/flymind/gateway/bootstrap-'+Date.now()+'-'+randomUUID()
  if(await gatewayAlreadyCurrent(link,target,ready)){
   console.log(JSON.stringify({ok:true,component:'gateway',releaseId,alreadyCurrent:true,clientReconnectRequired:false}));return
  }
  clean=false
  let result
  try{result=await switchGateway({link,target,backup},{stop:()=>nodeService('stop'),stopped,start:()=>nodeService('start'),ready})}
  catch(error){clean=error.safeToUnlock===true;throw error}
  clean=true
  await writeFile(join(config.stateDirectory,releaseId+'.gateway-'+Date.now()+'.json'),JSON.stringify({ok:true,releaseId,archiveSHA,...result,finishedAt:Date.now()}),{mode:0o600,flag:'wx'})
  console.log(JSON.stringify({ok:true,component:'gateway',releaseId,clientReconnectRequired:true}))
 }finally{
  // A failed/timeout drain retains lock: never start a second writer automatically.
  if(clean)await releaseGatewayLock(lock,owner)
  else console.error('GATEWAY_OUTCOME_UNCONFIRMED; own deployment lock retained; inspect service before recovery')
 }
}
function run(command,args){return new Promise((yes,no)=>{
 const child=spawn(command,args,{shell:false,stdio:['ignore','pipe','ignore'],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});let output=''
 const timer=setTimeout(()=>{child.kill('SIGTERM');no(Error('GATEWAY_COMMAND_TIMEOUT'))},180000)
 child.stdout.on('data',b=>output=(output+b).slice(-4096));child.once('error',()=>{clearTimeout(timer);no(Error('GATEWAY_COMMAND_FAILED'))});child.once('close',code=>{clearTimeout(timer);code===0?yes(output.trim()):no(Error('GATEWAY_COMMAND_FAILED'))})
})}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await promoteGateway()
