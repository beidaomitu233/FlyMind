import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,lstat,symlink,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {backupStoppedData} from '../deploy/cloud/promote.mjs'

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'flymind-deploy-backup-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const source=join(root,'data'),target=join(root,'backup')
 await mkdir(source);await mkdir(join(source,'nested'))
 await writeFile(join(source,'nested','file'),'original')
 return {root,source,target}
}

test('backup copies independently in both directions without hard links',async t=>{
 const {source,target}=await fixture(t)
 await backupStoppedData(source,target)
 const original=join(source,'nested','file'),copy=join(target,'nested','file')
 assert.equal(await readFile(copy,'utf8'),'original')
 const sourceStat=await lstat(original),copyStat=await lstat(copy)
 assert.notEqual(sourceStat.ino,copyStat.ino)
 assert.equal(copyStat.nlink,1)
 if(process.platform!=='win32')assert.equal((await lstat(target)).mode&0o777,0o700)
 await writeFile(copy,'backup changed')
 assert.equal(await readFile(original,'utf8'),'original')
 await writeFile(original,'source changed')
 assert.equal(await readFile(copy,'utf8'),'backup changed')
})

test('existing destination is never merged or overwritten',async t=>{
 const {source,target}=await fixture(t)
 await mkdir(target);await writeFile(join(target,'keep'),'keep')
 await assert.rejects(backupStoppedData(source,target),{code:'EEXIST'})
 assert.equal(await readFile(join(target,'keep'),'utf8'),'keep')
 await assert.rejects(lstat(join(target,'nested')),{code:'ENOENT'})
})

test('refuses source directory links and nested links',async t=>{
 const {root,source,target}=await fixture(t)
 const linkedRoot=join(root,'linked-root')
 await symlink(source,linkedRoot,'junction')
 await assert.rejects(backupStoppedData(linkedRoot,target),/Data backup refuses redirected paths/)
 const outside=join(root,'outside');await mkdir(outside);await writeFile(join(outside,'private'),'private')
 await symlink(outside,join(source,'linked'),'junction')
 const second=join(root,'backup2')
 await assert.rejects(backupStoppedData(source,second),/Data backup refuses redirected paths/)
 await assert.rejects(lstat(join(second,'linked')),{code:'ENOENT'})
 assert.equal(await readFile(join(outside,'private'),'utf8'),'private')
})
