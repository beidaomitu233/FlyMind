import {test} from 'node:test'
import assert from 'node:assert/strict'
import {candidateIdentity,validateArtifactURL,artifactFetchMetadata,readCandidateIdentity} from '../scripts/cloud-artifact-source.mjs'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
const sha='a'.repeat(40),digest='b'.repeat(64),host='productionresultssa6.blob.core.windows.net'
const candidate={schemaVersion:1,prepared:true,dirty:false,platform:'linux',arch:'x64',releaseId:'run-123-1',sourceCommit:sha}
test('producer manifest identity survives failed-only consumer attempt; mismatched provenance fails',async()=>{
 assert.equal(candidateIdentity(candidate,{runId:'123',headSHA:sha}).releaseId,'run-123-1')
 for(const value of [{...candidate,prepared:false},{...candidate,dirty:true},{...candidate,platform:'win32'},{...candidate,releaseId:'run-12-1'},{...candidate,sourceCommit:'c'.repeat(40)}])assert.throws(()=>candidateIdentity(value,{runId:'123',headSHA:sha}))
 const root=await mkdtemp(join(tmpdir(),'flymind-artifact-test-'))
 try{await writeFile(join(root,'candidate.json'),JSON.stringify(candidate));execFileSync('tar',['-czf',join(root,'bundle.tgz'),'-C',root,'./candidate.json'],{windowsHide:true});assert.equal((await readCandidateIdentity(join(root,'bundle.tgz'),{runId:'123',headSHA:sha})).releaseId,'run-123-1')}
 finally{await rm(root,{recursive:true,force:true})}
})
test('artifact redirect permits only bounded exact Azure storage host syntax, never arbitrary origins',()=>{
 assert.equal(validateArtifactURL('https://'+host+'/archive.zip?fixture=not-a-secret'),'https://'+host+'/archive.zip?fixture=not-a-secret')
 for(const url of ['http://'+host+'/x','https://localhost/x','https://127.0.0.1/x','https://'+host+'.evil.test/x','https://u:p@'+host+'/x','https://'+host+':444/x','https://'+host+'/x#fragment','https://'+host+'/x\n'])assert.throws(()=>validateArtifactURL(url))
})
test('official API metadata binds run/commit/digest; API credential never accompanies storage URL',async()=>{
 const env={GITHUB_REPOSITORY:'fixture/flymind',DEPLOY_SOURCE_RUN_ID:'123',DEPLOY_SOURCE_SHA:sha,GITHUB_TOKEN:'test-only-fixture-token'}
 const artifact={id:7,name:'flymind-linux-x64',expired:false,size_in_bytes:100,digest:'sha256:'+digest,workflow_run:{id:123,head_sha:sha,head_branch:'main'}}
 const calls=[]
 const fake=async(url,options)=>{calls.push({url,options});assert.ok(url.startsWith('https://api.github.com/repos/fixture/flymind/actions/'));return calls.length%2===1?new Response(JSON.stringify({total_count:1,artifacts:[artifact]})):new Response(null,{status:302,headers:{location:'https://'+host+'/archive.zip?fixture=one'}})}
 const metadata=await artifactFetchMetadata(env,50,fake)
 assert.equal(metadata.artifactId,7);assert.equal(metadata.zipSha256,digest);assert.equal(metadata.tarBytes,50);assert.equal(calls.length,2);assert.equal(calls[0].options.redirect,'error');assert.equal(calls[1].options.redirect,'manual')
 for(const changed of [{...artifact,digest:null},{...artifact,workflow_run:{...artifact.workflow_run,head_sha:'c'.repeat(40)}},{...artifact,workflow_run:{...artifact.workflow_run,head_branch:'other'}}])await assert.rejects(artifactFetchMetadata(env,50,async()=>new Response(JSON.stringify({total_count:1,artifacts:[changed]}))))
 await assert.rejects(artifactFetchMetadata({...env,DEPLOY_SOURCE_RUN_ID:'123/../x'},50,fake))
 const with303=await artifactFetchMetadata(env,50,async(url)=>url.includes('/runs/')?new Response(JSON.stringify({total_count:1,artifacts:[artifact]})):new Response(null,{status:303,headers:{location:'https://'+host+'/archive.zip?fixture=two'}}))
 assert.equal(with303.artifactId,7)
 assert.throws(()=>validateArtifactURL('not a URL?fixture=private'),error=>!error.message.includes('private'))
})
