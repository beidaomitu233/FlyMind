// CI-only: authenticate only to the fixed GitHub API; never print the token.
import {writeFile,appendFile,mkdir} from 'node:fs/promises'
const repo=process.env.GITHUB_REPOSITORY,target=process.env.COMPACT_TARGET_RUN,baseline=process.env.COMPACT_BASELINE_RUN
if(repo!=='beidaomitu233/FlyMind'||![target,baseline].every(s=>/^[1-9][0-9]{0,19}$/.test(s??''))||target===baseline||!process.env.GITHUB_TOKEN)throw Error('COMPACT_SOURCE_IDENTITY_INVALID')
async function api(path){
 const response=await fetch('https://api.github.com/repos/'+repo+'/actions/'+path,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}})
 if(!response.ok)throw Error('COMPACT_GITHUB_API_FAILED')
 const raw=await response.text();if(raw.length>2*1024*1024)throw Error('COMPACT_GITHUB_RESPONSE_BUDGET')
 return JSON.parse(raw)
}
const required=['source','control_plane_runtime','platform (ubuntu-22.04, linux-x64)','platform (windows-2022, win32-x64)']
async function inspect(id,isBaseline){
 const run=await api('runs/'+id)
 if(String(run.id)!==id||run.name!=='Build cloud candidate'||run.path!=='.github/workflows/cloud-candidate.yml'||!['push','workflow_dispatch'].includes(run.event)||run.head_branch!=='main'||run.head_repository?.full_name!==repo||!/^[a-f0-9]{40}$/.test(run.head_sha??'')||run.status!=='completed'||!['success','failure'].includes(run.conclusion))throw Error('COMPACT_SOURCE_RUN_NOT_VERIFIED')
 const jobs=await api('runs/'+id+'/jobs?filter=latest&per_page=100')
 if(!Array.isArray(jobs.jobs)||jobs.total_count>100||jobs.jobs.length!==jobs.total_count||jobs.jobs.some(j=>String(j.run_id)!==id||j.head_sha!==run.head_sha||j.run_attempt!==run.run_attempt))throw Error('COMPACT_SOURCE_JOB_IDENTITY_INVALID')
 if(required.some(name=>{const matched=jobs.jobs.filter(j=>j.name===name);return matched.length!==1||matched[0].status!=='completed'||matched[0].conclusion!=='success'}))throw Error('COMPACT_SOURCE_GATES_INCOMPLETE')
 const failed=jobs.jobs.filter(j=>!['success','skipped'].includes(j.conclusion))
 if(failed.some(j=>j.name!=='production'||j.status!=='completed'||j.conclusion!=='failure')||failed.length>1||run.conclusion==='failure'&&failed.length!==1)throw Error('COMPACT_UNRELATED_SOURCE_FAILURE')
 const inventory=await api('runs/'+id+'/artifacts?per_page=100')
 const matches=inventory.artifacts?.filter(a=>a.name==='flymind-linux-x64'&&!a.expired)
 if(inventory.total_count>100||matches?.length!==1)throw Error('COMPACT_LINUX_ARTIFACT_AMBIGUOUS')
 const a=matches[0]
 if(!/^sha256:[a-f0-9]{64}$/.test(a.digest??'')||String(a.workflow_run?.id)!==id||a.workflow_run?.head_sha!==run.head_sha||a.workflow_run?.head_branch!=='main')throw Error('COMPACT_ARTIFACT_PROVENANCE_INVALID')
 return {runId:id,sourceCommit:run.head_sha,artifactId:a.id,artifactBytes:a.size_in_bytes,zipDigest:a.digest,gates:required,role:isBaseline?'deployed-baseline':'target'}
}
const [targetEvidence,baselineEvidence]=await Promise.all([inspect(target,false),inspect(baseline,true)])
const readyResponse=await fetch('https://fly.hui7.fun/readyz',{redirect:'error',signal:AbortSignal.timeout(15000)})
if(!readyResponse.ok)throw Error('COMPACT_BASELINE_NOT_READY')
const ready=await readyResponse.json()
if(ready.ready!==true||!new RegExp('^run-'+baseline+'-[1-9][0-9]*$').test(ready.releaseId??''))throw Error('COMPACT_BASELINE_NOT_CURRENT')
const report={schemaVersion:1,repository:repo,target:targetEvidence,baseline:{...baselineEvidence,observedReleaseId:ready.releaseId},checkedAt:new Date().toISOString()}
await mkdir('compact',{recursive:true});await writeFile('compact/source-proof.json',JSON.stringify(report,null,2)+'\n')
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'target_sha='+targetEvidence.sourceCommit+'\nbaseline_sha='+baselineEvidence.sourceCommit+'\n')
console.log(JSON.stringify({verified:true,targetRun:target,baselineRun:baseline,targetSource:targetEvidence.sourceCommit}))
