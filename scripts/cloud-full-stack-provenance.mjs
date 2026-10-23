// Read-only GitHub provenance gate. No arbitrary origins, artifact URLs or server commands.
import {appendFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

const SHA=/^[a-f0-9]{40}$/,ID=/^[1-9][0-9]{0,14}$/
export const REQUIRED_JOBS=['source','control_plane_runtime','platform (ubuntu-22.04, linux-x64)','platform (windows-2022, win32-x64)']
export function provenanceConfig(env){
 const repo=env.GITHUB_REPOSITORY,run=env.EXPECTED_SOURCE_RUN_ID,attempt=env.EXPECTED_SOURCE_RUN_ATTEMPT,sha=env.EXPECTED_SOURCE_SHA
 if(env.CI!=='true'||env.GITHUB_REF!=='refs/heads/main'||env.CLOUD_CONTROL_PLANE_DEPLOY!=='true')throw Error('Full-stack production requires CI main and explicit control-plane opt-in')
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo??'')||!ID.test(run??'')||!ID.test(attempt??'')||!SHA.test(sha??'')||!env.CI_TOKEN)throw Error('Invalid source identity or CI credential')
 return {repo,run,attempt:Number(attempt),sha}
}
export function verifyRun(run,expected){
 const sameRepo=value=>typeof value==='string'&&value.toLowerCase()===expected.repo.toLowerCase()
 if(String(run?.id)!==expected.run||run.status!=='completed'||run.conclusion!=='success'||!sameRepo(run.repository?.full_name)||!sameRepo(run.head_repository?.full_name)||run.path!=='.github/workflows/cloud-candidate.yml'||run.head_branch!=='main'||!['push','workflow_dispatch'].includes(run.event)||run.run_attempt!==expected.attempt||run.head_sha!==expected.sha)throw Error('Source must be that exact successful main candidate run/attempt/commit in this repository')
}
export function verifyJobs(jobs,expected){
 if(!Array.isArray(jobs)||jobs.length>500)throw Error('Job inventory invalid')
 for(const name of REQUIRED_JOBS){
  const matches=jobs.filter(job=>job.name===name)
  if(matches.length!==1)throw Error('Required candidate job missing or ambiguous: '+name)
  const job=matches[0]
  // filter=latest includes retained successes from earlier attempts of this same run.
  if(String(job.run_id)!==expected.run||job.head_sha!==expected.sha||job.status!=='completed'||job.conclusion!=='success'||job.run_attempt!==undefined&&(!Number.isSafeInteger(job.run_attempt)||job.run_attempt<1||job.run_attempt>expected.attempt))throw Error('Required candidate job did not succeed: '+name)
 }
}
export function verifyAncestry(compare,sha){
 if(!['ahead','identical'].includes(compare?.status)||compare.base_commit?.sha!==sha||compare.merge_base_commit?.sha!==sha)throw Error('Candidate commit is not an ancestor of current main')
}
async function boundedJSON(response){
 if(!response.ok){await response.body?.cancel();throw Error('GitHub provenance API rejected request ('+response.status+')')}
 const reader=response.body?.getReader();if(!reader)throw Error('GitHub provenance response missing')
 const chunks=[];let size=0
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024)throw Error('GitHub provenance response budget exceeded');chunks.push(Buffer.from(value))}return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
 catch{await reader.cancel().catch(()=>{});throw Error('GitHub provenance response invalid or too large')}finally{reader.releaseLock()}
}
export async function verifyFullStackProvenance(env=process.env,fetcher=fetch){
 const expected=provenanceConfig(env),root='https://api.github.com/repos/'+expected.repo
 const request=async path=>{
  let response;try{response=await fetcher(root+path,{headers:{Authorization:'Bearer '+env.CI_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(15000)})}catch{throw Error('GitHub provenance API unavailable')}
  return boundedJSON(response)
 }
 verifyRun(await request('/actions/runs/'+expected.run),expected)
 const jobs=[];let total
 for(let page=1;page<=5;page++){
  const result=await request('/actions/runs/'+expected.run+'/jobs?filter=latest&per_page=100&page='+page)
  if(!Number.isSafeInteger(result.total_count)||result.total_count<1||result.total_count>500||total!==undefined&&total!==result.total_count||!Array.isArray(result.jobs)||result.jobs.length>100)throw Error('Candidate job inventory incomplete or changed')
  total=result.total_count;jobs.push(...result.jobs)
  if(jobs.length===total)break
  if(jobs.length>total||result.jobs.length!==100||page===5)throw Error('Candidate job inventory truncated')
 }
 verifyJobs(jobs,expected)
 verifyAncestry(await request('/compare/'+expected.sha+'...main?per_page=1'),expected.sha)
 return {runId:expected.run,runAttempt:expected.attempt,sourceCommit:expected.sha}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const result=await verifyFullStackProvenance()
  if(!process.env.GITHUB_ENV)throw Error('GitHub environment output required')
  await appendFile(process.env.GITHUB_ENV,`DEPLOY_SOURCE_RUN_ID=${result.runId}\nDEPLOY_SOURCE_SHA=${result.sourceCommit}\n`)
  console.log(JSON.stringify({verified:true,...result}))
 }catch(error){console.error(error.message);process.exitCode=1}
}
