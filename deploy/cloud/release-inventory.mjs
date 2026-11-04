// Read-only inventory and review hints. This module contains no deletion action.
import {lstat,realpath,opendir,open,readFile} from 'node:fs/promises'
import {constants} from 'node:fs'
import {resolve,join,sep} from 'node:path'
import {pathToFileURL} from 'node:url'
import {performance} from 'node:perf_hooks'

const ID=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/,SHA=/^[a-f0-9]{64}$/
const within=(path,root)=>path===root||path.startsWith(root+sep)
async function mounts(){
 if(process.platform!=='linux')throw Error('Mount inventory unavailable')
 const data=await readFile('/proc/self/mountinfo','utf8'),result=[]
 for(const line of data.trim().split('\n')){const fields=line.split(' ');if(fields.length<10||!fields.includes('-'))throw Error('Invalid mount table');const path=fields[4].replace(/\\([0-7]{3})/g,(_m,n)=>String.fromCharCode(parseInt(n,8)));if(!path.startsWith('/'))throw Error('Invalid mount path');result.push(path)}
 if(!result.length)throw Error('Empty mount table');return result
}
async function metadata(path,id){
 let file
 try{
  const before=await lstat(path);if(!before.isFile()||before.isSymbolicLink()||before.size>2*1024*1024||await realpath(path)!==path)return
  file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const info=await file.stat()
  if(!info.isFile()||info.size>2*1024*1024||info.dev!==before.dev||info.ino!==before.ino)return
  const value=JSON.parse(await file.readFile('utf8'))
  if(value?.schemaVersion!==1||value.prepared!==true||value.dirty!==false||value.releaseId!==id||value.release?.releaseId!==id||!SHA.test(value.release?.engineResourceKey??'')||typeof value.release?.adapterVersion!=='string'||!Number.isSafeInteger(value.release?.migrationLevel))return
  return {engineResourceKey:value.release.engineResourceKey,adapterVersion:value.release.adapterVersion,migrationLevel:value.release.migrationLevel}
 }catch{return}finally{await file?.close()}
}

/** No content is returned. Allocation counts are not a prediction of reclaimed bytes. */
export async function inventoryReleaseRoot(path,{maxEntries=150000,maxMilliseconds=30000,readMounts=mounts}={}){
 if(!Number.isInteger(maxEntries)||maxEntries<1||maxEntries>1000000||!Number.isInteger(maxMilliseconds)||maxMilliseconds<1||maxMilliseconds>120000)throw Error('Inventory budget invalid')
 const root=resolve(path),started=performance.now(),rootInfo=await lstat(root)
 if(root!==path||!rootInfo.isDirectory()||rootInfo.isSymbolicLink()||await realpath(root)!==root)throw Error('Release root must be a canonical directory')
 const report={schemaVersion:1,readOnly:true,complete:true,entries:0,unknownTopLevel:0,issues:[],releases:[],allocationNote:'Allocated blocks may be shared by hard links or copy-on-write; they are not guaranteed reclaimable bytes.'}
 let mountList
 try{mountList=await readMounts();if(!Array.isArray(mountList)||mountList.some(p=>typeof p!=='string'||!p))throw Error()}catch{report.complete=false;report.issues.push('MOUNT_INVENTORY_UNAVAILABLE');return report}
 let exhausted=false
 const boundary=()=>{if(report.entries>=maxEntries||performance.now()-started>=maxMilliseconds){exhausted=true;report.complete=false;if(!report.issues.includes('INVENTORY_BUDGET_EXCEEDED'))report.issues.push('INVENTORY_BUDGET_EXCEEDED');return false}return true}
 const mountAt=path=>path!==root&&mountList.includes(path)
 async function walk(directory,item,seen){
  if(!boundary())return
  let handle
  try{
   const info=await lstat(directory)
   if(!info.isDirectory()||info.isSymbolicLink()||info.dev!==rootInfo.dev||mountAt(directory)||await realpath(directory)!==directory){item.complete=false;item.issues.add('DIRECTORY_REDIRECT_OR_MOUNT');return}
   handle=await opendir(directory)
   for await(const entry of handle){
    handle=undefined;if(!boundary()){item.complete=false;break}report.entries++
    const child=join(directory,entry.name),s=await lstat(child)
    if(s.isSymbolicLink()){item.symlinks++;continue}
    if(s.dev!==rootInfo.dev||mountAt(child)){item.complete=false;item.issues.add('CROSS_DEVICE_OR_MOUNT');continue}
    if(s.isDirectory()){await walk(child,item,seen);if(exhausted){item.complete=false;break}}
    else if(s.isFile()){
     item.files++;item.logicalBytes+=s.size
     if(s.nlink>1)item.hardLinkedFiles++
     if(typeof s.blocks!=='number')item.allocatedBytes=null
     else if(item.allocatedBytes!==null){const inode=`${s.dev}:${s.ino}`;if(!seen.has(inode)){item.allocatedBytes+=s.blocks*512;seen.add(inode)}}
    }else{item.complete=false;item.issues.add('SPECIAL_FILE')}
   }
  }catch{item.complete=false;item.issues.add('READ_OR_RACE_FAILURE')}
  finally{await handle?.close().catch(()=>{})}
 }
 let directory
 try{
  directory=await opendir(root)
  for await(const entry of directory){
   directory=undefined;if(!boundary())break;report.entries++
   const release=join(root,entry.name),info=await lstat(release)
   if(!ID.test(entry.name)||!info.isDirectory()||info.isSymbolicLink()){report.unknownTopLevel++;report.complete=false;continue}
   const item={releaseId:entry.name,complete:true,files:0,logicalBytes:0,allocatedBytes:0,hardLinkedFiles:0,symlinks:0,issues:new Set()}
   await walk(release,item,new Set())
   const supply=item.complete&&!exhausted?await metadata(join(release,'candidate.json'),entry.name):undefined
   if(!supply){item.complete=false;item.issues.add('UNVERIFIED_CANDIDATE_METADATA')}
   report.releases.push({...item,issues:[...item.issues],...(supply?{supply}:{}),metadataOnly:true})
   if(!item.complete)report.complete=false
   if(!boundary())break
  }
 }catch{report.complete=false;report.issues.push('ROOT_READ_OR_RACE_FAILURE')}
 finally{await directory?.close().catch(()=>{})}
 report.releases.sort((a,b)=>a.releaseId.localeCompare(b.releaseId));return report
}

