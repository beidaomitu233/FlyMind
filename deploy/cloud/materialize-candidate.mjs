// Root-installed code only. Candidate payloads are data, never executable hooks.
import {lstat,realpath,readFile,readdir,mkdir,mkdtemp,rm,open,copyFile,chmod,symlink} from 'node:fs/promises'
import {constants,createReadStream} from 'node:fs'
import {createHash} from 'node:crypto'
import {dirname,join,resolve,sep,posix} from 'node:path'

const SHA=/^[a-f0-9]{64}$/,COMMIT=/^[a-f0-9]{40}$/,ID=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/
const FILE_LIMIT=2_000_000_000,TREE_LIMIT=4_000_000_000,INDEX='.materializer-links.json'
const fail=message=>{throw Error('Compact candidate: '+message)}
const exact=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))
function safePath(name){if(typeof name!=='string'||!name||name.includes(':')||name.includes('\\')||name.includes('\0')||name.startsWith('/')||name.split('/').some(x=>!x||x==='.'||x==='..'))fail('unsafe relative path');return name}
const integer=n=>Number.isSafeInteger(n)&&n>=0
async function hashFile(path){const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);return hash.digest('hex')}
async function ancestors(path,protectedRoot){for(let current=resolve(path);;current=dirname(current)){const s=await lstat(current);if(!s.isDirectory()||s.isSymbolicLink()||protectedRoot&&(s.uid!==0||s.mode&0o022))fail('untrusted directory');if(dirname(current)===current)return}}
async function regular(path,protectedRoot,limit=FILE_LIMIT){const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.size>limit||protectedRoot&&(s.uid!==0||s.mode&0o022))fail('untrusted file');return s}
async function jsonFile(path,limit,protectedRoot){await regular(path,protectedRoot,limit);return JSON.parse(await readFile(path,'utf8'))}
async function verifier(protectedRoot){
 let url=new URL('./verify-cloud-candidate.mjs',import.meta.url)
 if(!protectedRoot){try{await lstat(url)}catch(error){if(error.code!=='ENOENT')throw error;url=new URL('../../scripts/verify-cloud-candidate.mjs',import.meta.url)}}
 return (await import(url.href)).verifyCandidate
}
function filesOf(manifest){
 if(manifest?.schemaVersion!==1||manifest.prepared!==true||manifest.dirty!==false||!ID.test(manifest.releaseId??'')||!COMMIT.test(manifest.sourceCommit??'')||!Array.isArray(manifest.files)||manifest.files.length>=100000)fail('invalid complete manifest')
 const files=new Map();let total=0
 for(const f of manifest.files){safePath(f?.path);if(['candidate.json','overlay.json',INDEX].includes(f.path)||f.path.startsWith('_overlay/')||files.has(f.path))fail('reserved or repeated manifest path')
  if(f.type==='symlink'){
   if(typeof f.target!=='string'||!f.target||f.target.startsWith('/')||f.target.includes('\\')||f.target.includes(':')||f.target.includes('\0'))fail('unsafe symlink')
   const target=posix.normalize(posix.join(posix.dirname(f.path),f.target));if(target==='..'||target.startsWith('../')||target==='.')fail('escaping symlink')
  }else if(f.type!==undefined||!integer(f.bytes)||f.bytes>FILE_LIMIT||!SHA.test(f.sha256??''))fail('invalid file declaration')
  total+=f.bytes??0;if(total>=TREE_LIMIT)fail('complete tree budget exceeded');files.set(f.path,f)
 }
 for(const name of files.keys()){let parent=posix.dirname(name);while(parent!=='.'){if(files.has(parent))fail('manifest path crosses file or symlink');parent=posix.dirname(parent)}}
 return files
}
async function trustedBaseline(environment,baselineRoot,protectedRoot){
 if(baselineRoot!==undefined){if(protectedRoot)fail('production baseline override forbidden');const root=resolve(baselineRoot);if(await realpath(root)!==root)fail('test baseline redirects');return root}
 if(!['staging','production'].includes(environment))fail('invalid environment')
 const path='/etc/flymind/'+environment+'/deployment.json';await ancestors(dirname(path),true);await regular(path,true,65536)
 const config=await jsonFile(path,65536,true)
 for(const key of ['releaseRoot','currentLink'])if(typeof config[key]!=='string'||!config[key].startsWith('/')||posix.normalize(config[key])!==config[key]||config[key]==='/')fail('invalid fixed deployment root')
 await ancestors(config.releaseRoot,true);await ancestors(dirname(config.currentLink),true)
 const link=await lstat(config.currentLink);if(!link.isSymbolicLink()||link.uid!==0)fail('current release is not a protected link')
 const root=await realpath(config.currentLink)
 if(dirname(root)!==config.releaseRoot||await realpath(config.releaseRoot)!==config.releaseRoot)fail('baseline leaves release root')
 return root
}

