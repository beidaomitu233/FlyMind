import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,open,writeFile,readFile,stat,utimes,rm,symlink,realpath,rename} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {inventory,copyVerified,hashFile,createWorkspaceBackup} from '../server/backups/workspace'

async function fixture(){const parent=await realpath(tmpdir()),root=await realpath(await mkdtemp(join(parent,'flymind-backup-stream-'))),source=join(root,'source'),target=join(root,'target'),outside=join(root,'outside');await mkdir(source);await mkdir(outside);await writeFile(join(outside,'private'),'keep');return {root,source,target,outside,async close(){assert.ok(resolve(root).startsWith(parent+sep)&&root.includes('flymind-backup-stream-'));await rm(root,{recursive:true,force:true})}}}
async function large(path:string){const out=await open(path,'wx'),block=Buffer.from('0123456789abcdef'.repeat(4096)),digest=createHash('sha256');try{for(let i=0;i<192;i++){await out.writeFile(block);digest.update(block)}await out.sync()}finally{await out.close()}return {bytes:block.length*192,sha256:digest.digest('hex')}}

test('bounded inventory and verified copy preserve large bytes, SHA, manifest order, mtime and exclusivity',async()=>{
 const f=await fixture();try{
  await mkdir(join(f.source,'nested'));const path=join(f.source,'nested','large.svg'),expected=await large(path);await writeFile(join(f.source,'small.txt'),'small');await utimes(path,1700000000,1700000000)
  const files=await inventory(f.source);assert.deepEqual(files.map(x=>x.path),['nested/large.svg','small.txt']);assert.equal(files[0].bytes,expected.bytes);assert.equal(files[0].sha256,expected.sha256)
  await copyVerified(f.source,f.target,files);const result=join(f.target,'nested','large.svg');assert.equal(await hashFile(result),expected.sha256);assert.equal((await stat(result)).size,expected.bytes);assert.ok(Math.abs((await stat(result)).mtimeMs-files[0].mtimeMs)<=5)
  await assert.rejects(copyVerified(f.source,f.target,files),(e:any)=>e.code==='EEXIST');assert.equal(await hashFile(result),expected.sha256)
 }finally{await f.close()}
})

test('changed source fails before publication and in-flight mutation fails the second verification',async()=>{
 const f=await fixture();try{
  const path=join(f.source,'large.svg');await large(path);const files=await inventory(f.source);await writeFile(path,'changed')
  await assert.rejects(copyVerified(f.source,f.target,files),(e:any)=>e.code==='BACKUP_SOURCE_CHANGED');await assert.rejects(stat(join(f.target,'large.svg')),(e:any)=>e.code==='ENOENT')
  await rm(path);await large(path);const fresh=await inventory(f.source);let changed=false
  await assert.rejects(copyVerified(f.source,f.target,fresh,{afterChunk:async()=>{if(changed)return;changed=true;const file=await open(path,'r+');try{await file.write(Buffer.from('MUTATED'),0,7,0)}finally{await file.close()}}}),(e:any)=>e.code==='BACKUP_SOURCE_CHANGED')
  assert.equal(changed,true);assert.equal(await readFile(join(f.outside,'private'),'utf8'),'keep')
 }finally{await f.close()}
})

test('source replacement and concurrent writers do not silently publish mismatched content',async()=>{
 const f=await fixture();try{
  const path=join(f.source,'large.svg');await large(path);const files=await inventory(f.source);let replaced=false
  await assert.rejects(copyVerified(f.source,f.target,files,{afterChunk:async()=>{if(replaced)return;replaced=true;await rename(path,join(f.source,'old.svg'));await writeFile(path,'replacement')}}),(e:any)=>e.code==='BACKUP_SOURCE_CHANGED')
  const root=join(f.root,'same-target');const current=await inventory(f.source),results=await Promise.allSettled([copyVerified(f.source,root,current),copyVerified(f.source,root,current)])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1)
  for(const file of current)assert.equal(await hashFile(join(root,...file.path.split('/'))),file.sha256)
 }finally{await f.close()}
})