/** External evidence is advisory; even a complete plan never authorizes deletion. */
export function planReleaseRetention(inventory,evidence={}){
 const releases=Array.isArray(inventory?.releases)?inventory.releases:[],byId=new Map(releases.map(r=>[r.releaseId,r])),blockers=[]
 if(inventory?.readOnly!==true||inventory?.complete!==true)blockers.push('INVENTORY_INCOMPLETE')
 const required=['current','gateway','rollback','compactBaseline','activeProcesses','deploymentState','exportSupplies']
 for(const key of required)if(!evidence[key]||evidence[key].complete!==true)blockers.push('EVIDENCE_INCOMPLETE_'+key)
 const reasons=new Map(releases.map(r=>[r.releaseId,new Set()]))
 function protect(id,reason){if(typeof id!=='string'||!byId.has(id)){blockers.push('REFERENCE_NOT_IN_INVENTORY_'+reason);return}reasons.get(id).add(reason)}
 for(const key of ['current','gateway','rollback','compactBaseline','activeProcesses','deploymentState']){
  const proof=evidence[key];if(proof?.complete!==true)continue
  if(!Array.isArray(proof.releaseIds)||proof.releaseIds.some(id=>typeof id!=='string')||(['current','rollback','compactBaseline'].includes(key)&&!proof.releaseIds.length)){blockers.push('EVIDENCE_INVALID_'+key);continue}
  for(const id of proof.releaseIds)protect(id,key)
 }
 const supplies=evidence.exportSupplies
 if(supplies?.complete===true){
  if(!Array.isArray(supplies.keys)||supplies.keys.some(k=>!k||!SHA.test(k.engineResourceKey??'')||typeof k.adapterVersion!=='string'||!Number.isSafeInteger(k.migrationLevel)))blockers.push('EVIDENCE_INVALID_exportSupplies')
  else for(const key of supplies.keys){const matching=releases.filter(r=>r.supply?.engineResourceKey===key.engineResourceKey&&r.supply?.adapterVersion===key.adapterVersion&&r.supply?.migrationLevel===key.migrationLevel);if(!matching.length)blockers.push('REQUIRED_SUPPLY_NOT_IN_INVENTORY');for(const r of matching)reasons.get(r.releaseId).add('exportSupply')}
 }
 const unique=[...new Set(blockers)],items=releases.map(r=>({releaseId:r.releaseId,disposition:unique.length||!r.complete?'hold':reasons.get(r.releaseId).size?'protect':'manual-review-only',reasons:unique.length?unique:[...reasons.get(r.releaseId)],logicalBytes:r.logicalBytes,allocatedBytes:r.allocatedBytes,guaranteedReclaimableBytes:null}))
 return {schemaVersion:1,readOnly:true,deleteAuthorized:false,evidenceVerified:false,blockers:unique,items,note:'Evidence is caller-supplied and candidate metadata is not full verification. Recheck locks, processes, mounts, references and bytes before any separately designed operation.'}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv.length!==4||process.argv[2]!=='--root')throw Error('Usage: node release-inventory.mjs --root <canonical-release-directory>')
 const report=await inventoryReleaseRoot(resolve(process.argv[3]));console.log(JSON.stringify({inventory:report,plan:planReleaseRetention(report)},null,2))
}