// Tar metadata is inspected completely before any bytes are extracted. Links
// are recorded as data and created only after every ordinary target is written.
const EXTRACT=String.raw`import json,os,pathlib,sys,tarfile
a,d=sys.argv[1:]; root=pathlib.Path(d); seen={}; links=[]; total=0
def require(ok):
 if not ok: raise ValueError('Unsafe candidate archive')
require(hasattr(tarfile,'data_filter'))
with tarfile.open(a) as t:
 count=0
 for e in t:
  count+=1; require(count<100000)
  name=e.name
  while name.startswith('./'): name=name[2:]
  if name in ('','.'): require(e.isdir()); continue
  name=name.rstrip('/') if e.isdir() else name
  require(not name.startswith('/') and ':' not in name and chr(92) not in name and chr(0) not in name and all(p not in ('','..','.') for p in name.split('/')))
  require(name!='.materializer-links.json' and name not in seen and (e.isdir() or e.isfile() or e.issym()) and 0<=e.size<=2000000000)
  require(tarfile.data_filter(e,str(root)) is not None)
  seen[name]=e; total+=e.size; require(total<4000000000)
 for name,e in seen.items():
  for p in pathlib.PurePosixPath(name).parents:
   if str(p) in seen: require(seen[str(p)].isdir())
 for name,e in seen.items():
  p=root/name
  if e.issym(): links.append({'path':name,'target':e.linkname}); continue
  p.parent.mkdir(parents=True,exist_ok=True)
  if e.isdir(): p.mkdir(exist_ok=True); os.chmod(p,0o755); continue
  with t.extractfile(e) as source,open(p,'xb') as target:
   remaining=e.size
   while remaining:
    b=source.read(min(1048576,remaining)); require(bool(b)); target.write(b); remaining-=len(b)
   require(not source.read(1))
  os.chmod(p,0o755 if e.mode&0o111 else 0o644)
 with open(root/'.materializer-links.json','x') as f: json.dump(links,f)
`
async function inventory(root,prefix=''){const files=[];for(const entry of await readdir(join(root,prefix),{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())files.push(...await inventory(root,name+'/'));else{if(!entry.isFile())fail('special extracted payload');files.push(name)}}return files}
async function parentFor(root,name){let parent=root;for(const part of name.split('/').slice(0,-1)){parent=join(parent,part);try{await mkdir(parent,{mode:0o755});await chmod(parent,0o755)}catch(error){if(error.code!=='EEXIST')throw error;const s=await lstat(parent);if(!s.isDirectory()||s.isSymbolicLink())fail('output parent redirected')}}}
async function installFile(source,destination,name){await parentFor(destination,name);await copyFile(source,join(destination,name),constants.COPYFILE_EXCL);await chmod(join(destination,name),(await lstat(source)).mode&0o111?0o755:0o644)}
function sameFile(a,b){return a&&b&&a.type===b.type&&(a.type==='symlink'?a.target===b.target:a.bytes===b.bytes&&a.sha256===b.sha256)}
function patchList(overlay,target,base){
 if(!exact(overlay,['schemaVersion','format','baseReleaseId','baseSourceCommit','baseCandidateSHA256','targetCandidateSHA256','patches'])||overlay.schemaVersion!==1||overlay.format!=='flymind-overlay'||!ID.test(overlay.baseReleaseId??'')||!COMMIT.test(overlay.baseSourceCommit??'')||!SHA.test(overlay.baseCandidateSHA256??'')||!SHA.test(overlay.targetCandidateSHA256??'')||!Array.isArray(overlay.patches)||overlay.patches.length>1)fail('invalid overlay declaration')
 const result=new Map()
 for(const p of overlay.patches){
  if(!exact(p,['path','baseSHA256','literalPath','literalSHA256','operations'])||p.path!=='control-plane/system-admin.jar'||!SHA.test(p.baseSHA256??'')||!SHA.test(p.literalSHA256??'')||!Array.isArray(p.operations)||!p.operations.length||p.operations.length>200000)fail('invalid JAR patch')
  const t=target.get(p.path),b=base.get(p.path)
  if(!t||t.type||!b||b.type||b.sha256!==p.baseSHA256||p.literalPath!=='_overlay/patches/'+t.sha256+'.bin'||result.has(p.path))fail('JAR patch identity mismatch')
  let bytes=0;for(const op of p.operations){if(!exact(op,['from','offset','bytes'])||!['base','literal'].includes(op.from)||!integer(op.offset)||!integer(op.bytes)||!Number.isSafeInteger(op.offset+op.bytes))fail('invalid JAR copy operation');bytes+=op.bytes;if(bytes>FILE_LIMIT||!Number.isSafeInteger(bytes))fail('JAR patch budget exceeded')}
  if(bytes!==t.bytes)fail('JAR patch output length mismatch');result.set(p.path,p)
 }return result
}
async function rebuildJar(patch,baseRoot,stage,destination,target){
 const basePath=join(baseRoot,patch.path),literalPath=join(stage,patch.literalPath)
 const b=await regular(basePath,false),l=await regular(literalPath,false)
 if(await hashFile(basePath)!==patch.baseSHA256||await hashFile(literalPath)!==patch.literalSHA256)fail('JAR input digest mismatch')
 await parentFor(destination,patch.path)
 const inputs={base:await open(basePath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),literal:await open(literalPath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)}
 const output=await open(join(destination,patch.path),'wx',0o644),digest=createHash('sha256'),buffer=Buffer.alloc(1024*1024);await output.chmod(0o644)
 try{for(const op of patch.operations){const limit=op.from==='base'?b.size:l.size;if(op.offset+op.bytes>limit)fail('JAR copy out of bounds');let offset=op.offset,remaining=op.bytes
   while(remaining){const {bytesRead}=await inputs[op.from].read(buffer,0,Math.min(buffer.length,remaining),offset);if(!bytesRead)fail('JAR input truncated');let written=0;while(written<bytesRead){const r=await output.write(buffer,written,bytesRead-written);if(!r.bytesWritten)fail('JAR output write failed');written+=r.bytesWritten}digest.update(buffer.subarray(0,bytesRead));offset+=bytesRead;remaining-=bytesRead}}
  await output.sync();if(digest.digest('hex')!==target.sha256)fail('rebuilt JAR digest mismatch')
 }finally{await output.close();await inputs.base.close();await inputs.literal.close()}
}
async function installLinks(destination,files){for(const f of files.values())if(f.type==='symlink'){await parentFor(destination,f.path);await symlink(f.target,join(destination,f.path))}}

export async function materializeCandidate({archive,destination,environment,python,run,requireRootOwned=true,baselineRoot}){
 if(typeof run!=='function'||typeof python!=='string'||!python)fail('fixed extractor required')
 if(requireRootOwned&&(process.platform!=='linux'||process.getuid?.()!==0||baselineRoot!==undefined))fail('root materializer required')
 const output=resolve(destination),source=resolve(archive)
 await ancestors(dirname(output),requireRootOwned);await ancestors(dirname(source),requireRootOwned);await regular(source,requireRootOwned,TREE_LIMIT)
 const dest=await lstat(output);if(!dest.isDirectory()||dest.isSymbolicLink()||requireRootOwned&&(dest.uid!==0||dest.mode&0o022)||await realpath(output)!==output||(await readdir(output)).length)fail('destination must be empty protected directory')
 await chmod(output,0o755)
 const stage=await mkdtemp(join(dirname(output),'.materialize-'));await chmod(stage,0o700)
 try{
  await run(python,['-I','-c',EXTRACT,source,stage])
  const verify=await verifier(requireRootOwned),manifest=await jsonFile(join(stage,'candidate.json'),2*1024*1024,requireRootOwned),target=filesOf(manifest)
  const links=await jsonFile(join(stage,INDEX),16*1024*1024,requireRootOwned),payload=new Set((await inventory(stage)).filter(name=>name!==INDEX)),linkMap=new Map()
  if(!Array.isArray(links))fail('invalid archive links')
  for(const link of links){if(!exact(link,['path','target'])||linkMap.has(link.path))fail('duplicate archive link');linkMap.set(link.path,link.target)}
  let overlay
  try{overlay=await jsonFile(join(stage,'overlay.json'),16*1024*1024,requireRootOwned)}catch(error){if(error.code!=='ENOENT')throw error}
  if(overlay){
   if(links.length)fail('overlay must not carry symlink payload')
   const baseRoot=await trustedBaseline(environment,baselineRoot,requireRootOwned),baseManifest=await verify(baseRoot,{requireRootOwned}),base=filesOf(baseManifest)
   const patches=patchList(overlay,target,base)
   if(baseManifest.releaseId!==overlay.baseReleaseId||baseManifest.sourceCommit!==overlay.baseSourceCommit||await hashFile(join(baseRoot,'candidate.json'))!==overlay.baseCandidateSHA256||await hashFile(join(stage,'candidate.json'))!==overlay.targetCandidateSHA256)fail('baseline or target manifest mismatch')
   payload.delete('candidate.json');payload.delete('overlay.json')
   for(const [name,f]of target){if(f.type==='symlink')continue
    if(patches.has(name)){const patch=patches.get(name);if(payload.has(name)||!payload.delete(patch.literalPath))fail('missing or duplicate JAR payload');await rebuildJar(patch,baseRoot,stage,output,f)}
    else if(sameFile(f,base.get(name))){if(payload.has(name))fail('unchanged file redundantly supplied');await installFile(join(baseRoot,name),output,name)}
    else{if(!payload.delete(name))fail('changed file missing');const path=join(stage,name);const s=await regular(path,requireRootOwned);if(s.size!==f.bytes||await hashFile(path)!==f.sha256)fail('changed payload digest mismatch');await installFile(path,output,name)}
   }
   if(payload.size)fail('extra overlay payload')
   // A second full baseline verification catches concurrent mutation without
   // ever sharing mutable inodes with the assembled release.
   await verify(baseRoot,{requireRootOwned});if(await hashFile(join(baseRoot,'candidate.json'))!==overlay.baseCandidateSHA256||await trustedBaseline(environment,baselineRoot,requireRootOwned)!==baseRoot)fail('baseline changed during materialization')
  }else{
   payload.delete('candidate.json')
   for(const [name,f]of target){if(f.type==='symlink'){if(linkMap.get(name)!==f.target)fail('full archive link mismatch');linkMap.delete(name)}else{if(!payload.delete(name))fail('full archive file missing');await installFile(join(stage,name),output,name)}}
   if(payload.size||linkMap.size)fail('extra full archive payload')
  }
  await installFile(join(stage,'candidate.json'),output,'candidate.json');await installLinks(output,target)
  return await verify(output,{requireRootOwned})
 }finally{if(await realpath(stage)!==stage)fail('staging directory redirected');await rm(stage,{recursive:true,force:true})}
}
