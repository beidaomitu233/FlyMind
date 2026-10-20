import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm,mkdir,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {validateDeploymentConfig} from '../deploy/cloud/promote.mjs'
import {verifyCandidate} from '../scripts/verify-cloud-candidate.mjs'

const config={releaseRoot:'/opt/flymind/releases',currentLink:'/opt/flymind/current',incomingDirectory:'/var/lib/flymind/incoming',dataRoot:'/var/lib/flymind/production/diagrams',backupDirectory:'/var/backups/flymind/production',stateDirectory:'/var/lib/flymind/production/deployments',applicationService:'flymind-application.service',publicOrigin:'https://draw.example.com',applicationOrigin:'http://127.0.0.1:5192'}
test('deployment config is fixed Linux paths, disjoint roots, restricted service and fixed origins',()=>{
 assert.equal(validateDeploymentConfig(config).appURL.port,'5192')
 for(const bad of [{...config,currentLink:config.dataRoot+'/current'},{...config,releaseRoot:'/'},{...config,incomingDirectory:'/tmp/../incoming'},{...config,applicationService:'other.service;shutdown'},{...config,applicationOrigin:'http://remote.invalid:5192'},{...config,publicOrigin:'https://user:password@draw.example.com'},{...config,unknown:true}])assert.throws(()=>validateDeploymentConfig(bad))
})

async function fixture(){const parent=await mkdtemp(join(tmpdir(),'flymind-deploy-')),root=join(parent,'release');await mkdir(root);const bytes=Buffer.from('immutable fixture\n'),manifest={schemaVersion:1,releaseId:'qa-release',sourceCommit:'a'.repeat(40),dirty:false,prepared:true,platform:process.platform,arch:process.arch,node:process.version,abi:process.versions.modules,files:[{path:'app.txt',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]};await writeFile(join(root,'app.txt'),bytes);const save=()=>writeFile(join(root,'candidate.json'),JSON.stringify(manifest));await save();return {parent,root,manifest,save,async close(){assert.ok(resolve(parent).startsWith(resolve(tmpdir())+sep)&&parent.includes('flymind-deploy-'));await rm(parent,{recursive:true,force:true,maxRetries:5,retryDelay:100})}}}
test('candidate verifier accepts unchanged bytes and rejects changed/hash/unregistered/unknown-type entries',async()=>{
 const f=await fixture();try{
  assert.equal((await verifyCandidate(f.root)).releaseId,'qa-release')
  await writeFile(join(f.root,'app.txt'),'tampered');await assert.rejects(verifyCandidate(f.root),/changed/)
  await writeFile(join(f.root,'app.txt'),'immutable fixture\n');f.manifest.files[0].type='device';await f.save();await assert.rejects(verifyCandidate(f.root),/changed/)
  delete f.manifest.files[0].type;f.manifest.prepared='yes';await f.save();await assert.rejects(verifyCandidate(f.root),/verified/)
  f.manifest.prepared=true;await f.save();await writeFile(join(f.root,'extra.txt'),'not listed');await assert.rejects(verifyCandidate(f.root),/Unregistered/)
 }finally{await f.close()}
})
test('candidate root redirects and registered external directory links are rejected',async()=>{
 const f=await fixture();try{
  const outside=join(f.parent,'outside');await mkdir(outside);await writeFile(join(outside,'private.txt'),'secret')
  const redirect=join(f.parent,'redirect');await symlink(f.root,redirect,'junction');await assert.rejects(verifyCandidate(redirect),/redirects/)
  await symlink(outside,join(f.root,'external'),'junction');f.manifest.files.push({path:'external',type:'symlink',target:outside});await f.save();await assert.rejects(verifyCandidate(f.root),/link changed/)
 }finally{await f.close()}
})
