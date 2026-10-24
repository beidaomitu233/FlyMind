// CI-only replay against the actual immutable platform archives, not a fixture.
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir,stat,realpath} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {verifyCandidate} from './verify-cloud-candidate.mjs'
import {readCandidateIdentity} from './cloud-artifact-source.mjs'
import {materializeCandidate} from '../deploy/cloud/materialize-candidate.mjs'
const execute=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex')
const proof=JSON.parse(await readFile('compact/source-proof.json','utf8'))
const baseline=await realpath('baseline'),target=await realpath('target')
const old=await verifyCandidate(baseline),next=await verifyCandidate(target)
assert.equal(old.sourceCommit,proof.baseline.sourceCommit)
assert.equal(next.sourceCommit,proof.target.sourceCommit)
assert.ok(old.releaseId.startsWith('run-'+proof.baseline.runId+'-'))
assert.ok(next.releaseId.startsWith('run-'+proof.target.runId+'-'))
const archive=resolve('compact/flymind-linux-x64.tar.gz'),bytes=(await stat(archive)).size
const originalBytes=(await stat('original-target/flymind-linux-x64.tar.gz')).size
assert.ok(bytes<32*1024*1024&&bytes<originalBytes/4,'COMPACT_NOT_SMALL_ENOUGH')
assert.deepEqual(await readCandidateIdentity(archive,{runId:proof.target.runId,headSHA:next.sourceCommit}),{releaseId:next.releaseId,sourceCommit:next.sourceCommit})
const destination=resolve('materialized');await mkdir(destination)
const run=async(command,args)=>(await execute(command,args,{windowsHide:true,timeout:300000,maxBuffer:1024*1024})).stdout
await materializeCandidate({archive,destination,environment:'production',python:'python3',run,requireRootOwned:false,baselineRoot:baseline})
const replayed=await verifyCandidate(destination)
const originalManifest=await readFile(resolve(target,'candidate.json'))
assert.deepEqual(await readFile(resolve(destination,'candidate.json')),originalManifest)
assert.equal(replayed.sourceCommit,proof.target.sourceCommit)
assert.equal(replayed.releaseId,next.releaseId)
await verifyCandidate(baseline)
const report={schemaVersion:1,ok:true,authority:'Actual Linux platform archives, unprivileged materialization; production root installation remains separate',sourceRun:proof.target.runId,sourceCommit:next.sourceCommit,releaseId:next.releaseId,baselineRun:proof.baseline.runId,baselineReleaseId:old.releaseId,targetCandidateSHA256:sha(originalManifest),files:next.files.length,originalBytes,compactBytes:bytes,ratio:bytes/originalBytes,uploaderIdentityVerified:true,allTargetFilesVerified:true,originalManifestBytesPreserved:true,baselineStillVerified:true,checkedAt:new Date().toISOString()}
await writeFile('compact/roundtrip-report.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report))
