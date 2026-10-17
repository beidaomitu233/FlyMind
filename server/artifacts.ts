import { mkdir, writeFile,readFile,utimes } from 'node:fs/promises'
import { join,relative,sep,basename } from 'node:path'
import {randomUUID} from 'node:crypto'
import sharp from 'sharp'
import { layoutDocument } from '../src/drawing/core/layout'
import { renderScene, renderDrawio } from '../src/drawing/core/render'
import { extractContent,projectDocument } from '../src/drawing/core/layers'
import type { DiagramRecord } from './store'
import {exportBasename} from '../src/drawing/core/export-metadata'
export async function renderArtifacts(record:DiagramRecord,root:string){
  const d=record.document,scene=layoutDocument(d),svg=renderScene(scene,d),directory=join(root,'artifacts',d.id,`r${record.revision}`)
  await mkdir(directory,{recursive:true})
  // Bound the rendered bitmap; SVG and JSON always keep original detail.
  const scale=Math.min(1.5,4096/Math.max(scene.width,scene.height),Math.sqrt(16_000_000/(scene.width*scene.height)))
  const png=await sharp(Buffer.from(svg),{limitInputPixels:false}).resize({width:Math.max(1,Math.ceil(scene.width*scale)),height:Math.max(1,Math.ceil(scene.height*scale)),fit:'fill'}).flatten({background:'#ffffff'}).png().toBuffer()
  const exportedAt=Date.now(),exportId=exportedAt+'-'+randomUUID().slice(0,8),output=join(directory,'exports',exportId),name=exportBasename(d.title,exportedAt)
  await mkdir(output,{recursive:true})
  const payload={'project.json':JSON.stringify(projectDocument(d),null,2),json:JSON.stringify(extractContent(d),null,2),svg,png,drawio:renderDrawio(scene,d)}
  const files=Object.fromEntries(Object.keys(payload).map(format=>[format,join(output,name+'.'+format)])),time=new Date(exportedAt)
  await Promise.all(Object.entries(payload).map(async([format,bytes])=>{await Promise.all([writeFile(files[format],bytes),writeFile(join(directory,'diagram.'+format),bytes)]);await utimes(files[format],time,time)}))
  await writeFile(join(output,'export.json'),JSON.stringify({exportedAt,files:Object.fromEntries(Object.entries(files).map(([format,path])=>[format,basename(path)]))}))
  const urls=Object.fromEntries(Object.entries(files).map(([format,path])=>[format,'/artifacts/'+relative(join(root,'artifacts'),path).split(sep).map(encodeURIComponent).join('/')]))
  return {files,urls,exportId,exportedAt,png,width:scene.width,height:scene.height}
}
export async function readExportFile(root:string,id:string,revision:number,exportId:string,format:string){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||!Number.isInteger(revision)||revision<1||!/^\d{13}-[a-f0-9]{8}$/.test(exportId)||!['png','svg','json','project.json','drawio'].includes(format))throw new Error('导出引用无效')
  const directory=join(root,'artifacts',id,'r'+revision,'exports',exportId),manifest=JSON.parse(await readFile(join(directory,'export.json'),'utf8')),name=manifest.files?.[format]
  if(typeof name!=='string'||basename(name)!==name)throw new Error('导出文件记录无效')
  return readFile(join(directory,name))
}