test('source and target symlinks are rejected without touching outside files',async()=>{
 const f=await fixture();try{
  await symlink(f.outside,join(f.source,'external'),process.platform==='win32'?'junction':'dir');await assert.rejects(inventory(f.source),(e:any)=>e.code==='BACKUP_PATH_INVALID')
  await rm(join(f.source,'external'));await mkdir(join(f.source,'nested'));await writeFile(join(f.source,'nested','file'),'safe');const files=await inventory(f.source);await mkdir(f.target);await symlink(f.outside,join(f.target,'nested'),process.platform==='win32'?'junction':'dir')
  await assert.rejects(copyVerified(f.source,f.target,files),(e:any)=>e.code==='BACKUP_PATH_INVALID');assert.equal(await readFile(join(f.outside,'private'),'utf8'),'keep');await assert.rejects(stat(join(f.outside,'file')),(e:any)=>e.code==='ENOENT')
 }finally{await f.close()}
})

test('backup directory rejects an ancestor junction',async t=>{
 const f=await fixture();try{
  await mkdir(join(f.source,'nested'));await writeFile(join(f.source,'nested','file'),'safe')
  const link=join(f.root,'link');try{await symlink(f.source,link,process.platform==='win32'?'junction':'dir')}catch(error){if(['EPERM','EACCES'].includes((error as NodeJS.ErrnoException).code??''))return t.skip('junction creation unavailable');throw error}
  await assert.rejects(inventory(join(link,'nested')),(e:any)=>e.code==='BACKUP_PATH_INVALID');await rm(link)
 }finally{await f.close()}
})
test('backup directory accepts a Windows 8.3 alias',async t=>{
 if(process.platform!=='win32')return t.skip('Windows 8.3 only');const f=await fixture();try{await writeFile(join(f.source,'file'),'safe');const script='import ctypes,sys; b=ctypes.create_unicode_buffer(32768); n=ctypes.windll.kernel32.GetShortPathNameW(sys.argv[1],b,len(b)); print(b.value if n else "")',result=spawnSync('python',['-c',script,f.source],{encoding:'utf8'}),alias=result.stdout?.trim();if(result.status!==0||!alias||alias.toLowerCase()===f.source.toLowerCase())return t.skip('8.3 alias unavailable');assert.equal((await inventory(alias)).length,1);await assert.rejects(createWorkspaceBackup({sourceRoot:alias,backupRoot:join(f.source,'nested','backup')}),(e:any)=>e.code==='BACKUP_PATH_INVALID')}finally{await f.close()}
})
test('backup destination below the source is rejected before creating directories',async()=>{const f=await fixture();try{await assert.rejects(createWorkspaceBackup({sourceRoot:f.source,backupRoot:join(f.source,'nested','backup')}),(e:any)=>e.code==='BACKUP_PATH_INVALID');await assert.rejects(stat(join(f.source,'nested')),{code:'ENOENT'})}finally{await f.close()}})

test('inventory drains already-started streams before returning the first error',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.source,'a'),Buffer.alloc(64*1024));await writeFile(join(f.source,'b'),Buffer.alloc(64*1024))
  let unblock!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>unblock=r),seen=new Promise<void>(r=>started=r),failure=Error('injected failure');let aStarted=false,bStarted=false,finished=false
  const result=inventory(f.source,{afterChunk:async name=>{if(name==='a'){aStarted=true;started();await gate}else if(name==='b'){bStarted=true;await seen;throw failure}}}).then(()=>undefined,e=>e).finally(()=>{finished=true})
  try{const deadline=Date.now()+3000;while(!aStarted||!bStarted){if(Date.now()>deadline)throw Error('parallel streams did not start');await new Promise(r=>setTimeout(r,5))}await new Promise(r=>setTimeout(r,20));assert.equal(finished,false)}finally{unblock()}
  assert.equal(await result,failure);assert.equal(finished,true)
 }finally{await f.close()}
})
