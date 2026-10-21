// Fixed silent renderer only; synthetic content, no Runtime or customer DB.
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import assert from 'node:assert/strict'
import {NativeDrawioRenderer} from '../../server/rendering/renderer.ts'
import {compileDrawio,projectDrawio,drawioRenderSignature} from '../../src/drawing/engine/drawio/index.ts'
import {createDrawingProject} from '../../src/drawing/engine/project.ts'
import {parseNative,attr,children} from '../../src/drawing/engine/drawio/xml.ts'
import {geometry,mainEntry} from '../../src/drawing/engine/drawio/state.ts'
import {inspectNativeLayout} from '../../src/drawing/engine/drawio/routing.ts'
import {outerReturnContent} from '../../tests/fixtures/drawing-quality/outer-return.ts'
const out=resolve(process.env.FLYMIND_PROBE_OUTPUT??'output/playwright/drawio-outer-return');await mkdir(out,{recursive:true})
const renderer=new NativeDrawioRenderer(),report={ok:false,samples:[]}
try{
 for(const kind of ['flowchart','swimlane'])for(const orientation of ['vertical','horizontal']){
  const content=outerReturnContent(kind),engine=await compileDrawio(content,{preferences:{orientation}}),project=await createDrawingProject(content,engine,{createdAt:1,updatedAt:1}),id=kind+'-'+orientation
  await writeFile(join(out,id+'.input.drawio'),engine.xml)
  const result=await renderer.render(project),n=parseNative(result.nativeXML)
  assert.deepEqual((await projectDrawio(result.nativeXML)).content,content)
  assert.equal(drawioRenderSignature(result.nativeXML),drawioRenderSignature(engine.xml));assert.deepEqual(inspectNativeLayout(n),[])
  const routes=['feedback','unmarked'].map(id=>{const g=geometry(mainEntry(n,'edge',id));return {id,points:children(g,'Array').flatMap(a=>children(a,'mxPoint').map(p=>({x:Number(attr(p,'x')),y:Number(attr(p,'y'))})))}})
  await Promise.all([writeFile(join(out,id+'.png'),result.png),writeFile(join(out,id+'.svg'),result.svg),writeFile(join(out,id+'.drawio'),result.nativeXML),writeFile(join(out,id+'.content.json'),JSON.stringify(content,null,2))])
  report.samples.push({id,width:result.width,height:result.height,contentHash:engine.contentHash,routes,timings:result.timings})
 }
 report.ok=true
}catch(error){report.error=error.stack;process.exitCode=1}finally{await renderer.close();await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))}
