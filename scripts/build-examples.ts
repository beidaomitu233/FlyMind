import { mkdir,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { samples } from '../src/drawing/core/samples'
import { layoutDocument } from '../src/drawing/core/layout'
import { renderScene,renderDrawio } from '../src/drawing/core/render'
import { extractContent,projectDocument } from '../src/drawing/core/layers'
const output=resolve('examples');await mkdir(output,{recursive:true})
for(const d of samples){const scene=layoutDocument(d);await writeFile(resolve(output,d.kind+'.project.json'),JSON.stringify(projectDocument(d),null,2),'utf8');await writeFile(resolve(output,d.kind+'.json'),JSON.stringify(extractContent(d),null,2),'utf8');await writeFile(resolve(output,d.kind+'.svg'),renderScene(scene,d),'utf8');await writeFile(resolve(output,d.kind+'.drawio'),renderDrawio(scene,d),'utf8')}
console.log(`已生成 ${samples.length} 类图形的 JSON / SVG / draw.io 示例`)
