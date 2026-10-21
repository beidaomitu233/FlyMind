// Only the fixed GitHub API receives GITHUB_TOKEN. Storage capability stays in memory.
import {spawn} from 'node:child_process'
export function candidateIdentity(value,{runId,headSHA}={}){
 if(value?.schemaVersion!==1||value.prepared!==true||value.dirty!==false||value.platform!=='linux'||value.arch!=='x64'||!/^run-[1-9]\d*-[1-9]\d*$/.test(value.releaseId??'')||!/^[a-f0-9]{40}$/.test(value.sourceCommit??''))throw Error('Candidate provenance invalid')
 if(runId&&!value.releaseId.startsWith('run-'+runId+'-')||headSHA&&value.sourceCommit!==headSHA)throw Error('Candidate does not match source run/commit')
 return {releaseId:value.releaseId,sourceCommit:value.sourceCommit}
}
export async function readCandidateIdentity(archive,expected){
 const child=spawn('tar',['-xOzf',archive,'./candidate.json'],{shell:false,windowsHide:true,stdio:['ignore','pipe','ignore']})
 const chunks=[];let bytes=0
 const timer=setTimeout(()=>child.kill(),30000)
 try{
  await new Promise((yes,no)=>{child.on('error',()=>no(Error('Cannot read candidate manifest')));child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024){child.kill();no(Error('Candidate manifest budget exceeded'))}else chunks.push(chunk)});child.on('close',code=>code===0?yes():no(Error('Cannot read candidate manifest')))})
  let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Error('Candidate manifest JSON invalid')}
  return candidateIdentity(value,expected)
 }finally{clearTimeout(timer)}
}
export function validateArtifactURL(value){
 if(typeof value!=='string'||value.length>12000||!/^[\x21-\x7e]+$/.test(value))throw Error('Artifact redirect invalid')
 let url;try{url=new URL(value)}catch{throw Error('Artifact redirect invalid')}
 if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port||!/^productionresults[a-z0-9]+\.blob\.core\.windows\.net$/.test(url.hostname))throw Error('Artifact redirect origin forbidden')
 return value
}
export async function artifactFetchMetadata(env,tarBytes,fetchImpl=fetch){
 const repo=env.GITHUB_REPOSITORY,run=env.DEPLOY_SOURCE_RUN_ID,sha=env.DEPLOY_SOURCE_SHA
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo??'')||!(/^[1-9]\d*$/).test(run??'')||!/^[a-f0-9]{40}$/.test(sha??'')||!env.GITHUB_TOKEN||!Number.isSafeInteger(tarBytes)||tarBytes<1||tarBytes>2_000_000_000)throw Error('Artifact source identity invalid')
 const root='https://api.github.com/repos/'+repo+'/actions'
 const request=async(path,redirect='error')=>{
  try{return await fetchImpl(root+path,{headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect,signal:AbortSignal.timeout(15000)})}
  catch{throw Error('GitHub artifact API unavailable')}
 }
 const response=await request('/runs/'+run+'/artifacts?per_page=100')
 if(!response.ok)throw Error('GitHub artifact inventory unavailable')
 const raw=await response.text();if(raw.length>1024*1024)throw Error('Artifact inventory budget exceeded')
 let inventory;try{inventory=JSON.parse(raw)}catch{throw Error('Artifact inventory JSON invalid')}
 if(!Number.isSafeInteger(inventory.total_count)||inventory.total_count>100)throw Error('Artifact inventory incomplete')
 const matches=inventory.artifacts?.filter(a=>a.name==='flymind-linux-x64'&&!a.expired)
 if(matches?.length!==1)throw Error('Expected exactly one immutable Linux artifact')
 const artifact=matches[0]
 if(!Number.isSafeInteger(artifact.id)||artifact.id<1||!Number.isSafeInteger(artifact.size_in_bytes)||artifact.size_in_bytes<1||artifact.size_in_bytes>2_000_000_000||!/^sha256:[a-f0-9]{64}$/.test(artifact.digest??'')||String(artifact.workflow_run?.id)!==run||artifact.workflow_run?.head_sha!==sha||artifact.workflow_run?.head_branch!=='main')throw Error('Artifact provenance/digest invalid')
 const redirect=await request('/artifacts/'+artifact.id+'/zip','manual')
 try{
  if(![302,303].includes(redirect.status))throw Error('Expected GitHub artifact redirect')
  const url=validateArtifactURL(redirect.headers.get('location'))
  return {schemaVersion:1,artifactId:artifact.id,url,zipSha256:artifact.digest.slice(7),zipBytes:artifact.size_in_bytes,tarBytes,issuedAt:Date.now()}
 }finally{await redirect.body?.cancel()}
}
