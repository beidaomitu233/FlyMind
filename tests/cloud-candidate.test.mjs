import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {verifyCandidate} from '../scripts/verify-cloud-candidate.mjs'
async function fixture(){const root=await mkdtemp(join(tmpdir(),'flymind-candidate-')),bytes=Buffer.from('immutable release');await writeFile(join(root,'application.js'),bytes);const manifest={schemaVersion:1,releaseId:'run-123',sourceCommit:'a'.repeat(40),prepared:true,dirty:false,platform:process.platform,arch:process.arch,node:process.version,abi:process.versions.modules,files:[{path:'application.js',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]};await writeFile(join(root,'candidate.json'),JSON.stringify(manifest));return {root,manifest}}
test('candidate promotion verifies exact prepared platform bytes and rejects added/tampered files',async()=>{const {root}=await fixture();try{assert.equal((await verifyCandidate(root)).releaseId,'run-123');await writeFile(join(root,'extra.env'),'unregistered');await assert.rejects(verifyCandidate(root),/Unregistered/);await rm(join(root,'extra.env'));await writeFile(join(root,'application.js'),'tamper');await assert.rejects(verifyCandidate(root),/changed/)}finally{await rm(root,{recursive:true,force:true})}})
test('unprepared, dirty, wrong ABI and traversal candidates fail before service changes',async()=>{const {root,manifest}=await fixture();try{for(const change of [{prepared:false},{dirty:true},{abi:'wrong'},{files:[{...manifest.files[0],path:'../outside'}]}]){await writeFile(join(root,'candidate.json'),JSON.stringify({...manifest,...change}));await assert.rejects(verifyCandidate(root))}}finally{await rm(root,{recursive:true,force:true})}})
