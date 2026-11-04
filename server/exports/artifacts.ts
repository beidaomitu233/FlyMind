import {createHash} from 'node:crypto'
import {mkdir,open,readFile,realpath,rename,stat,utimes} from 'node:fs/promises'
import {join,sep} from 'node:path'
import {createReadStream} from 'node:fs'
import sharp from 'sharp'
import {runHeavyWork,svgInputJSONBytes,readVerifiedSVG} from '../heavy-work/runner'
import {exportBasename} from '../../src/drawing/core/export-metadata'
import {canonicalContentJson} from '../../src/drawing/engine/content-hash'
import {StoreError} from '../store'
import {nativeIdentity} from '../document-record'
import {canonicalSHA256} from './canonical-sha'
import {isNativeCanvasProject} from '../../src/drawing/engine/native-canvas'
import {nativeExportFormats,type NativeExportFormat,type NativeExportManifest,type NativeExportRenderer,type StoredNativeExport} from './types'

export const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex')
export const exportSnapshotHash=(project:unknown)=>canonicalSHA256(project)
const extensions:Record<NativeExportFormat,string>={png:'.png',svg:'.svg',drawio:'.drawio',json:'.json','project.json':'.project.json'}
const mediaTypes:Record<NativeExportFormat,string>={png:'image/png',svg:'image/svg+xml',drawio:'application/xml',json:'application/json','project.json':'application/json'}
export const exportFilename=(job:StoredNativeExport,at:number,format:NativeExportFormat)=>exportBasename(nativeIdentity(job.snapshot).title,at)+extensions[format]

async function parentDirectory(root:string,job:StoredNativeExport){
  if(!job.leaseToken||!/^[a-zA-Z0-9_-]+$/.test(job.leaseToken))throw new StoreError('导出制品租约无效',409,undefined,'EXPORT_LEASE_LOST')
  const rootReal=await realpath(root),artifacts=join(root,'artifacts');await mkdir(artifacts,{recursive:true})
  const artifactsReal=await realpath(artifacts)
  if(!artifactsReal.startsWith(rootReal+sep))throw new StoreError('导出制品目录越界',400,undefined,'EXPORT_PATH_INVALID')
  const parent=join(artifacts,job.diagramId,`r${job.revision}`,'exports',job.id);await mkdir(parent,{recursive:true})
  if(!(await realpath(parent)).startsWith(artifactsReal+sep))throw new StoreError('导出制品目录越界',400,undefined,'EXPORT_PATH_INVALID')
  return parent
}
async function durableWrite(path:string,value:Buffer|string,at:number,signal?:AbortSignal){
 const file=await open(path,'wx'),hash=createHash('sha256');let bytes=0
 try{for(let offset=0;offset<value.length;){signal?.throwIfAborted();let end=Math.min(value.length,offset+64*1024)
   if(typeof value==='string'&&end<value.length&&value.charCodeAt(end-1)>=0xd800&&value.charCodeAt(end-1)<=0xdbff&&value.charCodeAt(end)>=0xdc00&&value.charCodeAt(end)<=0xdfff)end++
   const chunk=typeof value==='string'?Buffer.from(value.slice(offset,end)):value.subarray(offset,end);hash.update(chunk);bytes+=chunk.length;await file.writeFile(chunk);offset=end
  }await file.sync()
 }finally{await file.close()}
 await utimes(path,at/1000,at/1000);return {bytes,sha256:hash.digest('hex')}
}
async function diskDigest(path:string,signal?:AbortSignal){const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(path)){signal?.throwIfAborted();bytes+=chunk.length;hash.update(chunk)}return {bytes,sha256:hash.digest('hex')}}

