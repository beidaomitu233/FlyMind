import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { layoutDocument } from '../src/drawing/core/layout'
import { renderScene, renderDrawio } from '../src/drawing/core/render'
import type { DiagramRecord } from './store'
export async function renderArtifacts(record:DiagramRecord,root:string){
  const d=record.document,scene=layoutDocument(d),svg=renderScene(scene,d),directory=join(root,'artifacts',d.id,`r${record.revision}`)
  await mkdir(directory,{recursive:true})
  // Bound the rendered bitmap; SVG and JSON always keep original detail.
  const scale=Math.min(1.5,4096/Math.max(scene.width,scene.height),Math.sqrt(16_000_000/(scene.width*scene.height)))
  const png=await sharp(Buffer.from(svg),{limitInputPixels:false}).resize({width:Math.max(1,Math.ceil(scene.width*scale)),height:Math.max(1,Math.ceil(scene.height*scale)),fit:'fill'}).flatten({background:'#ffffff'}).png().toBuffer()
  const files={json:join(directory,'diagram.json'),svg:join(directory,'diagram.svg'),png:join(directory,'diagram.png'),drawio:join(directory,'diagram.drawio')}
  await Promise.all([writeFile(files.json,JSON.stringify(d,null,2)),writeFile(files.svg,svg),writeFile(files.png,png),writeFile(files.drawio,renderDrawio(scene,d))])
  return {files,png,width:scene.width,height:scene.height}
}
