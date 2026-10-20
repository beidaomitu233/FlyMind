import {readFile,lstat,readlink,readdir,realpath} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve,join,sep} from 'node:path'
import {pathToFileURL} from 'node:url'
export async function verifyCandidate(directory,{requirePrepared=true,requireClean=true,checkRuntime=true,requireRootOwned=false}={}){
 const root=resolve(directory),rootInfo=await lstat(root)
 if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink()||await realpath(root)!==root)throw Error('Candidate directory redirects')
 const immutable=stat=>{const readable=stat.isDirectory()?0o005:0o004;if(requireRootOwned&&(stat.uid!==0||(stat.mode&0o022)||(stat.mode&readable)!==readable))throw Error('Candidate must be root-owned, readable/traversable by service, and not group/world writable')}
 immutable(rootInfo)
 const metadata=await lstat(join(root,'candidate.json'));if(!metadata.isFile()||metadata.isSymbolicLink()||metadata.size>2*1024*1024)throw Error('Candidate metadata invalid');immutable(metadata)
 const manifest=JSON.parse(await readFile(join(root,'candidate.json'),'utf8'))
 if(manifest.schemaVersion!==1||typeof manifest.releaseId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(manifest.releaseId)||typeof manifest.sourceCommit!=='string'||!/^[a-f0-9]{40}$/.test(manifest.sourceCommit)||!Array.isArray(manifest.files)||manifest.files.length>100000||requirePrepared&&manifest.prepared!==true||requireClean&&manifest.dirty!==false)throw Error('Candidate is not a verified clean immutable release')
 if(checkRuntime&&manifest.prepared&&(manifest.platform!==process.platform||manifest.arch!==process.arch||manifest.node!==process.version||manifest.abi!==process.versions.modules))throw Error('Candidate OS/CPU/Node/ABI does not match this machine')
 const expected=new Set(['candidate.json'])
 for(const file of manifest.files){if(!file||typeof file!=='object')throw Error('Candidate entry invalid');const name=file.path;if(typeof name!=='string'||name.includes('\0')||name.includes(':')||name.includes('\\')||name.startsWith('/')||name.split('/').some(s=>!s||s==='.'||s==='..')||expected.has(name))throw Error('Candidate file path invalid');expected.add(name);const target=resolve(root,name);if(!target.startsWith(root+sep))throw Error('Candidate path leaves release');const stat=await lstat(target)
  if(file.type==='symlink'){if(typeof file.target!=='string'||!stat.isSymbolicLink()||await readlink(target)!==file.target||!resolve(target,'..',file.target).startsWith(root+sep)||!(await realpath(target)).startsWith(root+sep))throw Error('Candidate link changed');if(requireRootOwned&&stat.uid!==0)throw Error('Candidate link ownership invalid')}
  else{if(file.type!==undefined||!Number.isSafeInteger(file.bytes)||file.bytes<0||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256)||!stat.isFile()||stat.isSymbolicLink()||stat.size!==file.bytes||!(await realpath(target)).startsWith(root+sep))throw Error('Candidate file changed: '+name);immutable(stat);const bytes=await readFile(target);if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Candidate digest changed: '+name)}
 }
 async function inventory(path,prefix=''){immutable(await lstat(path));for(const entry of await readdir(path,{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())await inventory(join(path,entry.name),name+'/');else if(!expected.has(name))throw Error('Unregistered candidate file: '+name)}}await inventory(root)
 return manifest
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const manifest=await verifyCandidate(process.argv[2]);console.log(JSON.stringify({ok:true,releaseId:manifest.releaseId,platform:manifest.platform,files:manifest.files.length}))}
