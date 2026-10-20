import {createHash} from 'node:crypto'
import {mkdir,open,readFile,realpath,rename,stat,utimes} from 'node:fs/promises'
import {join,sep} from 'node:path'
import sharp from 'sharp'
import {DOMParser} from '@xmldom/xmldom'
import {exportBasename} from '../../src/drawing/core/export-metadata'
import {canonicalContentJson} from '../../src/drawing/engine/content-hash'
import {StoreError} from '../store'
import {nativeIdentity} from '../document-record'
import {isNativeCanvasProject} from '../../src/drawing/engine/native-canvas'
import {nativeExportFormats,type NativeExportFormat,type NativeExportManifest,type NativeExportRenderer,type StoredNativeExport} from './types'

export const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex')
export const exportSnapshotHash=(project:unknown)=>sha256(canonicalContentJson(project as any))
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
async function durableWrite(path:string,value:Buffer,at:number){const file=await open(path,'wx');try{await file.writeFile(value);await file.sync()}finally{await file.close()}await utimes(path,at/1000,at/1000)}

/** Each lease owns a different publication directory; no shared latest file is overwritten. */
export async function prepareNativeArtifacts(root:string,job:StoredNativeExport,rendered:Awaited<ReturnType<NativeExportRenderer['render']>>,at:number){
  if(!Buffer.isBuffer(rendered.png)||typeof rendered.svg!=='string')throw new StoreError('渲染器未返回有效图像',500,undefined,'EXPORT_RENDER_INVALID')
  const png=await sharp(rendered.png).metadata()
  if(png.format!=='png'||!png.width||!png.height||png.width!==rendered.width||png.height!==rendered.height||!Number.isFinite(rendered.scale)||rendered.scale<=0)throw new StoreError('PNG 格式或实际尺寸不符',500,undefined,'EXPORT_RENDER_INVALID')
  let parseFailed=false
  const svg=new DOMParser({errorHandler:{warning:()=>{parseFailed=true},error:()=>{parseFailed=true},fatalError:()=>{parseFailed=true}}}).parseFromString(rendered.svg,'image/svg+xml')
  if(parseFailed||svg.documentElement?.localName!=='svg'||/<!DOCTYPE/i.test(rendered.svg))throw new StoreError('SVG 格式无效',500,undefined,'EXPORT_RENDER_INVALID')
  const viewBox=(svg.documentElement.getAttribute('viewBox')||'').trim().split(/[ ,]+/).map(Number)
  const svgWidth=parseFloat(svg.documentElement.getAttribute('width')||''),svgHeight=parseFloat(svg.documentElement.getAttribute('height')||'')
  if(!(viewBox.length===4&&viewBox.every(Number.isFinite)&&viewBox[2]>0&&viewBox[3]>0)&&!(svgWidth>0&&svgHeight>0))throw new StoreError('SVG 尺寸无效',500,undefined,'EXPORT_RENDER_INVALID')
  const canvas=isNativeCanvasProject(job.snapshot)
  const buffers:Partial<Record<NativeExportFormat,Buffer>>={png:rendered.png,svg:Buffer.from(rendered.svg),drawio:Buffer.from(job.snapshot.rendering.engine.xml),'project.json':Buffer.from(JSON.stringify(job.snapshot,null,2))}
  if(!isNativeCanvasProject(job.snapshot))buffers.json=Buffer.from(JSON.stringify(job.snapshot.content,null,2))
  if(exportSnapshotHash(JSON.parse(buffers['project.json']!.toString()))!==job.snapshotSha256||!isNativeCanvasProject(job.snapshot)&&canonicalContentJson(JSON.parse(buffers.json!.toString()))!==canonicalContentJson(job.snapshot.content))throw new StoreError('JSON 制品与快照不符',500,undefined,'EXPORT_SNAPSHOT_INVALID')
  const parent=await parentDirectory(root,job),staging=join(parent,`.${job.leaseToken}.pending`),published=join(parent,job.leaseToken!)
  await mkdir(staging)
  const files={} as NativeExportManifest['files']
  for(const format of nativeExportFormats(job.snapshot)){const bytes=buffers[format]!,filename=exportFilename(job,at,format);await durableWrite(join(staging,filename),bytes,at);const disk=await readFile(join(staging,filename));if(!disk.equals(bytes))throw new StoreError('制品写入校验失败',500,undefined,'EXPORT_WRITE_FAILED');files[format]={filename,mediaType:mediaTypes[format],bytes:bytes.length,sha256:sha256(bytes)}}
  const manifest:NativeExportManifest={schemaVersion:1,exportId:job.id,diagramId:job.diagramId,dataRootId:job.dataRootId,revision:job.revision,exportedAt:at,documentCreatedAt:job.snapshot.createdAt,documentUpdatedAt:job.snapshot.updatedAt,...(isNativeCanvasProject(job.snapshot)?{mode:'canvas-only' as const,xmlHash:job.snapshot.rendering.engine.xmlHash}:{contentHash:job.snapshot.rendering.engine.contentHash}),snapshotSha256:job.snapshotSha256,width:rendered.width,height:rendered.height,scale:rendered.scale,options:job.options,...(job.release?{release:job.release}:{}),runtime:rendered.runtime,timings:rendered.timings,warnings:rendered.warnings,files}
  await durableWrite(join(staging,'manifest.pending.json'),Buffer.from(JSON.stringify(manifest,null,2)),at)
  await rename(join(staging,'manifest.pending.json'),join(staging,'manifest.json'))
  return {manifest,publish:()=>rename(staging,published)}
}

/** Successful SQLite registration is the only resource authority, never directory existence. */
export async function readNativeArtifact(root:string,job:StoredNativeExport,format:NativeExportFormat){
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
  const bytes=await readFile(target),info=await stat(target)
  if(!info.isFile()||bytes.length!==meta.bytes||sha256(bytes)!==meta.sha256||Math.abs(info.mtimeMs-job.manifest.exportedAt)>5)throw new StoreError('制品摘要或时间校验失败，请重新导出',500,undefined,'EXPORT_ARTIFACT_CORRUPT')
  return {buffer:bytes,...meta,path:target}
}
