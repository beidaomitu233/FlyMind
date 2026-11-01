import {freemem} from 'node:os'
import {readFile} from 'node:fs/promises'
import {posix} from 'node:path'
type ReadText=(path:string)=>Promise<string>

/** The lesser of host and container headroom; no assumption that host RAM is usable. */
export async function linuxHeavyMemory(hostFree:number,read:ReadText=path=>readFile(path,'utf8')):Promise<number>{
 let available=hostFree
 try{const kb=/^MemAvailable:\s+(\d+)\s+kB$/m.exec(await read('/proc/meminfo'))?.[1];if(kb)available=Number(kb)*1024}catch{/* host free remains a conservative fallback */}
 const locations=new Map<string,boolean>([['/sys/fs/cgroup',true],['/sys/fs/cgroup/memory',false]])
 try{for(const line of(await read('/proc/self/cgroup')).trim().split('\n')){
  const match=/^(\d+):([^:]*):(\/.*)$/.exec(line);if(!match||match[3].split('/').some(p=>p==='..'))continue
  const unified=match[1]==='0'&&match[2]==='',memory=match[2].split(',').includes('memory');if(!unified&&!memory)continue
  const root=unified?'/sys/fs/cgroup':'/sys/fs/cgroup/memory';let path=posix.resolve(root,'.'+match[3])
  for(;;){locations.set(path,unified);if(path===root)break;path=posix.dirname(path)}
 }}catch{/* No cgroup membership is supported. */}
 for(const [location,unified] of locations){
  try{const [limit,used]=await Promise.all([read(location+(unified?'/memory.max':'/memory.limit_in_bytes')),read(location+(unified?'/memory.current':'/memory.usage_in_bytes'))]);if(/^\d+\s*$/.test(limit)&&/^\d+\s*$/.test(used)){const ceiling=Number(limit),current=Number(used);if(Number.isSafeInteger(ceiling)&&Number.isSafeInteger(current))available=Math.min(available,Math.max(0,ceiling-current))}}catch{/* This controller/version is not mounted here. */}
 }
 return available
}
export async function availableHeavyMemory():Promise<number>{
 let available=process.platform==='linux'?await linuxHeavyMemory(freemem()):freemem()
 const constrained=(process as NodeJS.Process&{availableMemory?:()=>number}).availableMemory?.()
 if(constrained!==undefined&&Number.isFinite(constrained))available=Math.min(available,constrained)
 return available
}
export async function childRSS(pid:number):Promise<number|undefined>{
 if(process.platform!=='linux')return undefined
 try{const status=await readFile(`/proc/${pid}/status`,'utf8'),kb=/^VmRSS:\s+(\d+)\s+kB$/m.exec(status)?.[1];return kb?Number(kb)*1024:undefined}catch{return undefined}
}