/** Each lease owns a different publication directory; no shared latest file is overwritten. */
export async function prepareNativeArtifacts(root:string,job:StoredNativeExport,rendered:Awaited<ReturnType<NativeExportRenderer['render']>>,at:number,controls:{signal?:AbortSignal;timeoutMs?:number}={}){
  if(!Buffer.isBuffer(rendered.png)||typeof rendered.svg!=='string')throw new StoreError('渲染器未返回有效图像',500,undefined,'EXPORT_RENDER_INVALID')
  const png=await sharp(rendered.png).metadata()
  if(png.format!=='png'||!png.width||!png.height||png.width!==rendered.width||png.height!==rendered.height||!Number.isFinite(rendered.scale)||rendered.scale<=0)throw new StoreError('PNG 格式或实际尺寸不符',500,undefined,'EXPORT_RENDER_INVALID')
  const aborted=controls.signal?.aborted,timeout=aborted?undefined:controls.timeoutMs??30000,eligible=!aborted&&typeof timeout==='number'&&Number.isInteger(timeout)&&timeout>=1&&timeout<=60000
  const verifiedSVG=eligible?readVerifiedSVG(rendered):undefined,verifiedBytes=verifiedSVG===undefined?undefined:svgInputJSONBytes('svg-metadata',{svg:verifiedSVG})
  const reuse=verifiedBytes!==undefined&&verifiedBytes<=96*1024*1024
  if(!reuse)await runHeavyWork('svg-metadata',{svg:rendered.svg},controls)
  if(exportSnapshotHash(job.snapshot)!==job.snapshotSha256)throw new StoreError('JSON 制品与快照不符',500,undefined,'EXPORT_SNAPSHOT_INVALID')
  const parent=await parentDirectory(root,job),staging=join(parent,`.${job.leaseToken}.pending`),published=join(parent,job.leaseToken!)
  await mkdir(staging)
  const files={} as NativeExportManifest['files']
  for(const format of nativeExportFormats(job.snapshot)){
   const value=format==='png'?rendered.png:format==='svg'?(reuse?verifiedSVG!:rendered.svg):format==='drawio'?job.snapshot.rendering.engine.xml:JSON.stringify(format==='json'&&!isNativeCanvasProject(job.snapshot)?job.snapshot.content:job.snapshot,null,2)
   if(format==='project.json'&&exportSnapshotHash(JSON.parse(value as string))!==job.snapshotSha256)throw new StoreError('JSON 制品与快照不符',500,undefined,'EXPORT_SNAPSHOT_INVALID')
   if(format==='json'&&!isNativeCanvasProject(job.snapshot)&&canonicalContentJson(JSON.parse(value as string))!==canonicalContentJson(job.snapshot.content))throw new StoreError('JSON 制品与快照不符',500,undefined,'EXPORT_SNAPSHOT_INVALID')
   const filename=exportFilename(job,at,format),path=join(staging,filename),written=await durableWrite(path,value,at,controls.signal),disk=await diskDigest(path,controls.signal)
   if(disk.bytes!==written.bytes||disk.sha256!==written.sha256)throw new StoreError('制品写入校验失败',500,undefined,'EXPORT_WRITE_FAILED')
   files[format]={filename,mediaType:mediaTypes[format],...written}
  }
  const manifest:NativeExportManifest={schemaVersion:1,exportId:job.id,diagramId:job.diagramId,dataRootId:job.dataRootId,revision:job.revision,exportedAt:at,documentCreatedAt:job.snapshot.createdAt,documentUpdatedAt:job.snapshot.updatedAt,...(isNativeCanvasProject(job.snapshot)?{mode:'canvas-only' as const,xmlHash:job.snapshot.rendering.engine.xmlHash}:{contentHash:job.snapshot.rendering.engine.contentHash}),snapshotSha256:job.snapshotSha256,width:rendered.width,height:rendered.height,scale:rendered.scale,options:job.options,...(job.release?{release:job.release}:{}),runtime:rendered.runtime,timings:rendered.timings,warnings:rendered.warnings,files}
  await durableWrite(join(staging,'manifest.pending.json'),Buffer.from(JSON.stringify(manifest,null,2)),at)
  await rename(join(staging,'manifest.pending.json'),join(staging,'manifest.json'))
  return {manifest,publish:()=>rename(staging,published)}
}

/** Successful SQLite registration is the only resource authority, never directory existence. */
async function artifactDescriptor(root:string,job:StoredNativeExport,format:NativeExportFormat){
  if(job.status!=='succeeded'||!job.manifest||!job.leaseToken)throw new StoreError('导出尚未成功，不能读取制品',409,undefined,'EXPORT_NOT_READY')
  if(!nativeExportFormats(job.snapshot).includes(format))throw new StoreError('仅画布没有业务内容JSON制品',422,undefined,'CONTENT_EXPORT_NOT_APPLICABLE')
  const meta=job.manifest.files[format]
  if(!meta||meta.filename!==exportFilename(job,job.manifest.exportedAt,format))throw new StoreError('制品清单无效',500,undefined,'EXPORT_MANIFEST_INVALID')
  const rootReal=await realpath(root),directory=join(root,'artifacts',job.diagramId,`r${job.revision}`,'exports',job.id,job.leaseToken)
  let target:string
  try{target=await realpath(join(directory,meta.filename))}catch{throw new StoreError('制品文件缺失，请重新导出',500,undefined,'EXPORT_ARTIFACT_MISSING')}
  if(!target.startsWith(rootReal+sep))throw new StoreError('制品路径越界',400,undefined,'EXPORT_PATH_INVALID')
  const diskManifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'))
  if(canonicalContentJson(diskManifest)!==canonicalContentJson(job.manifest as any))throw new StoreError('已发布清单与任务登记不符',500,undefined,'EXPORT_MANIFEST_INVALID')
  return {meta,target}
}
/** Path delivery validates identical authority and all bytes without retaining a file Buffer. */
export async function verifyNativeArtifact(root:string,job:StoredNativeExport,format:NativeExportFormat){
  const {meta,target}=await artifactDescriptor(root,job,format),digest=await diskDigest(target),info=await stat(target)
  if(!info.isFile()||info.size!==meta.bytes||digest.bytes!==meta.bytes||digest.sha256!==meta.sha256||Math.abs(info.mtimeMs-job.manifest!.exportedAt)>5)throw new StoreError('制品摘要或时间校验失败，请重新导出',500,undefined,'EXPORT_ARTIFACT_CORRUPT')
  return {...meta,path:target}
}
export async function readNativeArtifact(root:string,job:StoredNativeExport,format:NativeExportFormat){
  const {meta,target}=await artifactDescriptor(root,job,format),bytes=await readFile(target),info=await stat(target)
  if(!info.isFile()||bytes.length!==meta.bytes||sha256(bytes)!==meta.sha256||Math.abs(info.mtimeMs-job.manifest!.exportedAt)>5)throw new StoreError('制品摘要或时间校验失败，请重新导出',500,undefined,'EXPORT_ARTIFACT_CORRUPT')
  return {buffer:bytes,...meta,path:target}
}
