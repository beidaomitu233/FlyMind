import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseDocument } from '../src/drawing/core/adapters'
import { layoutDocument } from '../src/drawing/core/layout'
import { renderScene, renderDrawio } from '../src/drawing/core/render'
const [input,output]=process.argv.slice(2)
if(!input||!output){console.error('用法：npm run render -- input.json output.svg（或 output.drawio）');process.exit(1)}
try{
  const d=parseDocument(await readFile(resolve(input),'utf8')),scene=layoutDocument(d)
  if(!/\.(svg|drawio)$/i.test(output))throw new Error('输出文件扩展名应为 .svg 或 .drawio')
  const target=resolve(output);await mkdir(dirname(target),{recursive:true});await writeFile(target,output.toLowerCase().endsWith('.drawio')?renderDrawio(scene,d):renderScene(scene,d),'utf8')
  console.log(`已渲染 ${d.title}：${target}`)
}catch(e){console.error((e as Error).message);process.exit(1)}
