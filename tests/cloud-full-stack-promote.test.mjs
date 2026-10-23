import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {provenanceConfig,verifyRun,verifyJobs,verifyAncestry,verifyFullStackProvenance,REQUIRED_JOBS} from '../scripts/cloud-full-stack-provenance.mjs'

const sha='a'.repeat(40),env={CI:'true',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'fixture/flymind',CLOUD_CONTROL_PLANE_DEPLOY:'true',EXPECTED_SOURCE_RUN_ID:'123',EXPECTED_SOURCE_RUN_ATTEMPT:'2',EXPECTED_SOURCE_SHA:sha,CI_TOKEN:'fixture-ci-only'}
const run={id:123,status:'completed',conclusion:'success',repository:{full_name:'fixture/flymind'},head_repository:{full_name:'fixture/flymind'},path:'.github/workflows/cloud-candidate.yml',head_branch:'main',event:'push',run_attempt:2,head_sha:sha}
const jobs=REQUIRED_JOBS.map((name,index)=>({name,run_id:123,head_sha:sha,status:'completed',conclusion:'success',run_attempt:index===1?2:1}))
const compare={status:'ahead',base_commit:{sha},merge_base_commit:{sha}}
const expected=provenanceConfig(env)
test('fixed CI main/full-stack identity rejects malformed inputs and never falls back to other token',()=>{
 assert.equal(expected.run,'123')
 for(const change of [{CI:'false'},{GITHUB_REF:'refs/heads/dev'},{CLOUD_CONTROL_PLANE_DEPLOY:'TRUE'},{CLOUD_CONTROL_PLANE_DEPLOY:'false'},{EXPECTED_SOURCE_RUN_ID:'123/../x'},{EXPECTED_SOURCE_RUN_ATTEMPT:'1e2'},{EXPECTED_SOURCE_SHA:'a'.repeat(39)},{GITHUB_REPOSITORY:'https://evil.test/x'},{CI_TOKEN:'',GITHUB_TOKEN:'not-an-accepted-fallback'}])assert.throws(()=>provenanceConfig({...env,...change}))
})
test('exact successful repository/run/attempt/SHA and candidate workflow are mandatory',()=>{
 verifyRun(run,expected);verifyRun({...run,event:'workflow_dispatch'},expected)
 for(const change of [{id:124},{status:'in_progress'},{conclusion:'failure'},{repository:{full_name:'other/repo'}},{head_repository:{full_name:'fork/repo'}},{path:'.github/workflows/other.yml'},{head_branch:'dev'},{event:'pull_request'},{run_attempt:1},{head_sha:'b'.repeat(40)}])assert.throws(()=>verifyRun({...run,...change},expected))
})
test('latest jobs retain earlier successful attempts but require both platforms and real control-plane runtime',()=>{
 verifyJobs(jobs,expected)
 for(const job of jobs){assert.throws(()=>verifyJobs(jobs.filter(value=>value!==job),expected));assert.throws(()=>verifyJobs(jobs.map(value=>value===job?{...value,conclusion:'skipped'}:value),expected))}
 for(const change of [{run_id:124},{head_sha:'b'.repeat(40)},{status:'in_progress'},{run_attempt:3},{conclusion:'failure'}])assert.throws(()=>verifyJobs(jobs.map((job,index)=>index===0?{...job,...change}:job),expected))
 assert.throws(()=>verifyJobs([...jobs,jobs[0]],expected))
})
test('source must be identical to or an ancestor of current main, never ahead/diverged/unrelated',()=>{
 verifyAncestry(compare,sha);verifyAncestry({...compare,status:'identical'},sha)
 for(const change of [{status:'behind'},{status:'diverged'},{base_commit:{sha:'b'.repeat(40)}},{merge_base_commit:{sha:'b'.repeat(40)}}])assert.throws(()=>verifyAncestry({...compare,...change},sha))
})
function fakeAPI(overrides={}){
 const calls=[];return {calls,fetcher:async(url,options)=>{
  calls.push({url,options});assert.equal(new URL(url).origin,'https://api.github.com');assert.ok(new URL(url).pathname.startsWith('/repos/fixture/flymind/'))
  assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+env.CI_TOKEN)
  const value=url.includes('/jobs?')?{total_count:jobs.length,jobs:overrides.jobs??jobs}:url.includes('/compare/')?overrides.compare??compare:overrides.run??run
  return Response.json(value)
 }}
}
test('read-only fixed API verifies run, latest job inventory and ancestry before returning uploader identity',async()=>{
 const fake=fakeAPI();const result=await verifyFullStackProvenance(env,fake.fetcher)
 assert.deepEqual(result,{runId:'123',runAttempt:2,sourceCommit:sha});assert.equal(fake.calls.length,3)
 assert.match(fake.calls[1].url,/\/runs\/123\/jobs\?filter=latest&per_page=100&page=1$/)
 assert.match(fake.calls[2].url,new RegExp('/compare/'+sha+'\\.\\.\\.main\\?per_page=1$'))
 assert.ok(!JSON.stringify(result).includes(env.CI_TOKEN))
 const failed=fakeAPI({jobs:jobs.map(job=>job.name==='control_plane_runtime'?{...job,conclusion:'failure'}:job)})
 await assert.rejects(verifyFullStackProvenance(env,failed.fetcher));assert.equal(failed.calls.length,2)
 await assert.rejects(verifyFullStackProvenance(env,async()=>{throw Error('fixture-ci-only hidden upstream detail')}),error=>!error.message.includes(env.CI_TOKEN))
 await assert.rejects(verifyFullStackProvenance(env,async()=>new Response(null,{status:302,headers:{location:'https://evil.invalid'}})))
})
test('job pagination is bounded and cannot silently accept an incomplete successful subset',async()=>{
 await assert.rejects(verifyFullStackProvenance(env,async url=>Response.json(url.includes('/jobs?')?{total_count:101,jobs}:run)),/inventory/)
 await assert.rejects(verifyFullStackProvenance(env,async url=>Response.json(url.includes('/jobs?')?{total_count:501,jobs}:run)),/inventory/)
})
test('manual production workflow consumes same immutable Linux artifact only after all guards; no rebuild/staging bypass',async()=>{
 const yaml=(await readFile(new URL('../.github/workflows/cloud-full-stack-promote.yml',import.meta.url),'utf8')).replaceAll('\r\n','\n')
 for(const name of ['run_id','run_attempt','source_sha'])assert.match(yaml,new RegExp(name+':\\s+description:[^\\n]+\\s+type: string\\s+required: true'))
 assert.match(yaml,/if: github.ref == 'refs\/heads\/main'/);assert.match(yaml,/environment: production/);assert.match(yaml,/group: cloud-production/);assert.match(yaml,/cancel-in-progress: false/)
 assert.ok(yaml.indexOf('node --test')<yaml.indexOf('run: node scripts/cloud-full-stack-provenance.mjs'))
 assert.ok(yaml.indexOf('run: node scripts/cloud-full-stack-provenance.mjs')<yaml.indexOf('actions/download-artifact@'))
 assert.ok(yaml.indexOf('actions/download-artifact@')<yaml.indexOf('run: node scripts/upload-cloud-candidate.mjs'))
 assert.match(yaml,/name: flymind-linux-x64/);assert.match(yaml,/run-id: \$\{\{ inputs.run_id \}\}/)
 assert.match(yaml,/DEPLOY_CONTROL_PLANE_DEPLOY: 'true'/);assert.match(yaml,/vars.CLOUD_ARTIFACT_HTTPS == 'true' && 'artifact-https' \|\| 'bytes'/)
 assert.ok(!yaml.includes('CLOUD_AUTO_PRODUCTION'));assert.ok(!yaml.includes('npm run build'));assert.ok(!yaml.includes('needs: staging'))
})
